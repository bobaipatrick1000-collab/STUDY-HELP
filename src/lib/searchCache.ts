import { createHash } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { searchWeb } from "./search"
import type { SearchResult, SearchOutcome } from "./search"

const mem = new Map<string, { at: number; results: SearchResult[] }>()

export function searchCacheKey(query: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ")
  return createHash("sha256").update("tavily|" + normalized).digest("hex")
}

function ttlMs(): number {
  const hours = Number(process.env.SEARCH_CACHE_TTL_HOURS)
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 7 * 24 * 3_600_000
}

function cacheDir(): string {
  return path.join(process.cwd(), ".cache", "search")
}

function cachePath(key: string): string {
  return path.join(cacheDir(), key + ".json")
}

export async function getCachedSearch(key: string): Promise<SearchResult[] | null> {
  const before = Date.now()
  const memHit = mem.get(key)
  if (memHit && before - memHit.at <= ttlMs()) return memHit.results
  if (memHit) mem.delete(key)

  try {
    const raw = await readFile(cachePath(key), "utf8")
    const entry = JSON.parse(raw) as { at: number; results: SearchResult[] }
    if (!Number.isFinite(entry.at) || !Array.isArray(entry.results)) return null
    const at = entry.at
    if (before - at > ttlMs()) return null
    mem.set(key, { at, results: entry.results })
    return entry.results
  } catch {
    return null
  }
}

export async function setCachedSearch(key: string, results: SearchResult[]): Promise<void> {
  mem.set(key, { at: Date.now(), results })
  try {
    const dir = cacheDir()
    await mkdir(dir, { recursive: true })
    await writeFile(cachePath(key), JSON.stringify({ at: Date.now(), results }), "utf8")
  } catch {
    // Cache write failures are non-fatal: the caller still has the results.
  }
}

export async function searchWithCache(
  query: string,
  opts: { fresh?: boolean } = {},
): Promise<SearchOutcome> {
  const key = searchCacheKey(query)
  if (!opts.fresh) {
    const cached = await getCachedSearch(key)
    if (cached) return { ok: true, results: cached }
  }
  const outcome = await searchWeb(query)
  if (outcome.ok) {
    await setCachedSearch(key, outcome.results)
  }
  return outcome
}