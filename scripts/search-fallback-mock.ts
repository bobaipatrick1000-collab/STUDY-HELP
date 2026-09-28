import { searchBrave, searchWeb } from "../src/lib/search"

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

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  console.log((condition ? "PASS " : "FAIL ") + label + (detail !== "" ? " -> " + detail : ""))
  if (!condition) failures++
}

async function main(): Promise<void> {
  process.env.BRAVE_API_KEY = "test-brave-key"

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

  console.log("\n[3] Tavily fails with 402 -> falls back to Brave")
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
  check("message is clear", !bothDown.ok && bothDown.message.includes("both failed"))

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
