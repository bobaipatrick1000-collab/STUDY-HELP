import type { CardSet, StudySession } from "./types"

const KEYS = {
  focus: "fc:focus",
  sets: "fc:sets",
  sessions: "fc:sessions",
} as const

const isBrowser = () => typeof window !== "undefined"

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function loadFocus(): string {
  if (!isBrowser()) return ""
  try {
    return window.localStorage.getItem(KEYS.focus) ?? ""
  } catch {
    return ""
  }
}

export function saveFocus(focus: string): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(KEYS.focus, focus.trim())
  } catch {
    // storage unavailable or full; nothing sensible to do
  }
}

export function loadSets(): CardSet[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(KEYS.sets)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as CardSet[]
  } catch {
    return []
  }
}

export function saveSets(sets: CardSet[]): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(KEYS.sets, JSON.stringify(sets))
  } catch {
    // storage full or unavailable; no-op
  }
}

export function loadSessions(): StudySession[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(KEYS.sessions)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as StudySession[]
  } catch {
    return []
  }
}

export function saveSessions(sessions: StudySession[]): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(KEYS.sessions, JSON.stringify(sessions))
  } catch {
    // storage full or unavailable; no-op
  }
}

export function clearAllData(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(KEYS.focus)
    window.localStorage.removeItem(KEYS.sets)
    window.localStorage.removeItem(KEYS.sessions)
  } catch {
    // ignore
  }
}