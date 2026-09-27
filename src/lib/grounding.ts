import type { SearchResult } from "./search"
import type { TopicSource } from "./types"

export interface RankedResult extends SearchResult {
  rank: number
}

export function minUsableTextChars(): number {
  const raw = Number(process.env.SEARCH_MIN_USABLE_CHARS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 600
}

const REPUTABLE_DOMAINS: Record<string, number> = {
  "wikipedia.org": 90,
  "britannica.com": 90,
  "merriam-webster.com": 70,
  "khanacademy.org": 80,
  "openstax.org": 85,
  "libretexts.org": 85,
  "coursera.org": 60,
  "edx.org": 60,
  "ocw.mit.edu": 95,
  "nih.gov": 90,
  "pubmed.ncbi.nlm.nih.gov": 95,
  "cdc.gov": 95,
  "who.int": 90,
  "nature.com": 80,
  "science.org": 80,
  "springer.com": 70,
  "apnews.com": 70,
  "reuters.com": 70,
  "bbc.co.uk": 70,
  "bbc.com": 70,
}

const LOW_QUALITY_DOMAINS: Record<string, number> = {
  "reddit.com": -120,
  "quora.com": -120,
  "answers.yahoo.com": -140,
  "answers.com": -120,
  "wikihow.com": -110,
  "fandom.com": -100,
  "medium.com": -60,
  "blogspot.com": -130,
  "wordpress.com": -130,
  "wixsite.com": -140,
  "weebly.com": -140,
  "tumblr.com": -140,
  "ranker.com": -120,
  "buzzfeed.com": -100,
  "thefreedictionary.com": -60,
  "youtube.com": -60,
  "biorxiv.org": -20,
}

const LOW_QUALITY_PATTERNS = [
  /\.blogspot\./i,
  /\.wordpress\./i,
  /\.wixsite\./i,
  /\.weebly\./i,
  /\.tumblr\./i,
]

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return url.toLowerCase()
  }
}

function domainScore(url: string): number {
  const host = hostnameOf(url)

  if (host === "ocw.mit.edu") return 95
  if (host.endsWith(".edu")) return 100
  if (host.endsWith(".gov")) return 100
  if (host.endsWith(".ac.uk")) return 100
  if (host.endsWith(".edu.au")) return 100
  if (host.endsWith(".edu.cn")) return 95

  for (const [key, score] of Object.entries(REPUTABLE_DOMAINS)) {
    if (host === key || host.endsWith("." + key)) return score
  }

  if (LOW_QUALITY_PATTERNS.some((re) => re.test(url))) return -130

  for (const [key, score] of Object.entries(LOW_QUALITY_DOMAINS)) {
    if (host === key || host.endsWith("." + key)) return score
  }

  return 0
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "fbclid" ||
        key === "gclid" ||
        key === "mc_cid" ||
        key === "mc_eid" ||
        key === "ref" ||
        key === "source" ||
        key === "feature" ||
        key === "via"
      ) {
        u.searchParams.delete(key)
      }
    }
    return u.toString()
  } catch {
    return url
  }
}

interface ScoredResult extends SearchResult {
  score: number
  order: number
}

export function rankResults(results: SearchResult[]): RankedResult[] {
  const seen = new Set<string>()
  const scored: ScoredResult[] = []

  for (const result of results) {
    const url = normalizeUrl(result.url)
    if (seen.has(url)) continue
    seen.add(url)

    const score = domainScore(url)
    if (score <= -150) continue

    scored.push({ ...result, url, score, order: scored.length })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.order - b.order
  })

  return scored.map((s, i) => ({
    title: s.title,
    url: s.url,
    snippet: s.snippet,
    text: s.text,
    rank: i + 1,
  }))
}

export function isUsableGrounding(ranked: RankedResult[]): boolean {
  return ranked.some((r) => r.text.length >= minUsableTextChars())
}

export function groundingBudgetChars(): number {
  const raw = Number(process.env.SEARCH_BUDGET_CHARS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24000
}

export function buildSourceList(sources: TopicSource[]): string {
  if (sources.length === 0) return ""
  return sources
    .map((s, i) => "[" + (i + 1) + "] " + s.title + " — " + s.url)
    .join("\n")
}

export function buildGroundingBlock(ranked: RankedResult[], opts: { budgetChars?: number } = {}): string {
  const budget = opts.budgetChars ?? groundingBudgetChars()
  const lines: string[] = ["Web sources (base all factual content on these; cite facts as [n]):"]
  let used = 0
  for (const r of ranked) {
    const remaining = budget - used
    if (remaining <= 0) break
    const header = "[" + r.rank + "] " + r.title + " — " + r.url
    const body = r.text !== "" ? r.text : r.snippet
    const kept = body.slice(0, Math.max(remaining - header.length - 1, 0))
    if (kept.length === 0) break
    lines.push("", header, kept)
    used += header.length + kept.length + 1
  }
  return lines.join("\n")
}