"use client"

import { useState } from "react"
import type { CardSet } from "@/lib/types"
import { TOPIC_HONESTY_NOTE } from "@/lib/constants"
import { todayStr } from "@/lib/dates"
import { uid } from "@/lib/storage"

interface TopicSearchProps {
  onSave: (updater: (prev: CardSet[]) => CardSet[]) => void
  onDone: () => void
}

interface TopicPackResponse {
  pack?: {
    title: string
    level?: string
    intro: string
    sections: { id: string; title: string; objectives: string[] }[]
    mcqs: { question: string; answer: string; choices: string[] }[]
    essays: { question: string; guideline: string }[]
    sources: { title: string; url: string }[]
    limitedSources: boolean
    ungrounded?: boolean
    groundingNote?: string
    verified?: boolean
    removedClaims?: string[]
    verificationNote?: string
  }
  kind?: string
  error?: string
  ok?: boolean
}

type Phase = "form" | "loading" | "preview"

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function friendlyError(data: TopicPackResponse): string {
  const kind = data.kind
  if (kind === "rate-limit") {
    return "The AI hit a rate limit. Wait about a minute, then try again."
  }
  if (kind === "model") {
    return "The AI model could not be used. Change AI_MODEL in .env.local and restart the dev server."
  }
  if (kind === "sources") {
    return (
      data.error ??
      "We could not find reliable web sources for this topic, so no study pack was created. Try a broader topic or add a field of study."
    )
  }
  return data.error ?? "Something went wrong while building the study pack. Please try again."
}

export function TopicSearch({ onSave, onDone }: TopicSearchProps) {
  const [topic, setTopic] = useState("")
  const [level, setLevel] = useState("")
  const [phase, setPhase] = useState<Phase>("form")
  const [error, setError] = useState<string | null>(null)
  const [pack, setPack] = useState<TopicPackResponse["pack"] | null>(null)

  async function build(opts?: { fresh?: boolean }) {
    if (topic.trim() === "") return
    setPhase("loading")
    setError(null)
    setPack(null)
    try {
      const res = await fetch("/api/topic-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          level: level.trim() || undefined,
          fresh: opts?.fresh === true,
        }),
      })
      const data = (await res.json()) as TopicPackResponse
      if (!res.ok || !data.ok || !data.pack) {
        setError(friendlyError(data))
        setPhase("form")
        return
      }
      setPack(data.pack)
      setPhase("preview")
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
      setPhase("form")
    }
  }

  function save() {
    if (!pack) return
    const today = todayStr()
    const newSet: CardSet = {
      id: uid(),
      title: pack.title,
      createdAt: today,
      notes: "",
      type: "topic",
      topicPack: {
        intro: pack.intro,
        level: pack.level,
        sections: pack.sections,
        limitedSources: pack.limitedSources,
        ...(pack.ungrounded !== undefined ? { ungrounded: pack.ungrounded } : {}),
        ...(pack.groundingNote ? { groundingNote: pack.groundingNote } : {}),
        ...(pack.verified !== undefined ? { verified: pack.verified } : {}),
        ...(pack.removedClaims ? { removedClaims: pack.removedClaims } : {}),
        ...(pack.verificationNote ? { verificationNote: pack.verificationNote } : {}),
      },
      sources: pack.sources,
      essayQuestions: pack.essays.map((e) => ({
        id: uid(),
        question: e.question,
        guideline: e.guideline,
      })),
      cards: pack.mcqs.map((m) => ({
        id: uid(),
        question: m.question,
        answer: m.answer,
        interval: 0,
        dueDate: today,
        quizChoices: m.choices,
      })),
    }
    onSave((prev) => [...prev, newSet])
    onDone()
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">Searching and building your study pack</h2>
          <p className="mt-1 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
            This can take about a minute. Your topic stays private — nothing is saved outside
            this device.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPhase("form")}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (phase === "preview" && pack) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Study pack for “{pack.title}”</h2>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
        </div>

        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {TOPIC_HONESTY_NOTE}
        </p>

        {pack.ungrounded && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {pack.groundingNote ?? "This pack was generated from general knowledge only. Verify everything against your own material."}
          </p>
        )}
        {!pack.ungrounded && pack.verified && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Checked against {pack.sources.length} web source
            {pack.sources.length === 1 ? "" : "s"}.{" "}
            {pack.removedClaims && pack.removedClaims.length > 0
              ? `${pack.removedClaims.length} claim${pack.removedClaims.length === 1 ? " was" : "s were"} removed or reworded because they were not supported by the retrieved text.`
              : "Every claim in this pack is supported by the retrieved text."}
          </p>
        )}
        {!pack.ungrounded && !pack.verified && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {pack.verificationNote ?? "The source-conformance check could not run on this pack. Verify everything against your own material."}
          </p>
        )}
        {!pack.ungrounded && pack.limitedSources && pack.sources.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            No live web sources are included (web search may not be available with the current
            provider). Everything here is AI-generated — verify it against your own material.
          </p>
        )}
        {pack.limitedSources && pack.sources.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Only {pack.sources.length} web source
            {pack.sources.length === 1 ? "" : "s"} was found for this topic. The pack is based
            on limited material, so double-check everything against your own notes.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-center dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4">
          <div>
            <div className="text-2xl font-semibold">{pack.sections.length}</div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Sections</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{pack.mcqs.length}</div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Questions</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{pack.essays.length}</div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Essays</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{pack.sources.length}</div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Sources</div>
          </div>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {pack.intro}
        </p>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Course outline
          </div>
          <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            {pack.sections.map((s) => (
              <li key={s.id}>• {s.title}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Sources
          </div>
          {pack.sources.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No source links were included. Verify the content against your own material.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
              {pack.sources.slice(0, 8).map((s) => (
                <li key={s.url} className="truncate">
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
              {pack.sources.length > 8 && <li>+ {pack.sources.length - 8} more</li>}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            className="flex-1 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save as a new card set
          </button>
          <button
            type="button"
            onClick={() => build({ fresh: true })}
            className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Regenerate
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Search a topic</h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>

      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Build a full study pack from live web search results: an outline, learning objectives,
        multiple choice questions, essay questions, and real source links saved as a new card
        set.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Topic</span>
        <input
          type="text"
          value={topic}
          maxLength={200}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. The French Revolution"
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Field of study or level (optional)
        </span>
        <input
          type="text"
          value={level}
          maxLength={200}
          onChange={(e) => setLevel(e.target.value)}
          placeholder="e.g. High school history, or Computer science"
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => build({ fresh: true })}
        disabled={topic.trim() === ""}
        className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {error ? "Try again" : "Search and build study pack"}
      </button>
    </div>
  )
}