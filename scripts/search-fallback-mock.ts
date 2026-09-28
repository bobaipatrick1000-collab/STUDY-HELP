import { searchBrave, searchFirecrawl, searchSerper, searchWeb } from "../src/lib/search"

const realFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function installMock(handler: (url: string, init: RequestInit | undefined) => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    return Promise.resolve(handler(url, init))
  }) as typeof fetch
}

const bravePayload = {
  web: {
    results: [
      { title: "Photosynthesis - Wikipedia", url: "https://en.wikipedia.org/wiki/Photosynthesis", description: "Photosynthesis is the process by which green plants use light to make sugars from carbon dioxide and water." },
      { title: "  ", url: "https://bad.example", description: "should be skipped: no title" },
      { title: "Photosynthesis (biology)", url: "https://simple.wikipedia.org", description: "Short bio summary." },
    ],
  },
}

const serperPayload = {
  organic: [
    { title: "Photosynthesis - Simple English Wikipedia", link: "https://simple.wikipedia.org/wiki/Photosynthesis", snippet: "Photosynthesis is how plants turn light into sugar." },
    { title: "   ", link: "https://bad.example", snippet: "skipped: blank title" },
  ],
}

const firecrawlPayload = {
  success: true,
  data: {
    web: [
      {
        title: "Photosynthesis - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Photosynthesis",
        description: "Process by which plants convert light into chemical energy.",
        markdown: "# Photosynthesis\n\nPhotosynthesis is a process used by plants and other organisms to convert light energy into chemical energy that, through cellular respiration, can later be released to fuel the organism's activities.",
      },
      { title: "No markdown result", url: "https://example.org/x", description: "Snippet only.", markdown: null },
    ],
  },
}

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  console.log((condition ? "PASS " : "FAIL ") + label + (detail !== "" ? " -> " + detail : ""))
  if (!condition) failures++
}

async function main(): Promise<void> {
  process.env.BRAVE_API_KEY = "test-brave-key"
  process.env.SERPER_API_KEY = "test-serper-key"

  console.log("\n[1] Brave request shape + result mapping")
  let seenUrl = ""
  let seenHeaders: Record<string, string> = {}
  installMock((url, init) => {
    seenUrl = url
    seenHeaders = (init?.headers ?? {}) as Record<string, string>
    return jsonResponse(200, bravePayload)
  })
  const brave = await searchBrave("photosynthesis basics", 5)
  check("Brave call succeeds", brave.ok)
  check("URL is Brave web search endpoint", seenUrl.startsWith("https://api.search.brave.com/res/v1/web/search?"), seenUrl)
  check("query is url-encoded in q=", seenUrl.includes("q=photosynthesis%20basics"))
  check("count param present", seenUrl.includes("&count=5"))
  check("X-Subscription-Token header sent", seenHeaders["X-Subscription-Token"] === "test-brave-key")
  check("Accept: application/json header sent", seenHeaders["Accept"] === "application/json")
  if (brave.ok) {
    check("empty-title result skipped", brave.results.length === 2, "got " + brave.results.length)
    const first = brave.results[0]
    check("has title/url/snippet/text like Tavily", first !== undefined && typeof first.title === "string" && typeof first.url === "string" && typeof first.snippet === "string" && typeof first.text === "string")
    check("description mapped to snippet+text", first?.snippet.startsWith("Photosynthesis is the process") === true && first?.text === first?.snippet)
  }

  console.log("\n[2] count clamping")
  seenUrl = ""
  await searchBrave("q", 999)
  check("count clamped to 20", seenUrl.includes("&count=20"), seenUrl)
  await searchBrave("q", 0)
  check("count clamped up to 1", seenUrl.includes("&count=1"), seenUrl)

  console.log("\n[2a] Firecrawl request shape + markdown mapping")
  process.env.FIRECRAWL_API_KEY = "test-firecrawl-key"
  let fcBody = ""
  let fcHeaders: Record<string, string> = {}
  let fcUrl = ""
  installMock((url, init) => {
    fcUrl = url
    fcHeaders = (init?.headers ?? {}) as Record<string, string>
    fcBody = String(init?.body ?? "")
    return jsonResponse(200, firecrawlPayload)
  })
  const fc = await searchFirecrawl("photosynthesis", 5)
  check("Firecrawl call succeeds", fc.ok)
  check("URL is Firecrawl v2 search", fcUrl === "https://api.firecrawl.dev/v2/search", fcUrl)
  check("bearer auth header sent", fcHeaders["Authorization"] === "Bearer test-firecrawl-key")
  check("body carries query, limit and markdown format", fcBody.includes('"query":"photosynthesis"') && fcBody.includes('"limit":5') && fcBody.includes('"markdown"'), fcBody)
  if (fc.ok) {
    check("both results kept", fc.results.length === 2, "got " + fc.results.length)
    const first = fc.results[0]
    check("markdown used as full text", (first?.text.length ?? 0) > 200, "textChars=" + (first?.text.length ?? 0))
    check("description kept as snippet", first?.snippet.startsWith("Process by which plants") === true)
    check("null markdown falls back to description", fc.results[1]?.text === "Snippet only.")
  }

  console.log("\n[2a2] Tavily is the primary provider, Firecrawl is only a fallback")
  const callOrder: string[] = []
  installMock((url) => {
    if (url.includes("api.tavily.com")) {
      callOrder.push("tavily")
      return jsonResponse(200, { results: [{ title: "Tavily primary", url: "https://t.example", content: "body", raw_content: "full tavily text" }] })
    }
    if (url.includes("firecrawl")) {
      callOrder.push("firecrawl")
      return jsonResponse(200, firecrawlPayload)
    }
    callOrder.push("other")
    return jsonResponse(200, bravePayload)
  })
  const primary = await searchWeb("photosynthesis")
  check("Tavily answers without touching Firecrawl", primary.ok && callOrder.join(",") === "tavily", callOrder.join(","))
  check("Tavily text is used for grounding", (primary.ok ? primary.results[0]?.text.length ?? 0 : 0) > 5)

  console.log("\n[2a3] Tavily fails -> Firecrawl answers next")
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(402, {})
    if (url.includes("firecrawl")) return jsonResponse(200, firecrawlPayload)
    if (url.includes("serper.dev")) return jsonResponse(200, serperPayload)
    return jsonResponse(200, bravePayload)
  })
  const afterTavily = await searchWeb("photosynthesis")
  check("falls through to Firecrawl", afterTavily.ok && (afterTavily.results[0]?.text.length ?? 0) > 200, afterTavily.ok ? "text=" + String(afterTavily.results[0]?.text.length ?? 0) : "failed")

  console.log("\n[2a4] Tavily key empty -> still tried, but keyless (no Authorization header)")
  const realTavilyKey = process.env.SEARCH_API_KEY
  process.env.SEARCH_API_KEY = ""
  let keylessAuthSeen: string | null = null
  installMock((url, init) => {
    if (url.includes("api.tavily.com")) {
      const headers = (init?.headers ?? {}) as Record<string, string>
      keylessAuthSeen = headers.Authorization === undefined ? "absent" : String(headers.Authorization)
      return jsonResponse(200, { results: [{ title: "Tavily keyless", url: "https://t.example", content: "snippet", raw_content: "keyless tavily text" }] })
    }
    if (url.includes("firecrawl")) return jsonResponse(200, firecrawlPayload)
    return jsonResponse(200, bravePayload)
  })
  const keyless = await searchWeb("photosynthesis")
  check("Tavily is still used without a key (keyless access)", keyless.ok && keyless.results[0]?.text === "keyless tavily text")
  check("no Authorization header is sent when keyless", keylessAuthSeen === "absent", keylessAuthSeen ?? "not called")
  if (realTavilyKey !== undefined) process.env.SEARCH_API_KEY = realTavilyKey

  console.log("\n[2a5] SEARCH_PROVIDER=firecrawl forces Firecrawl")
  process.env.SEARCH_PROVIDER = "firecrawl"
  installMock((url) => {
    if (url.includes("firecrawl")) return jsonResponse(200, firecrawlPayload)
    check("no other provider called when Firecrawl is forced", false, url)
    return jsonResponse(200, bravePayload)
  })
  check("forced Firecrawl returns Firecrawl results", (await searchWeb("photosynthesis")).ok)
  delete process.env.SEARCH_PROVIDER

  console.log("\n[2b] Serper request shape + result mapping")
  process.env.FIRECRAWL_API_KEY = ""
  process.env.SERPER_API_KEY = "test-serper-key"
  let serperBody = ""
  let serperHeaders: Record<string, string> = {}
  let serperUrl = ""
  installMock((url, init) => {
    serperUrl = url
    serperHeaders = (init?.headers ?? {}) as Record<string, string>
    serperBody = String(init?.body ?? "")
    return jsonResponse(200, serperPayload)
  })
  const serper = await searchSerper("photosynthesis basics", 5)
  check("Serper call succeeds", serper.ok)
  check("URL is Serper endpoint", serperUrl === "https://google.serper.dev/search", serperUrl)
  check("X-API-KEY header sent", serperHeaders["X-API-KEY"] === "test-serper-key")
  check("body carries q and num", serperBody.includes('"q":"photosynthesis basics"') && serperBody.includes('"num":5'), serperBody)
  if (serper.ok) {
    check("blank-title Serper result skipped", serper.results.length === 1, "got " + serper.results.length)
    const s = serper.results[0]
    check("link mapped to url", s?.url === "https://simple.wikipedia.org/wiki/Photosynthesis")
    check("snippet mapped to snippet+text", s?.snippet === "Photosynthesis is how plants turn light into sugar." && s?.text === s?.snippet)
  }
  installMock((_url, init) => {
    serperBody = String(init?.body ?? "")
    return jsonResponse(200, serperPayload)
  })
  await searchSerper("q", 999)
  check("Serper num clamped to 100", serperBody.includes('"num":100'), serperBody)

  console.log("\n[2c] Chain order: Tavily fails -> Serper is tried before Brave")
  const order: string[] = []
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(402, {})
    if (url.includes("serper.dev")) {
      order.push("serper")
      return jsonResponse(200, serperPayload)
    }
    order.push("brave")
    return jsonResponse(200, bravePayload)
  })
  const mid = await searchWeb("photosynthesis")
  check("chain answered from Serper", mid.ok && order.join(",") === "serper", order.join(","))

  console.log("\n[2d] Serper fails too -> Brave takes over")
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(402, {})
    if (url.includes("serper.dev")) return jsonResponse(401, {})
    return jsonResponse(200, bravePayload)
  })
  const last = await searchWeb("photosynthesis")
  check("falls through to Brave", last.ok && last.results.length === 2)

  console.log("\n[2e] Serper key empty -> skipped, Brave still used")
  process.env.SERPER_API_KEY = ""
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(402, {})
    if (url.includes("serper.dev")) {
      check("Serper never called without a key", false, "it was called")
      return jsonResponse(200, serperPayload)
    }
    return jsonResponse(200, bravePayload)
  })
  const skipped = await searchWeb("photosynthesis")
  check("Brave answers when Serper has no key", skipped.ok && skipped.results.length === 2)
  process.env.SERPER_API_KEY = "test-serper-key"

  console.log("\n[2f] SEARCH_PROVIDER=serper forces Serper")
  process.env.SEARCH_PROVIDER = "serper"
  installMock((url) => {
    if (url.includes("serper.dev")) return jsonResponse(200, serperPayload)
    if (url.includes("api.tavily.com")) {
      check("Tavily not called when Serper is forced", false, "it was called")
      return jsonResponse(200, bravePayload)
    }
    return jsonResponse(200, bravePayload)
  })
  check("forced Serper returns Serper results", (await searchWeb("photosynthesis")).ok)
  delete process.env.SEARCH_PROVIDER

  console.log("\n[3] Tavily fails with 402 -> falls back to Brave")
  process.env.SERPER_API_KEY = ""
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(402, { error: "out of credits" })
    return jsonResponse(200, bravePayload)
  })
  const credits = await searchWeb("photosynthesis")
  check("fallback returned ok", credits.ok)
  check("results came from Brave shape", credits.ok && credits.results.length === 2)

  console.log("\n[4] Tavily fails with 401 -> falls back to Brave")
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(401, { error: "bad key" })
    return jsonResponse(200, bravePayload)
  })
  check("401 falls back", (await searchWeb("photosynthesis")).ok)

  console.log("\n[5] Tavily 429 -> falls back; 432/433 handled too")
  for (const status of [429, 432, 433]) {
    installMock((url) => {
      if (url.includes("api.tavily.com")) return jsonResponse(status, { error: "quota" })
      return jsonResponse(200, bravePayload)
    })
    check("HTTP " + status + " falls back", (await searchWeb("photosynthesis")).ok)
  }

  console.log("\n[6] Tavily network error -> falls back")
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("api.tavily.com")) return Promise.reject(new Error("ECONNRESET"))
    return Promise.resolve(jsonResponse(200, bravePayload))
  }) as typeof fetch
  check("network error falls back", (await searchWeb("photosynthesis")).ok)

  console.log("\n[7] Tavily empty results -> falls back")
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(200, { results: [] })
    return jsonResponse(200, bravePayload)
  })
  check("empty Tavily response falls back to Brave", (await searchWeb("photosynthesis")).ok)

  console.log("\n[8] No Brave key -> fallback skipped, Tavily error reported")
  process.env.BRAVE_API_KEY = ""
  installMock((url) => {
    if (url.includes("api.tavily.com")) return jsonResponse(402, { error: "out of credits" })
    return jsonResponse(200, bravePayload)
  })
  const noBrave = await searchWeb("photosynthesis")
  check("reports failure, does not silently succeed", !noBrave.ok)
  check("credits kind preserved", !noBrave.ok && noBrave.kind === "credits")
  check("message mentions credits", !noBrave.ok && noBrave.message.toLowerCase().includes("credits"))

  console.log("\n[9] Both providers fail -> clear error, no crash")
  process.env.BRAVE_API_KEY = "test-brave-key"
  installMock((url) => (url.includes("api.tavily.com") ? jsonResponse(402, {}) : jsonResponse(403, {})))
  const bothDown = await searchWeb("photosynthesis")
  check("returns a failure outcome", !bothDown.ok)
  check("kind is service", !bothDown.ok && bothDown.kind === "service")
  check("message is clear", !bothDown.ok && bothDown.message.includes("every configured provider failed"))

  console.log("\n[10] Both empty -> ok with zero results (ungrounded path preserved)")
  installMock(() => jsonResponse(200, {}))
  const bothEmpty = await searchWeb("blorptancous rainbow tetratic neurogenesis")
  check("ok with 0 results", bothEmpty.ok && bothEmpty.results.length === 0)

  console.log("\n[11] SEARCH_PROVIDER=tavily never falls back")
  process.env.SEARCH_PROVIDER = "tavily"
  installMock((url) => (url.includes("api.tavily.com") ? jsonResponse(402, {}) : jsonResponse(200, bravePayload)))
  const forced = await searchWeb("photosynthesis")
  check("tavily-only returns Tavily failure", !forced.ok)
  delete process.env.SEARCH_PROVIDER

  globalThis.fetch = realFetch
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " CHECK(S) FAILED")
  process.exit(failures === 0 ? 0 : 1)
}

main()
