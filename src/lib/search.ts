export interface SearchResult {
  title: string
  url: string
  snippet: string
  text: string
}

export type SearchFailureKind = "config" | "ratelimit" | "credits" | "service"

export type SearchOutcome =
  | { ok: true; results: SearchResult[] }
  | { ok: false; kind: SearchFailureKind; message: string }

export type SearchProvider = "tavily" | "firecrawl" | "serper" | "brave"

interface ProviderFailure {
  ok: false
  kind: SearchFailureKind
  message: string
  reason: string
}

type ProviderOutcome =
  | { ok: true; results: SearchResult[] }
  | ProviderFailure

interface TavilyResponse {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    raw_content?: string | null
    score?: number
  }>
  error?: unknown
}

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string
      url?: string
      description?: string
    }>
  }
}

interface FirecrawlResponse {
  success?: boolean
  data?: {
    web?: Array<{
      title?: string
      url?: string
      description?: string
      markdown?: string | null
    }>
  }
}

interface SerperResponse {
  organic?: Array<{
    title?: string
    link?: string
    snippet?: string
    date?: string
  }>
}

interface RawCandidate {
  title?: string
  url?: string
  snippet?: string
  text?: string
}

const BOILERPLATE_LINES = [
  /^skip to (content|main|search)\b/i,
  /^main menu$/i,
  /^menu$/i,
  /^search menu$/i,
  /^accept (all )?(cookies|these terms)\b/i,
  /^we value your privacy$/i,
  /^sign in/i,
  /^log in/i,
  /^subscribe$/i,
  /^newsletter$/i,
  /^advertisement/i,
  /^advertisements?$/i,
  /^share this/i,
  /^submit corrections$/i,
  /^!\s*\[/i,
]

function cleanText(raw: string): string {
  const lines: string[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "") continue
    if (BOILERPLATE_LINES.some((re) => re.test(line))) continue
    if (lines.length > 0 && lines[lines.length - 1] === line) continue
    if (/^\[[^\]]*\]\([^)]*\)$/.test(line)) continue
    lines.push(line)
  }
  return lines.join("\n")
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).replace(/\s+\S*$/, "") + "\n[…]"
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

export function searchOptions(opts: {
  numResults?: number
  maxResultChars?: number
  budgetChars?: number
} = {}): { numResults: number; maxResultChars: number; budgetChars: number } {
  return {
    numResults: opts.numResults ?? envNumber("SEARCH_NUM_RESULTS", 8),
    maxResultChars: opts.maxResultChars ?? envNumber("SEARCH_MAX_RESULT_CHARS", 4000),
    budgetChars: opts.budgetChars ?? envNumber("SEARCH_BUDGET_CHARS", 24000),
  }
}

function buildResults(
  candidates: RawCandidate[],
  maxResultChars: number,
  budgetChars: number,
): SearchResult[] {
  const results: SearchResult[] = []
  let used = 0
  for (const raw of candidates) {
    const url = (raw.url ?? "").trim()
    const title = (raw.title ?? "").trim().slice(0, 300)
    if (url === "" || title === "") continue

    const rawText = (raw.text ?? "").trim() !== "" ? (raw.text ?? "") : (raw.snippet ?? "")
    const snippet = (raw.snippet ?? "").trim().slice(0, 500)
    if (rawText.trim() === "" && snippet === "") continue

    const text = cleanText(truncateText(rawText, maxResultChars))
    const remaining = budgetChars - used
    if (remaining <= 0) break

    const kept = text.slice(0, remaining)
    used += kept.length
    results.push({ title, url, snippet, text: kept })
  }
  return results
}

function classifyHttp(status: number, providerLabel: string): ProviderFailure {
  if (status === 429 || status === 432 || status === 433) {
    return {
      ok: false,
      kind: "credits",
      message:
        "The web search quota is exhausted. Add credits or a SEARCH_API_KEY in .env.local, then try again.",
      reason: providerLabel + " returned HTTP " + status + " (quota or rate limited)",
    }
  }
  if (status === 402) {
    return {
      ok: false,
      kind: "credits",
      message:
        "The web search account is out of credits. Add credits or a SEARCH_API_KEY in .env.local, then try again.",
      reason: providerLabel + " returned HTTP 402 (out of credits)",
    }
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      kind: "config",
      message: "The " + providerLabel + " search API key was rejected for web search.",
      reason: providerLabel + " returned HTTP " + status + " (invalid or missing key)",
    }
  }
  return {
    ok: false,
    kind: "service",
    message: "Live web search failed. Please try again in a moment.",
    reason: providerLabel + " returned HTTP " + status,
  }
}

async function runTavily(
  query: string,
  settings: { numResults: number; maxResultChars: number; budgetChars: number },
): Promise<ProviderOutcome> {
  const key = (process.env.SEARCH_API_KEY ?? "").trim()

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (key !== "") {
    headers.Authorization = "Bearer " + key
  }

  let res: Response
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: settings.numResults,
        include_raw_content: true,
        include_answer: false,
        topic: "general",
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    return {
      ok: false,
      kind: "service",
      message: "Live web search is temporarily unavailable. Please try again in a moment.",
      reason: "Tavily request failed (" + (err instanceof Error ? err.name : "network error") + ")",
    }
  }

  const data = (await res.json().catch(() => null)) as TavilyResponse | null

  if (!res.ok) {
    return classifyHttp(res.status, "Tavily")
  }

  const rawResults = data?.results ?? []
  const candidates: RawCandidate[] = rawResults.map((raw) => {
    const rawText =
      typeof raw.raw_content === "string" && raw.raw_content !== ""
        ? raw.raw_content
        : (raw.content ?? "")
    return { title: raw.title, url: raw.url, snippet: raw.content ?? "", text: rawText }
  })

  return { ok: true, results: buildResults(candidates, settings.maxResultChars, settings.budgetChars) }
}

export async function searchAndExtract(
  query: string,
  opts: {
    numResults?: number
    maxResultChars?: number
    budgetChars?: number
  } = {},
): Promise<SearchOutcome> {
  const outcome = await runTavily(query, searchOptions(opts))
  if (outcome.ok) return outcome
  return { ok: false, kind: outcome.kind, message: outcome.message }
}

export async function searchBrave(
  query: string,
  count = 5,
  opts: {
    maxResultChars?: number
    budgetChars?: number
  } = {},
): Promise<SearchOutcome> {
  const outcome = await runBrave(query, count, searchOptions({ numResults: count, ...opts }))
  if (outcome.ok) return outcome
  return { ok: false, kind: outcome.kind, message: outcome.message }
}

async function runBrave(
  query: string,
  count: number,
  settings: { maxResultChars: number; budgetChars: number },
): Promise<ProviderOutcome> {
  const key = (process.env.BRAVE_API_KEY ?? "").trim()
  if (key === "") {
    return {
      ok: false,
      kind: "config",
      message: "Brave Search is not configured. Add BRAVE_API_KEY to .env.local, then try again.",
      reason: "BRAVE_API_KEY is not set",
    }
  }

  const numeric = Math.floor(count)
  const wanted = Math.min(Math.max(1, Number.isFinite(numeric) ? numeric : 5), 20)
  const url =
    "https://api.search.brave.com/res/v1/web/search?q=" +
    encodeURIComponent(query) +
    "&count=" +
    wanted

  let res: Response
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    return {
      ok: false,
      kind: "service",
      message: "Live web search is temporarily unavailable. Please try again in a moment.",
      reason: "Brave request failed (" + (err instanceof Error ? err.name : "network error") + ")",
    }
  }

  const data = (await res.json().catch(() => null)) as BraveResponse | null

  if (!res.ok) {
    return classifyHttp(res.status, "Brave")
  }

  const rawResults = data?.web?.results ?? []
  const candidates: RawCandidate[] = rawResults.map((raw) => {
    const description = raw.description ?? ""
    return { title: raw.title, url: raw.url, snippet: description, text: description }
  })

  return { ok: true, results: buildResults(candidates, settings.maxResultChars, settings.budgetChars) }
}

export async function searchFirecrawl(
  query: string,
  count = 5,
  opts: {
    maxResultChars?: number
    budgetChars?: number
  } = {},
): Promise<SearchOutcome> {
  const outcome = await runFirecrawl(query, count, searchOptions({ numResults: count, ...opts }))
  if (outcome.ok) return outcome
  return { ok: false, kind: outcome.kind, message: outcome.message }
}

async function runFirecrawl(
  query: string,
  count: number,
  settings: { maxResultChars: number; budgetChars: number },
): Promise<ProviderOutcome> {
  const key = (process.env.FIRECRAWL_API_KEY ?? "").trim()
  if (key === "") {
    return {
      ok: false,
      kind: "config",
      message: "Firecrawl is not configured. Add FIRECRAWL_API_KEY to .env.local, then try again.",
      reason: "FIRECRAWL_API_KEY is not set",
    }
  }

  const numeric = Math.floor(count)
  const wanted = Math.min(Math.max(1, Number.isFinite(numeric) ? numeric : 5), 100)

  let res: Response
  try {
    res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        query,
        limit: wanted,
        scrapeOptions: {
          formats: [{ type: "markdown" }],
          onlyMainContent: true,
        },
        timeout: 30_000,
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (err) {
    return {
      ok: false,
      kind: "service",
      message: "Live web search is temporarily unavailable. Please try again in a moment.",
      reason: "Firecrawl request failed (" + (err instanceof Error ? err.name : "network error") + ")",
    }
  }

  const data = (await res.json().catch(() => null)) as FirecrawlResponse | null

  if (!res.ok) {
    return classifyHttp(res.status, "Firecrawl")
  }

  const rawResults = data?.data?.web ?? []
  const candidates: RawCandidate[] = rawResults.map((raw) => {
    const description = raw.description ?? ""
    const markdown = (raw.markdown ?? "").trim()
    return {
      title: raw.title,
      url: raw.url,
      snippet: description,
      text: markdown !== "" ? markdown : description,
    }
  })

  return { ok: true, results: buildResults(candidates, settings.maxResultChars, settings.budgetChars) }
}

export async function searchSerper(
  query: string,
  count = 5,
  opts: {
    maxResultChars?: number
    budgetChars?: number
  } = {},
): Promise<SearchOutcome> {
  const outcome = await runSerper(query, count, searchOptions({ numResults: count, ...opts }))
  if (outcome.ok) return outcome
  return { ok: false, kind: outcome.kind, message: outcome.message }
}

async function runSerper(
  query: string,
  count: number,
  settings: { maxResultChars: number; budgetChars: number },
): Promise<ProviderOutcome> {
  const key = (process.env.SERPER_API_KEY ?? "").trim()
  if (key === "") {
    return {
      ok: false,
      kind: "config",
      message: "Serper is not configured. Add SERPER_API_KEY to .env.local, then try again.",
      reason: "SERPER_API_KEY is not set",
    }
  }

  const numeric = Math.floor(count)
  const wanted = Math.min(Math.max(1, Number.isFinite(numeric) ? numeric : 5), 100)

  let res: Response
  try {
    res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key,
      },
      body: JSON.stringify({ q: query, num: wanted }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    return {
      ok: false,
      kind: "service",
      message: "Live web search is temporarily unavailable. Please try again in a moment.",
      reason: "Serper request failed (" + (err instanceof Error ? err.name : "network error") + ")",
    }
  }

  const data = (await res.json().catch(() => null)) as SerperResponse | null

  if (!res.ok) {
    return classifyHttp(res.status, "Serper")
  }

  const rawResults = data?.organic ?? []
  const candidates: RawCandidate[] = rawResults.map((raw) => {
    const snippet = raw.snippet ?? ""
    return { title: raw.title, url: raw.link, snippet, text: snippet }
  })

  return { ok: true, results: buildResults(candidates, settings.maxResultChars, settings.budgetChars) }
}

export function searchProviderOverride(): "auto" | SearchProvider {
  const raw = (process.env.SEARCH_PROVIDER ?? "auto").trim().toLowerCase()
  if (raw === "tavily" || raw === "firecrawl" || raw === "serper" || raw === "brave") return raw
  return "auto"
}

const PROVIDER_LABELS: Record<SearchProvider, string> = {
  tavily: "Tavily",
  firecrawl: "Firecrawl",
  serper: "Serper",
  brave: "Brave",
}

const PROVIDER_CHAIN: SearchProvider[] = ["tavily", "firecrawl", "serper", "brave"]

function providerConfigured(provider: SearchProvider): boolean {
  if (provider === "firecrawl") return (process.env.FIRECRAWL_API_KEY ?? "").trim() !== ""
  if (provider === "serper") return (process.env.SERPER_API_KEY ?? "").trim() !== ""
  if (provider === "brave") return (process.env.BRAVE_API_KEY ?? "").trim() !== ""
  return true
}

function runProvider(
  provider: SearchProvider,
  query: string,
  settings: { numResults: number; maxResultChars: number; budgetChars: number },
): Promise<ProviderOutcome> {
  if (provider === "firecrawl") return runFirecrawl(query, settings.numResults, settings)
  if (provider === "serper") return runSerper(query, settings.numResults, settings)
  if (provider === "brave") return runBrave(query, settings.numResults, settings)
  return runTavily(query, settings)
}

export async function searchWeb(
  query: string,
  opts: {
    numResults?: number
    maxResultChars?: number
    budgetChars?: number
  } = {},
): Promise<SearchOutcome> {
  const settings = searchOptions(opts)
  const override = searchProviderOverride()

  if (override !== "auto") {
    const forced = await runProvider(override, query, settings)
    const label = PROVIDER_LABELS[override]
    if (forced.ok) {
      console.log(
        "Search provider: " + label + " (forced by SEARCH_PROVIDER" + (forced.results.length === 0 ? ", no results" : "") + ")",
      )
      return forced
    }
    console.log("Search provider: none (" + label + " forced by SEARCH_PROVIDER failed: " + forced.reason + ")")
    return { ok: false, kind: forced.kind, message: forced.message }
  }

  const failures: string[] = []
  let attempted = 0
  let firstHardFailure: ProviderFailure | null = null
  let emptyOutcome: { ok: true; results: SearchResult[] } | null = null

  for (const provider of PROVIDER_CHAIN) {
    const label = PROVIDER_LABELS[provider]
    if (!providerConfigured(provider)) {
      console.log("Search provider: skipping " + label + " (no API key configured)")
      continue
    }
    attempted++
    const outcome = await runProvider(provider, query, settings)
    if (outcome.ok) {
      if (outcome.results.length > 0) {
        console.log(
          "Search provider: " + label + (failures.length > 0 ? " (" + failures.join("; ") + ")" : ""),
        )
        return outcome
      }
      if (!emptyOutcome) emptyOutcome = outcome
      failures.push(label + " returned no results")
      continue
    }
    if (!firstHardFailure) firstHardFailure = outcome
    failures.push(outcome.reason)
  }

  if (failures.length === 0) {
    return {
      ok: false,
      kind: "config",
      message: "No web search provider is configured. Add a search API key to .env.local, then try again.",
    }
  }

  if (emptyOutcome) {
    console.log("Search provider: none (all providers returned no results: " + failures.join("; ") + ")")
    return emptyOutcome
  }

  console.log("Search provider: none (" + failures.join("; ") + ")")

  if (attempted === 1 && firstHardFailure) {
    return { ok: false, kind: firstHardFailure.kind, message: firstHardFailure.message }
  }

  return {
    ok: false,
    kind: "service",
    message:
      "Live web search is unavailable right now (every configured provider failed). Please try again in a moment.",
  }
}