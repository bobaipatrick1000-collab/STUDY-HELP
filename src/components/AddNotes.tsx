"use client"

import { useState } from "react"
import type { CardSet, DraftState, TopicSource } from "@/lib/types"
import { CARD_COUNTS, NOTES_MAX_LENGTH } from "@/lib/constants"
import { todayStr } from "@/lib/dates"
import { uid } from "@/lib/storage"

type Phase = "form" | "loading" | "preview"

interface AddNotesProps {
  focus: string
  onSave: (updater: (prev: CardSet[]) => CardSet[]) => void
  onDone: () => void
}

type GenerateResponse =
  | { ok: true; cards: DraftState[]; sources: TopicSource[]; ungrounded: boolean }
  | { ok: false; error: string }

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function AddNotes({ focus, onSave, onDone }: AddNotesProps) {
  const [phase, setPhase] = useState<Phase>("form")
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [count, setCount] = useState<(typeof CARD_COUNTS)[number]>(10)
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<DraftState[]>([])
  const [sources, setSources] = useState<TopicSource[]>([])
  const [ungrounded, setUngrounded] = useState(false)

  const notesLength = notes.length
  const topicOnly = notes.trim().length === 0
  const canGenerate =
    title.trim().length > 0 && notesLength <= NOTES_MAX_LENGTH

  async function generate() {
    if (!canGenerate) return
    setPhase("loading")
    setError(null)
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus, notes, count }),
      })
      const data = (await res.json()) as GenerateResponse
      if (res.status === 429) {
        setError(
          "The AI hit its rate limit. Wait about a minute, then try again.",
        )
        setPhase("form")
        return
      }
      if (!data.ok) {
        setError(data.error || "Something went wrong while generating cards.")
        setPhase("form")
        return
      }
      setCards(data.cards)
      setSources(data.sources ?? [])
      setUngrounded(data.ungrounded ?? false)
      setPhase("preview")
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
      setPhase("form")
    }
  }

  function updateCard(index: number, patch: Partial<DraftState>) {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function removeCard(index: number) {
    setCards((prev) => prev.filter((_, i) => i !== index))
  }

  function saveSet() {
    if (cards.length === 0) return
    const today = todayStr()
    const cardSet: CardSet = {
      id: uid(),
      title: title.trim(),
      createdAt: today,
      notes,
      cards: cards.map((c) => ({
        id: uid(),
        question: c.question,
        answer: c.answer,
        interval: 0,
        dueDate: today,
      })),
      ...(sources.length > 0 ? { sources } : {}),
    }
    onSave((prev) => [...prev, cardSet])
    onDone()
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {topicOnly
            ? `Searching the web for "${focus}" and turning it into ${count} flashcards…`
            : `Turning your notes into ${count} flashcards…`}
        </p>
      </div>
    )
  }

  if (phase === "preview") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Review your cards</h2>
          <button
            type="button"
            onClick={() => {
              setPhase("form")
              setError(null)
            }}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Back to notes
          </button>
        </div>

        {ungrounded && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            No reliable web sources were found for “{focus}”, so these cards were generated
            from general knowledge. Verify the facts before you study them.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {cards.map((card, i) => (
            <li
              key={i}
              className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Card {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeCard(i)}
                  className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <textarea
                  value={card.question}
                  onChange={(e) => updateCard(i, { question: e.target.value })}
                  rows={2}
                  aria-label={`Card ${i + 1} question`}
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <textarea
                  value={card.answer}
                  onChange={(e) => updateCard(i, { answer: e.target.value })}
                  rows={2}
                  aria-label={`Card ${i + 1} answer`}
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm italic outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            </li>
          ))}
        </ul>

        {sources.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-medium">Sources ({sources.length})</div>
            <ul className="mt-2 flex flex-col gap-1.5">
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

        <button
          type="button"
          onClick={saveSet}
          disabled={cards.length === 0}
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Save set ({cards.length} card{cards.length === 1 ? "" : "s"})
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="set-title" className="text-sm font-medium">
          Set title
        </label>
        <input
          id="set-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Biology chapter 3"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <span
            className={
              notesLength >= NOTES_MAX_LENGTH
                ? "text-xs font-medium text-red-600"
                : "text-xs text-zinc-500"
            }
          >
            {notesLength.toLocaleString()} / {NOTES_MAX_LENGTH.toLocaleString()}
          </span>
        </div>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={12}
          maxLength={NOTES_MAX_LENGTH}
          placeholder="Paste your study notes here… (leave empty to generate cards from web sources about your focus)"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {topicOnly && notesLength === 0 && (
        <p className="text-xs text-zinc-500">
          No notes? We will search the web for “{focus}” and base the cards on what we find.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Number of cards</span>
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={generate}
            className="ml-2 rounded border border-red-300 px-2 py-0.5 text-xs font-medium dark:border-red-700"
          >
            Retry
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={!canGenerate}
        className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Generate cards
      </button>

      {notesLength >= NOTES_MAX_LENGTH && (
        <p className="text-xs font-medium text-red-600">
          You have reached the {NOTES_MAX_LENGTH.toLocaleString()}-character limit. Delete some
          text to keep editing.
        </p>
      )}
      {!canGenerate && (
        <p className="text-xs text-zinc-500">
          {title.trim().length === 0
            ? "Give the set a title."
            : notesLength > NOTES_MAX_LENGTH
              ? `Notes exceed the ${NOTES_MAX_LENGTH.toLocaleString()}-character limit.`
              : null}
        </p>
      )}
    </div>
  )
}