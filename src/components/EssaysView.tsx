"use client"

import { useState } from "react"
import type { CardSet, TopicSource } from "@/lib/types"

interface EssaysViewProps {
  set: CardSet
  onUpdateSets: (updater: (prev: CardSet[]) => CardSet[]) => void
  onDone: () => void
}

interface AnswerResponse {
  ok?: boolean
  answer?: string
  sources?: TopicSource[]
  ungrounded?: boolean
  verified?: boolean
  removed?: string[]
  verificationNote?: string
  error?: string
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function EssaysView({ set, onUpdateSets, onDone }: EssaysViewProps) {
  const questions = set.essayQuestions ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, string>>({})

  async function generateAnswer(questionId: string, question: string) {
    setBusy(questionId)
    setNotice((prev) => {
      const next = { ...prev }
      delete next[questionId]
      return next
    })
    try {
      const res = await fetch("/api/essay-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: set.title, question }),
      })
      const data = (await res.json()) as AnswerResponse
      if (res.status === 429) {
        setNotice((prev) => ({
          ...prev,
          [questionId]:
            "The AI hit its rate limit. Wait about a minute, then try again.",
        }))
        setBusy(null)
        return
      }
      if (!res.ok || !data.ok || !data.answer) {
        setNotice((prev) => ({
          ...prev,
          [questionId]: data.error || "Something went wrong. Please try again.",
        }))
        setBusy(null)
        return
      }
      onUpdateSets((prev) =>
        prev.map((s) =>
          s.id !== set.id
            ? s
            : {
                ...s,
                essayQuestions: (s.essayQuestions ?? []).map((q) =>
                  q.id === questionId
                    ? {
                        ...q,
                        answer: data.answer ?? "",
                        answerSources: data.sources ?? [],
                      }
                    : q,
                ),
              },
        ),
      )
      if (data.ungrounded) {
        setNotice((prev) => ({
          ...prev,
          [questionId]:
            data.verificationNote ??
            "No reliable web sources were found, so this answer is based on general knowledge. Verify the facts before you use it.",
        }))
      } else if (data.verified) {
        setNotice((prev) => ({
          ...prev,
          [questionId]:
            (data.removed ?? []).length > 0
              ? `Checked against ${data.sources?.length ?? 0} sources: ${data.removed?.length ?? 0} claim${(data.removed?.length ?? 0) === 1 ? " was" : "s were"} removed or reworded because they were not supported by the retrieved text.`
              : "Checked against the retrieved sources: every claim is supported by them.",
        }))
      } else {
        setNotice((prev) => ({
          ...prev,
          [questionId]:
            data.verificationNote ??
            "The source-conformance check could not run on this answer. Verify the facts before you use it.",
        }))
      }
      setBusy(null)
    } catch {
      setNotice((prev) => ({
        ...prev,
        [questionId]: "Could not reach the server. Check your connection and try again.",
      }))
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Essay questions — {set.title}</h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-zinc-500">No essay questions were saved for this set.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {questions.map((q) => (
            <li
              key={q.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="text-sm font-medium leading-relaxed">{q.question}</p>

              {q.answer !== undefined && q.answer !== "" ? (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    {q.answer}
                  </p>
                  {(q.answerSources ?? []).length > 0 && (
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Sources
                      </div>
                      <ul className="mt-1 flex flex-col gap-1">
                        {(q.answerSources ?? []).map((s, i) => (
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
                    onClick={() => generateAnswer(q.id, q.question)}
                    disabled={busy === q.id}
                    className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    {busy === q.id ? "Generating…" : "Regenerate answer"}
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {busy === q.id && (
                    <div className="flex items-center gap-3">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        Searching the web and writing a complete answer…
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => generateAnswer(q.id, q.question)}
                    disabled={busy !== null}
                    className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {busy === q.id ? "Generating…" : "Generate a complete answer"}
                  </button>
                </div>
              )}

              {notice[q.id] && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  {notice[q.id]}
                </p>
              )}

              {q.guideline !== "" && (
                <div className="mt-3">
                  {open === q.id ? (
                    <>
                      <p className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {q.guideline}
                      </p>
                      <button
                        type="button"
                        onClick={() => setOpen(null)}
                        className="mt-2 text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                      >
                        Hide guideline
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpen(q.id)}
                      className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                    >
                      Show guideline
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}