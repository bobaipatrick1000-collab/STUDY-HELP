"use client"

import { useState } from "react"
import type { CardSet, Flashcard, Grade, StudySession } from "@/lib/types"
import { todayStr } from "@/lib/dates"
import { applyGrade } from "@/lib/schedule"
import { uid } from "@/lib/storage"
import { Quiz } from "./Quiz"

interface QueueItem {
  setId: string
  setTitle: string
  card: Flashcard
}

interface StudyProps {
  sets: CardSet[]
  autoStartId?: string
  autoQuizStartId?: string
  onUpdateSets: (updater: (prev: CardSet[]) => CardSet[]) => void
  onSaveSession: (session: StudySession) => void
  onDone: () => void
}

type Phase = "pick" | "study" | "summary"
type Mode = "flashcards" | "quiz"

interface ScanResult {
  items: QueueItem[]
  sid: string
  sTitle: string
}

function scan(sets: CardSet[], targetId: string, today: string): ScanResult {
  if (targetId === "all") {
    const items: QueueItem[] = []
    for (const set of sets) {
      for (const card of set.cards) {
        if (card.dueDate <= today) {
          items.push({ setId: set.id, setTitle: set.title, card })
        }
      }
    }
    return { items, sid: "all", sTitle: "All due cards" }
  }
  const set = sets.find((s) => s.id === targetId)
  if (!set) {
    return { items: [], sid: targetId, sTitle: targetId }
  }
  return {
    items: set.cards
      .filter((c) => c.dueDate <= today)
      .map((card) => ({ setId: set.id, setTitle: set.title, card })),
    sid: set.id,
    sTitle: set.title,
  }
}

function noDueMessage(targetId: string): string {
  return targetId === "all"
    ? "Nothing is due today. Add new notes or come back tomorrow."
    : "Nothing is due today for this set."
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function Study({ sets, autoStartId, autoQuizStartId, onUpdateSets, onSaveSession, onDone }: StudyProps) {
  const today = todayStr()
  const initialAuto = autoStartId ? scan(sets, autoStartId, today) : null

  const [phase, setPhase] = useState<Phase>(() =>
    initialAuto && initialAuto.items.length > 0 ? "study" : "pick",
  )
  const [mode, setMode] = useState<Mode>("flashcards")
  const [queue, setQueue] = useState<QueueItem[]>(() => (initialAuto ? initialAuto.items : []))
  const [recordSetId, setRecordSetId] = useState(() => initialAuto?.sid ?? "all")
  const [recordTitle, setRecordTitle] = useState(() => initialAuto?.sTitle ?? "All due cards")
  const [message, setMessage] = useState<string | null>(() =>
    autoStartId && initialAuto && initialAuto.items.length === 0
      ? noDueMessage(autoStartId)
      : null,
  )
  const [revealed, setRevealed] = useState(false)
  const [studied, setStudied] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [quizSetId, setQuizSetId] = useState<string | null>(() => autoQuizStartId ?? null)

  function setDue(id: string): number {
    const set = sets.find((s) => s.id === id)
    if (!set) return 0
    return set.cards.filter((c) => c.dueDate <= today).length
  }

  function totalDue(): number {
    return sets.reduce((n, s) => n + s.cards.filter((c) => c.dueDate <= today).length, 0)
  }

  function start(targetId: string) {
    const result = scan(sets, targetId, today)
    setRecordSetId(result.sid)
    setRecordTitle(result.sTitle)
    setStudied(0)
    setCorrect(0)
    setRevealed(false)
    if (result.items.length === 0) {
      setMessage(noDueMessage(targetId))
      setQueue([])
      setPhase("pick")
      return
    }
    setMessage(null)
    setQueue(result.items)
    setPhase("study")
  }

  function finalize(sid: string, sTitle: string, nStudied: number, nCorrect: number) {
    onSaveSession({
      id: uid(),
      date: today,
      setId: sid,
      setTitle: sTitle,
      studied: nStudied,
      correct: nCorrect,
      type: "flashcards",
    })
    setPhase("summary")
  }

  function grade(g: Grade) {
    const current = queue[0]
    if (!current) return
    const graded = applyGrade(current.card, g, today)
    onUpdateSets((prev) =>
      prev.map((set) =>
        set.id === current.setId
          ? {
              ...set,
              cards: set.cards.map((c) => (c.id === graded.id ? graded : c)),
            }
          : set,
      ),
    )
    const rest = queue.slice(1)
    const nextQueue = g === "again" ? [...rest, { ...current, card: graded }] : rest
    const nextStudied = studied + 1
    const nextCorrect = correct + (g === "again" ? 0 : 1)
    setStudied(nextStudied)
    setCorrect(nextCorrect)
    setRevealed(false)
    if (nextQueue.length === 0) {
      finalize(recordSetId, recordTitle, nextStudied, nextCorrect)
      return
    }
    setQueue(nextQueue)
  }

  function handleQuizSet(id: string) {
    const set = sets.find((s) => s.id === id)
    if (!set) return
    if (set.cards.length < 4) {
      setMode("flashcards")
      setMessage(
        `"${set.title}" only has ${set.cards.length} cards, which isn't enough material for a multiple choice quiz. You've been switched to flashcard mode instead.`,
      )
      start(set.id)
      return
    }
    setMessage(null)
    setQuizSetId(set.id)
  }

  const quizSet = quizSetId ? sets.find((s) => s.id === quizSetId) ?? null : null

  if (quizSet) {
    return (
      <div className="flex flex-col gap-4">
        <Quiz
          set={quizSet}
          onUpdateSets={onUpdateSets}
          onSaveSession={onSaveSession}
          onExit={() => setQuizSetId(null)}
          onDone={onDone}
        />
      </div>
    )
  }

  if (phase === "pick") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">What would you like to study?</h2>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("flashcards")}
            className={
              mode === "flashcards"
                ? "flex-1 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "flex-1 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            }
          >
            Flashcards
          </button>
          <button
            type="button"
            onClick={() => setMode("quiz")}
            className={
              mode === "quiz"
                ? "flex-1 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "flex-1 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            }
          >
            Multiple choice
          </button>
        </div>

        {message && (
          <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {message}
          </p>
        )}

        {mode === "flashcards" ? (
          <>
            <button
              type="button"
              onClick={() => start("all")}
              disabled={totalDue() === 0}
              className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              All due cards ({totalDue()})
            </button>
            <ul className="flex flex-col gap-2">
              {sets.map((set) => {
                const due = setDue(set.id)
                return (
                  <li key={set.id}>
                    <button
                      type="button"
                      onClick={() => start(set.id)}
                      disabled={due === 0}
                      className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span className="truncate font-medium">{set.title}</span>
                      <span className="text-sm text-zinc-500">{due} due today</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Pick a set. Due cards come first, then your least-recently quizzed cards fill
              the rest. Sets with fewer than 4 cards switch back to flashcards.
            </p>
            <ul className="flex flex-col gap-2">
              {sets.map((set) => {
                const due = setDue(set.id)
                const short = set.cards.length < 4
                return (
                  <li key={set.id}>
                    <button
                      type="button"
                      onClick={() => handleQuizSet(set.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{set.title}</span>
                        <span className="block text-sm text-zinc-500">
                          {set.cards.length} card{set.cards.length === 1 ? "" : "s"}
                          {short ? " — too few for a quiz" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-zinc-500">{due} due today</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {sets.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No card sets yet. Add notes first.
          </p>
        )}
        <button
          type="button"
          onClick={onDone}
          className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>
    )
  }

  if (phase === "summary") {
    const accuracy = studied > 0 ? Math.round((correct / studied) * 100) : 0
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Session complete</h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Studied</dt>
            <dd className="mt-1 text-2xl font-semibold">{studied}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Good / Easy</dt>
            <dd className="mt-1 text-2xl font-semibold">{correct}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Accuracy</dt>
            <dd className="mt-1 text-2xl font-semibold">{accuracy}%</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Done
        </button>
      </div>
    )
  }

  const current = queue[0]

  if (!current) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Session is empty.</p>
        <button
          type="button"
          onClick={() => setPhase("pick")}
          className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {queue.length} card{queue.length === 1 ? "" : "s"} left
        </span>
        <button
          type="button"
          onClick={() => {
            if (studied === 0) {
              setPhase("pick")
            } else {
              finalize(recordSetId, recordTitle, studied, correct)
            }
          }}
          className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          End session
        </button>
      </div>

      <button
        type="button"
        onClick={() => setRevealed(!revealed)}
        className="flex min-h-56 cursor-pointer flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 text-left dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Question</div>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
            {current.card.question}
          </p>
        </div>
        {revealed ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Answer</div>
              <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed">
                {current.card.answer}
              </p>
            </div>
            {(() => {
              const set = sets.find((s) => s.id === current.setId)
              const sources = set?.sources ?? []
              if (sources.length === 0) return null
              return (
                <div className="rounded-lg bg-white p-3 text-left dark:bg-zinc-900">
                  <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    Sources ({sources.length})
                  </div>
                  <ul className="flex flex-col gap-1">
                    {sources.map((s, i) => (
                      <li key={s.url + i} className="text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="mr-1 text-zinc-400">[{i + 1}]</span>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-400"
                        >
                          {s.title}
                        </a>
                        <span className="ml-1 text-zinc-500">— {hostnameOf(s.url)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })()}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-3 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Tap to reveal the answer
          </div>
        )}
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => grade("again")}
          disabled={!revealed}
          className="flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          Again
        </button>
        <button
          type="button"
          onClick={() => grade("good")}
          disabled={!revealed}
          className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Good
        </button>
        <button
          type="button"
          onClick={() => grade("easy")}
          disabled={!revealed}
          className="flex-1 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Easy
        </button>
      </div>
    </div>
  )
}