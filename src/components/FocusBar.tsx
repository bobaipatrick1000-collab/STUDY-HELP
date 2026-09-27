"use client"

import { useState } from "react"

export function FocusBar({ focus, onSave }: { focus: string; onSave: (focus: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(focus)

  function startEdit() {
    setValue(focus)
    setEditing(true)
  }

  function save() {
    const next = value.trim()
    if (next) {
      onSave(next)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label htmlFor="focus-edit" className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          What are you working on?
        </label>
        <div className="flex gap-2">
          <input
            id="focus-edit"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Focus</div>
        <div className="truncate text-base font-medium">{focus}</div>
      </div>
      <button
        type="button"
        onClick={startEdit}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Edit
      </button>
    </div>
  )
}