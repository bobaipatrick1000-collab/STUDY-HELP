"use client"

import { useState } from "react"
import type { CardSet, DraftState } from "@/lib/types"
import { CARD_COUNTS } from "@/lib/constants"
import { todayStr } from "@/lib/dates"
import { uid } from "@/lib/storage"

interface NotesViewProps {
  set: CardSet
  focus: string
  onUpdateSets: (updater: (prev: CardSet[]) => CardSet[]) => void
  onStudy: () => void
  onDone: () => void
}

type GenPhase = "idle" | "loading" | "done"

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function NotesView({ set, focus, onUpdateSets, onStudy, onDone }: NotesViewProps) {
  const hasNotes = (set.notes ?? "").trim().length > 0
  const sources = set.sources ?? []
  const [count, setCount] = useState<(typeof CARD_COUNTS)[number]>(10)
  const [phase, setPhase] = useState<GenPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(0)

  async function generateMore() {
    if (!hasNotes) return
    setPhase("loading")
    setError(null)
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus, notes: set.notes, count }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        cards?: DraftState[]
      }
      if (res.status === 429) {
        setError(
          "The AI hit its rate limit. Wait about a minute, then try again.",
        )
        setPhase("idle")
        return
      }
      if (!data.ok || !data.cards) {
        setError(data.error || "Something went wrong while generating cards.")
        setPhase("idle")
        return
      }
      const today = todayStr()
      const newCards = data.cards.map((c) => ({
        id: uid(),
        question: c.question,
        answer: c.answer,
        interval: 0,
        dueDate: today,
      }))
      onUpdateSets((prev) =>
        prev.map((s) => (s.id === set.id ? { ...s, cards: [...s.cards, ...newCards] } : s)),
      )
      setAdded(newCards.length)
      setPhase("done")
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
      setPhase("idle")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Notes — {set.title}</h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {hasNotes ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {set.notes}
          </p>
        ) : (
          <p className="text-sm text-zinc-500">
            Original notes not saved for this set.
          </p>
        )}
        {sources.length > 0 && (
          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Sources ({sources.length})
            </div>
            <ul className="flex flex-col gap-1">
              {sources.map((s, i) => (
                <li key={s.url + i} className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="mr-1 text-xs text-zinc-400">[{i + 1}]</span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400"
                  >
                    {s.title}
                  </a>
                  <span className="ml-1 text-xs text-zinc-500">— {hostnameOf(s.url)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onStudy}
        disabled={set.cards.length === 0}
        className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Study these notes now
      </button>

      {hasNotes && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Generating more cards from these notes…
              </p>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Added {added} new card{added === 1 ? "" : "s"} to this set. It now has{" "}
                {set.cards.length} card{set.cards.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPhase("idle")
                  setError(null)
                }}
                className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Add more
              </button>
            </div>
          )}

          {(phase === "idle" || phase === "done") && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Generate more cards from these notes
                </div>
                <div className="flex gap-2">
                  {CARD_COUNTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCount(n)}
                      aria-pressed={count === n}
                      className={
                        count === n
                          ? "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={generateMore}
                className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                {error ? "Try again" : "Generate from notes"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}