"use client"

import type { StudySession } from "@/lib/types"
import { addDays, todayStr } from "@/lib/dates"

interface HistoryProps {
  sessions: StudySession[]
  onClearAll: () => void
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function currentStreak(sessions: StudySession[]): number {
  const dates = new Set(sessions.map((s) => s.date))
  let cursor = todayStr()
  if (!dates.has(cursor)) {
    cursor = addDays(cursor, -1)
  }
  let streak = 0
  while (dates.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

export function History({ sessions, onClearAll }: HistoryProps) {
  const totalSessions = sessions.length
  const totalStudied = sessions.reduce((n, s) => n + s.studied, 0)
  const totalCorrect = sessions.reduce((n, s) => n + s.correct, 0)
  const accuracy = totalStudied > 0 ? Math.round((totalCorrect / totalStudied) * 100) : 0
  const streak = currentStreak(sessions)

  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-lg font-semibold">History</h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Sessions</dt>
            <dd className="mt-1 text-xl font-semibold">{totalSessions}</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Cards studied</dt>
            <dd className="mt-1 text-xl font-semibold">{totalStudied}</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Accuracy</dt>
            <dd className="mt-1 text-xl font-semibold">{accuracy}%</dd>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Streak</dt>
            <dd className="mt-1 text-xl font-semibold">{streak} day{streak === 1 ? "" : "s"}</dd>
          </div>
        </dl>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No study sessions yet. Finish a study session and it will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((s) => {
            const acc = s.studied > 0 ? Math.round((s.correct / s.studied) * 100) : 0
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.setTitle}</span>
                    {s.type === "quiz" && (
                      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                        Quiz
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-500">{formatDate(s.date)}</div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div>{s.studied} studied</div>
                  <div className={acc >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
                    {acc}% correct
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          if (
            window.confirm(
              "Clear all data? Your focus, card sets, and study history will be permanently deleted.",
            )
          ) {
            onClearAll()
          }
        }}
        className="self-start rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        Clear all data
      </button>
    </div>
  )
}