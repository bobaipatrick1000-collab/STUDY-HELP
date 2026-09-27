"use client"

import type { CardSet } from "@/lib/types"
import { TOPIC_HONESTY_NOTE } from "@/lib/constants"

interface TopicViewProps {
  set: CardSet
  onStudy: () => void
  onQuiz: () => void
  onEssays: () => void
  onDone: () => void
}

export function TopicView({ set, onStudy, onQuiz, onEssays, onDone }: TopicViewProps) {
  const pack = set.topicPack
  const sources = set.sources ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{set.title}</h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Back
        </button>
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        {TOPIC_HONESTY_NOTE}
      </p>

      {pack?.ungrounded && sources.length === 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {pack.groundingNote ??
            "No live web sources are included (web search may not be available with the current provider). Everything here is AI-generated — verify it against your own material."}
        </p>
      )}
      {pack?.limitedSources && !pack.ungrounded && sources.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          This pack is based on only {sources.length} web source
          {sources.length === 1 ? "" : "s"} — double-check everything against your own notes.
        </p>
      )}
      {pack && !pack.ungrounded && pack.verified && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          Checked against {sources.length} web source
          {sources.length === 1 ? "" : "s"}.{" "}
          {pack.removedClaims && pack.removedClaims.length > 0
            ? `${pack.removedClaims.length} claim${pack.removedClaims.length === 1 ? " was" : "s were"} removed or reworded because they were not supported by the retrieved text.`
            : "Every claim in this pack is supported by the retrieved text."}
        </p>
      )}
      {pack && !pack.ungrounded && !pack.verified && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {pack.verificationNote ?? "The source-conformance check could not run on this pack. Verify everything against your own material."}
        </p>
      )}

      {pack && (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {pack.intro}
          </p>

          {pack.level && (
            <p className="text-sm text-zinc-500">
              Level: <span className="font-medium text-zinc-700 dark:text-zinc-300">{pack.level}</span>
            </p>
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Course outline
            </h3>
            <ol className="flex flex-col gap-3">
              {pack.sections.map((section) => (
                <li
                  key={section.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="font-medium">{section.title}</div>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {section.objectives.map((objective, i) => (
                      <li key={i}>{objective}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      {pack && (
        <div>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Sources
          </h3>
          {sources.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  >
                    <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                      {source.title}
                    </span>
                    <span className="block text-zinc-500">{source.url}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No web sources were included with this pack. Verify everything against your own
              material.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onStudy}
          disabled={set.cards.length === 0}
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Study cards
        </button>
        <button
          type="button"
          onClick={onQuiz}
          disabled={set.cards.length < 4}
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Take the multiple choice quiz
        </button>
        <button
          type="button"
          onClick={onEssays}
          disabled={(set.essayQuestions ?? []).length === 0}
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          Essay questions
        </button>
      </div>
    </div>
  )
}