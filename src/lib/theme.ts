export type Theme = "light" | "dark"

const KEY = "fc:theme"

export function readTheme(): Theme {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(KEY)
      if (stored === "light" || stored === "dark") return stored
    } catch {
      // ignore
    }
  }
  return "light"
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", theme === "dark")
  try {
    window.localStorage.setItem(KEY, theme)
  } catch {
    // ignore
  }
}