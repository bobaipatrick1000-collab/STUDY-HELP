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
  console.log("Brave key configured: " + (braveKey !== "" ? "yes" : "no (fallback will be skipped)"))
  console.log("Tavily key configured: " + (realTavily.trim() !== "" ? "yes" : "no"))

  if (braveKey === "") {
    console.log("\nBRAVE_API_KEY is empty, so there is nothing to fall back to.")
    console.log("Set BRAVE_API_KEY in .env.local and run this script again.")
    return
  }

  process.env.SEARCH_PROVIDER = "auto"
  process.env.SEARCH_API_KEY = "invalid-key-for-fallback-test"
  await report("Test 1: Tavily forced to fail (invalid key) -> expect Brave", query)

  process.env.SEARCH_PROVIDER = "brave"
  await report("Test 2: Brave forced directly", query)

  process.env.SEARCH_PROVIDER = "auto"
  process.env.SEARCH_API_KEY = realTavily
  await report("Test 3: normal run with the real Tavily key", query)
}

main()
