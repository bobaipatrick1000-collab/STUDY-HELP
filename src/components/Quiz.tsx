"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CardSet, Flashcard, StudySession } from "@/lib/types"
import { QUIZ_COUNTS } from "@/lib/constants"
import { todayStr } from "@/lib/dates"
import { uid } from "@/lib/storage"
import { buildQuizPool, shuffle } from "@/lib/quiz"

interface QuizProps {
  set: CardSet
  onUpdateSets: (updater: (prev: CardSet[]) => CardSet[]) => void
  onSaveSession: (session: StudySession) => void
  onExit: () => void
  onDone: () => void
}

interface Plan {
  card: Flashcard
  question: string
  answer: string
  options: string[]
}

interface QuizOptionsResponse {
  options?: { cardId: string; choices: string[] }[]
}

type Phase = "setup" | "loading" | "play" | "results"

export function Quiz({ set, onUpdateSets, onSaveSession, onExit, onDone }: QuizProps) {
  const today = todayStr()
  const available = set.cards.length

  const [phase, setPhase] = useState<Phase>("setup")
  const [error, setError] = useState<string | null>(null)

  const [countKey, setCountKey] = useState<string>(available >= 5 ? "5" : "all")
  const [plans, setPlans] = useState<Plan[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [correct, setCorrect] = useState(0)
  const [missed, setMissed] = useState<Flashcard[]>([])

  const plansRef = useRef<Plan[]>([])
  const indexRef = useRef(0)
  const correctRef = useRef(0)
  const missedRef = useRef<Flashcard[]>([])
  const selectedRef = useRef<string | null>(null)
  const savedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const finish = useCallback(() => {
    if (savedRef.current) return
    savedRef.current = true
    onSaveSession({
      id: uid(),
      date: today,
      setId: set.id,
      setTitle: set.title,
      studied: plansRef.current.length,
      correct: correctRef.current,
      type: "quiz",
    })
    setPhase("results")
  }, [today, onSaveSession, set])

  const advance = useCallback(() => {
    if (selectedRef.current === null) return
    if (indexRef.current >= plansRef.current.length - 1) {
      finish()
      return
    }
    indexRef.current += 1
    selectedRef.current = null
    setIndex(indexRef.current)
    setSelected(null)
  }, [finish])

  const advanceRef = useRef<() => void>(() => {})
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  useEffect(() => {
    if (selected === null) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = window.setTimeout(() => {
      advanceRef.current()
    }, 1600)
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [selected])

  const counts = [
    ...QUIZ_COUNTS.map((n) => ({
      key: String(n),
      label: `${n} questions`,
      value: n,
      disabled: n > available,
    })),
    { key: "all", label: `All cards (${available})`, value: available, disabled: false },
  ]

  if (available < 4) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This set has fewer than 4 cards, which is not enough material for a multiple choice
          quiz. Switch to flashcard mode instead.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>
    )
  }

  function persistQuizzed(cardIds: string[]) {
    onUpdateSets((prev) =>
      prev.map((s) =>
        s.id !== set.id
          ? s
          : {
              ...s,
              cards: s.cards.map((c) =>
                cardIds.includes(c.id) ? { ...c, lastQuizzedAt: Date.now() } : c,
              ),
            },
      ),
    )
  }

  function persistChoices(choices: Record<string, string[]>) {
    onUpdateSets((prev) =>
      prev.map((s) =>
        s.id !== set.id
          ? s
          : {
              ...s,
              cards: s.cards.map((c) => (choices[c.id] ? { ...c, quizChoices: choices[c.id] } : c)),
            },
      ),
    )
  }

  function begin(poolCards: Flashcard[], choiceOverride: Record<string, string[]>) {
    const ordered = shuffle(poolCards)
    const built: Plan[] = ordered.map((card) => {
      const choices = choiceOverride[card.id] ?? card.quizChoices ?? []
      return {
        card,
        question: card.question,
        answer: card.answer,
        options: shuffle([card.answer, ...choices]),
      }
    })
    plansRef.current = built
    indexRef.current = 0
    correctRef.current = 0
    missedRef.current = []
    selectedRef.current = null
    savedRef.current = false
    setPlans(built)
    setIndex(0)
    setCorrect(0)
    setMissed([])
    setSelected(null)
    setPhase("play")
  }

  function pick(option: string) {
    if (selectedRef.current !== null) return
    selectedRef.current = option
    setSelected(option)
    const plan = plansRef.current[indexRef.current]
    if (option === plan.answer) {
      correctRef.current += 1
      setCorrect(correctRef.current)
    } else {
      missedRef.current = [...missedRef.current, plan.card]
      setMissed(missedRef.current)
    }
  }

  function clearSelectionForNext() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    advance()
  }

  async function runQuiz(value: number) {
    setPhase("loading")
    setError(null)
    const poolCards = buildQuizPool(set.cards, value, today)
    persistQuizzed(poolCards.map((c) => c.id))
    const existing: Record<string, string[]> = {}
    for (const card of poolCards) {
      if (card.quizChoices && card.quizChoices.length === 3) {
        existing[card.id] = card.quizChoices
      }
    }
    const need = poolCards.filter((c) => !existing[c.id])
    if (need.length === 0) {
      begin(poolCards, existing)
      return
    }
    try {
      const res = await fetch("/api/quiz-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: need.map((c) => ({ cardId: c.id, question: c.question, answer: c.answer })),
          sources: set.sources ?? [],
        }),
      })
      const data = (await res.json()) as { ok?: boolean; kind?: string; error?: string } &
        QuizOptionsResponse
      if (!res.ok || !data.ok) {
        const kind = data.kind
        const friendly =
          kind === "rate-limit"
            ? "The AI hit a rate limit. Wait about a minute, then try again."
            : kind === "model"
              ? "The AI model could not be used. Change AI_MODEL in .env.local and restart the dev server."
              : data.error ?? "Something went wrong while generating quiz options. Please try again."
        setError(friendly)
        setPhase("setup")
        return
      }
      const fetched: Record<string, string[]> = {}
      for (const opt of data.options ?? []) {
        fetched[opt.cardId] = opt.choices
      }
      persistChoices(fetched)
      begin(poolCards, { ...existing, ...fetched })
    } catch {
      setError(
        "Something went wrong while generating quiz options. Please try again.",
      )
      setPhase("setup")
    }
  }

  function selectedCountValue(key: string): number {
    const option = counts.find((c) => c.key === key) ?? counts[counts.length - 1]
    return option.value
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Building your quiz</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Generating multiple choice options for this set…
        </p>
      </div>
    )
  }

  if (phase === "setup") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          Multiple choice quiz — {set.title}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Due cards come first; the rest are filled with your least-recently quizzed cards.
        </p>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}
        <div>
          <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            How many questions?
          </div>
          <div className="flex flex-wrap gap-2">
            {counts.map((option) => (
              <button
                key={option.key}
                type="button"
                disabled={option.disabled}
                onClick={() => setCountKey(option.key)}
                className={
                  option.disabled
                    ? "cursor-not-allowed rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-400 opacity-50 dark:border-zinc-800 dark:text-zinc-600"
                    : countKey === option.key
                      ? "rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => runQuiz(selectedCountValue(countKey))}
            className="flex-1 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {error ? "Try again" : "Start quiz"}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  if (phase === "play") {
    const plan = plans[index]
    const answered = selected !== null
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            Question {index + 1} of {plans.length}
          </span>
          <span>{correct} correct</span>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Question</div>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{plan.question}</p>
        </div>

        <div className="flex flex-col gap-2">
          {plan.options.map((option) => {
            let style =
              "rounded-xl border border-zinc-300 bg-white px-4 py-3 text-left text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            if (answered) {
              if (option === plan.answer) {
                style =
                  "rounded-xl border border-emerald-500 bg-emerald-50 px-4 py-3 text-left text-sm font-semibold text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-300"
              } else if (option === selected) {
                style =
                  "rounded-xl border border-red-400 bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-700 dark:border-red-600 dark:bg-red-950 dark:text-red-300"
              } else {
                style =
                  "rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
              }
            }
            return (
              <button
                key={option}
                type="button"
                disabled={answered}
                onClick={() => pick(option)}
                className={style}
              >
                {option}
              </button>
            )
          })}
        </div>

        {answered && (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {selected === plan.answer ? (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Correct
                </span>
              ) : (
                <>
                  <span className="font-semibold text-red-500">Wrong</span> — the answer was{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {plan.answer}
                  </span>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={clearSelectionForNext}
              className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {index < plans.length - 1 ? "Next question" : "See results"}
            </button>
          </div>
        )}
      </div>
    )
  }

  const accuracy = plans.length > 0 ? Math.round((correct / plans.length) * 100) : 0

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">Quiz complete — {set.title}</h2>
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Score</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {correct} / {plans.length}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Questions</dt>
          <dd className="mt-1 text-2xl font-semibold">{plans.length}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Accuracy</dt>
          <dd className="mt-1 text-2xl font-semibold">{accuracy}%</dd>
        </div>
      </dl>

      {missed.length > 0 ? (
        <div>
          <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Missed questions
          </div>
          <ul className="flex flex-col gap-2">
            {missed.map((card, missedIndex) => (
              <li
                key={card.id + missedIndex}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="text-sm font-medium">{card.question}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Answer: {card.answer}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Perfect score — no missed questions.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setPhase("setup")
            setError(null)
          }}
          className="flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Quiz again
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex-1 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Done
        </button>
      </div>
    </div>
  )
}