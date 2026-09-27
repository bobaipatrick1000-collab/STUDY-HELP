"use client"

import { useState } from "react"

export function FocusGate({ onDone }: { onDone: (focus: string) => void }) {
  const [value, setValue] = useState("")
  const canSubmit = value.trim().length > 0

  function submit() {
    if (!canSubmit) return
    onDone(value.trim())
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Study smarter</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Paste your notes and I&apos;ll turn them into flashcards you can study.
        </p>
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="focus-input" className="text-sm font-medium">
            What are you trying to get better at?
          </label>
          <input
            id="focus-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Biology exam, Spanish vocabulary, React basics"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  )
}