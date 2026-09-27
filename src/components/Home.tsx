"use client"

import type { CardSet } from "@/lib/types"
import { todayStr } from "@/lib/dates"

interface HomeProps {
  sets: CardSet[]
  onAddNotes: () => void
  onSearchTopic: () => void
  onStudy: (target: string) => void
  onViewSet: (id: string) => void
  onDeleteSet: (id: string) => void
}

function dueCount(set: CardSet): number {
  const today = todayStr()
  return set.cards.filter((c) => c.dueDate <= today).length
}

export function Home({ sets, onAddNotes, onSearchTopic, onStudy, onViewSet, onDeleteSet }: HomeProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAddNotes}
          className="flex-1 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add notes
        </button>
        <button
          type="button"
          onClick={() => onStudy("all")}
          className="flex-1 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Study
        </button>
      </div>

      <button
        type="button"
        onClick={onSearchTopic}
        className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Search a topic
      </button>

      <div>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your card sets
        </h2>

        {sets.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Add your first notes.
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {sets.map((set) => {
            const due = dueCount(set)
            return (
              <li
                key={set.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{set.title}</div>
                  {set.type === "topic" && (
                    <div className="text-xs text-zinc-500">Topic study pack</div>
                  )}
                  <div className="text-sm text-zinc-500">
                    {set.cards.length} card{set.cards.length === 1 ? "" : "s"} ·{" "}
                    <span className={due > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : ""}>
                      {due} due today
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onStudy(set.id)}
                    className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                    disabled={set.cards.length === 0}
                  >
                    Study
                  </button>
                  <button
                    type="button"
                    onClick={() => onViewSet(set.id)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {set.type === "topic" ? "Open pack" : "View notes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete the set "${set.title}" and all its cards?`)) {
                        onDeleteSet(set.id)
                      }
                    }}
                    aria-label={`Delete set ${set.title}`}
                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}