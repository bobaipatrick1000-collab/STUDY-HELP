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

export async function searchAndExtract(
  query: string,
  opts: {
    numResults?: number
    maxResultChars?: number
    budgetChars?: number
  } = {},
): Promise<SearchOutcome> {
  const key = (process.env.SEARCH_API_KEY ?? "").trim()
  const numResults = opts.numResults ?? envNumber("SEARCH_NUM_RESULTS", 8)
  const maxResultChars = opts.maxResultChars ?? envNumber("SEARCH_MAX_RESULT_CHARS", 4000)
  const budgetChars = opts.budgetChars ?? envNumber("SEARCH_BUDGET_CHARS", 24000)

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
        max_results: numResults,
        include_raw_content: true,
        include_answer: false,
        topic: "general",
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return {
      ok: false,
      kind: "service",
      message: "Live web search is temporarily unavailable. Please try again in a moment.",
    }
  }

  const data = (await res.json().catch(() => null)) as TavilyResponse | null

  if (!res.ok) {
    if (res.status === 429 || res.status === 432 || res.status === 433) {
      return {
        ok: false,
        kind: "credits",
        message:
          "The web search quota is exhausted. Add credits or a SEARCH_API_KEY in .env.local, then try again.",
      }
    }
    if (res.status === 401) {
      return {
        ok: false,
        kind: "config",
        message: "The Tavily search API key was rejected for web search.",
      }
    }
    return {
      ok: false,
      kind: "service",
      message: "Live web search failed. Please try again in a moment.",
    }
  }

  const rawResults = data?.results ?? []
  const results: SearchResult[] = []
  let used = 0
  for (const raw of rawResults) {
    const url = (raw.url ?? "").trim()
    const title = (raw.title ?? "").trim().slice(0, 300)
    if (url === "" || title === "") continue

    const rawText =
      typeof raw.raw_content === "string" && raw.raw_content !== ""
        ? raw.raw_content
        : (raw.content ?? "")
    const snippet = (raw.content ?? "").trim().slice(0, 500)
    if (rawText.trim() === "" && snippet === "") continue

    const text = cleanText(truncateText(rawText, maxResultChars))
    const remaining = budgetChars - used
    if (remaining <= 0) break

    const kept = text.slice(0, remaining)
    used += kept.length
    results.push({ title, url, snippet, text: kept })
  }

  return { ok: true, results }
}