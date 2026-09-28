import * as fs from "fs"
import * as path from "path"
import { searchWeb } from "../src/lib/search"

function loadEnv(): void {
  const files = [path.resolve(__dirname, "../.env.local"), path.resolve(process.cwd(), ".env.local")]
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === "" || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (process.env[key] === undefined) {
        process.env[key] = trimmed.slice(eq + 1).trim()
      }
    }
    return
  }
}

loadEnv()

const realTavily = process.env.SEARCH_API_KEY ?? ""
const braveKey = (process.env.BRAVE_API_KEY ?? "").trim()
const serperKey = (process.env.SERPER_API_KEY ?? "").trim()
const firecrawlKey = (process.env.FIRECRAWL_API_KEY ?? "").trim()

async function report(label: string, query: string): Promise<void> {
  console.log("\n--- " + label + " ---")
  const outcome = await searchWeb(query)
  if (outcome.ok) {
    console.log("RESULT: ok, " + outcome.results.length + " result(s)")
    for (const r of outcome.results.slice(0, 3)) {
      console.log("   - " + r.title.slice(0, 80))
      console.log("     " + r.url)
      console.log("     textChars=" + r.text.length + " snippetChars=" + r.snippet.length)
    }
  } else {
    console.log("RESULT: failed (" + outcome.kind + ") -> " + outcome.message)
  }
}

async function main(): Promise<void> {
  const query = process.argv[2] ?? "photosynthesis"
  console.log("Tavily key configured: " + (realTavily.trim() !== "" ? "yes" : "no (keyless)"))
  console.log("Firecrawl key configured: " + (firecrawlKey !== "" ? "yes" : "no (will be skipped)"))
  console.log("Serper key configured: " + (serperKey !== "" ? "yes" : "no (will be skipped)"))
  console.log("Brave key configured: " + (braveKey !== "" ? "yes" : "no (will be skipped)"))

  if (firecrawlKey === "" && serperKey === "" && braveKey === "") {
    console.log("\nNo backup provider is configured, so there is nothing to fall back to.")
    console.log("Set FIRECRAWL_API_KEY, SERPER_API_KEY and/or BRAVE_API_KEY in .env.local, then run this again.")
  }

  process.env.SEARCH_PROVIDER = "auto"
  if (firecrawlKey !== "") {
    process.env.FIRECRAWL_API_KEY = ""
    await report("Test 1: Firecrawl (primary) unavailable -> expect Tavily", query)
    process.env.FIRECRAWL_API_KEY = firecrawlKey
  } else {
    process.env.SEARCH_API_KEY = "invalid-key-for-fallback-test"
    await report("Test 1: no Firecrawl key and Tavily forced to fail -> expect Serper, then Brave", query)
  }

  if (firecrawlKey !== "") {
    process.env.SEARCH_PROVIDER = "firecrawl"
    await report("Test 2: Firecrawl (primary) forced directly", query)
  }

  if (realTavily.trim() !== "") {
    process.env.SEARCH_PROVIDER = "tavily"
    await report("Test 3: Tavily (first backup) forced directly", query)
  }

  if (serperKey !== "") {
    process.env.SEARCH_PROVIDER = "serper"
    await report("Test 4: Serper forced directly", query)
  }

  if (braveKey !== "") {
    process.env.SEARCH_PROVIDER = "brave"
    await report("Test 5: Brave forced directly", query)
  }

  process.env.SEARCH_PROVIDER = "auto"
  process.env.SEARCH_API_KEY = realTavily
  await report("Test 6: normal run (expect the primary provider)", query)
}

main()
