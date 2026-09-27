import * as fs from "fs"
import * as path from "path"
import { isUsableGrounding, rankResults, buildGroundingBlock, minUsableTextChars } from "../src/lib/grounding"
import { getCachedSearch, searchCacheKey, searchWithCache } from "../src/lib/searchCache"

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

async function run(label: string, query: string) {
  console.log("\n================================================================")
  console.log("TOPIC: " + label + "  |  query: " + quote(query))
  console.log("================================================================\n")

  const outcome = await searchWithCache(query)
  if (!outcome.ok) {
    console.log("SEARCH FAILED: " + outcome.message)
    return
  }

  console.log("Tavily returned " + outcome.results.length + " raw result(s).")
  const ranked = rankResults(outcome.results)
  console.log("After ranking/dedupe/blocklist: " + ranked.length + " kept.\n")

  const usable = isUsableGrounding(ranked)
  for (const r of ranked) {
    console.log(
      "[" +
        r.rank +
        "] " +
        r.title +
        "\n    " +
        r.url +
        "\n    textChars=" +
        r.text.length +
        "  snippetChars=" +
        r.snippet.length,
    )
  }

  console.log(
    "\nUsable grounding: " +
      usable +
      " (needs >= " +
      minUsableTextChars() +
      " chars of clean text from at least one kept source)\n",
  )

  const block = buildGroundingBlock(ranked)
  console.log("--- grounding block (first " + Math.min(block.length, 600) + " chars) ---")
  console.log(block.slice(0, 600).replace(/\n/g, "\\n\\n") + (block.length > 600 ? " …" : ""))
  console.log("----------------------------------------------------------------")

  const key = searchCacheKey(query)
  const cached = await getCachedSearch(key)
  console.log("Cache check: key=" + key.slice(0, 12) + "… cached=" + (cached !== null ? cached.length + " results (disk/mem hit)" : "miss"))
}

function quote(s: string): string {
  return '"' + s + '"'
}

const topics = process.argv.slice(2)
if (topics.length === 0) {
  topics.push("photosynthesis", "blorptancous rainbow tetratic neurogenesis")
}

async function main() {
  for (const t of topics) {
    await run(t, t)
  }
  console.log("\nDone.")
}

main()