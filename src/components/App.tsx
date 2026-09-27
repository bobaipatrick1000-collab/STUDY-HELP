"use client"

import { useCallback, useEffect, useState } from "react"
import { updateSets, useAppData, setFocus, addSession, clearAll } from "@/lib/store"
import { applyTheme, readTheme, type Theme } from "@/lib/theme"
import { ThemeToggle } from "./ThemeToggle"
import { FocusGate } from "./FocusGate"
import { FocusBar } from "./FocusBar"
import { Home } from "./Home"
import { AddNotes } from "./AddNotes"
import { Study } from "./Study"
import { History } from "./History"
import { NotesView } from "./NotesView"
import { TopicSearch } from "./TopicSearch"
import { TopicView } from "./TopicView"
import { EssaysView } from "./EssaysView"

export type View = "home" | "add" | "study" | "history" | "notes" | "topic" | "topic-view" | "essays"

export default function App() {
  const { focus, sets, sessions } = useAppData()
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [view, setView] = useState<View>("home")
  const [studyTarget, setStudyTarget] = useState<string>("all")
  const [autoStartId, setAutoStartId] = useState<string | null>(null)
  const [autoQuizId, setAutoQuizId] = useState<string | null>(null)
  const [notesSetId, setNotesSetId] = useState<string | null>(null)
  const [topicViewId, setTopicViewId] = useState<string | null>(null)
  const [essaysSetId, setEssaysSetId] = useState<string | null>(null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }, [])

  const handleSetFocus = useCallback((next: string) => {
    setFocus(next)
  }, [])

  const handleUpdateSets = updateSets

  const handleSaveSession = addSession

  const startStudy = useCallback((target: string) => {
    setAutoQuizId(null)
    setAutoStartId(null)
    setStudyTarget(target)
    setView("study")
  }, [])

  const studyNotesSet = useCallback((id: string) => {
    setAutoQuizId(null)
    setAutoStartId(id)
    setStudyTarget(id)
    setView("study")
  }, [])

  const studyTopicQuiz = useCallback((id: string) => {
    setAutoStartId(null)
    setAutoQuizId(id)
    setStudyTarget(id)
    setView("study")
  }, [])

  const viewSet = useCallback((id: string) => {
    const set = sets.find((s) => s.id === id)
    if (!set) return
    if (set.type === "topic") {
      setTopicViewId(id)
      setView("topic-view")
    } else {
      setNotesSetId(id)
      setView("notes")
    }
  }, [sets])

  const openEssays = useCallback((id: string) => {
    setEssaysSetId(id)
    setView("essays")
  }, [])

  const topicSet = topicViewId ? sets.find((s) => s.id === topicViewId) ?? null : null
  const notesSet = notesSetId ? sets.find((s) => s.id === notesSetId) ?? null : null
  const essaysSet = essaysSetId ? sets.find((s) => s.id === essaysSetId) ?? null : null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 lg:max-w-3xl 2xl:max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Flashcards</span>
        <ThemeToggle theme={theme} onToggle={handleToggleTheme} />
      </div>

      {!focus ? (
        <FocusGate onDone={handleSetFocus} />
      ) : (
        <>
          <FocusBar focus={focus} onSave={handleSetFocus} />

      <nav className="mt-6 mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => setView("home")}
          className={
            view === "home"
              ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }
        >
          Home
        </button>
        <button
          type="button"
          onClick={() => setView("add")}
          className={
            view === "add"
              ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }
        >
          Add notes
        </button>
        <button
          type="button"
          onClick={() => startStudy("all")}
          className={
            view === "study"
              ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }
        >
          Study
        </button>
        <button
          type="button"
          onClick={() => setView("history")}
          className={
            view === "history"
              ? "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }
        >
          History
        </button>
      </nav>

      {view === "add" && <AddNotes focus={focus} onSave={handleUpdateSets} onDone={() => setView("home")} />}

      {view === "study" && (
        <Study
          key={studyTarget}
          sets={sets}
          autoStartId={autoStartId ?? undefined}
          autoQuizStartId={autoQuizId ?? undefined}
          onUpdateSets={handleUpdateSets}
          onSaveSession={handleSaveSession}
          onDone={() => {
            setAutoStartId(null)
            setAutoQuizId(null)
            setView("home")
          }}
        />
      )}

      {view === "history" && <History sessions={sessions} onClearAll={clearAll} />}

      {view === "notes" && notesSet && (
        <NotesView
          set={notesSet}
          focus={focus}
          onUpdateSets={handleUpdateSets}
          onStudy={() => studyNotesSet(notesSet.id)}
          onDone={() => setView("home")}
        />
      )}

      {view === "home" && (
        <Home
          sets={sets}
          onAddNotes={() => setView("add")}
          onSearchTopic={() => setView("topic")}
          onStudy={startStudy}
          onViewSet={viewSet}
          onDeleteSet={(id) => updateSets((prev) => prev.filter((s) => s.id !== id))}
        />
      )}

      {view === "topic" && (
        <TopicSearch
          onSave={updateSets}
          onDone={() => setView("home")}
        />
      )}

      {view === "topic-view" && topicSet && (
        <TopicView
          set={topicSet}
          onStudy={() => studyNotesSet(topicSet.id)}
          onQuiz={() => studyTopicQuiz(topicSet.id)}
          onEssays={() => openEssays(topicSet.id)}
          onDone={() => setView("home")}
        />
      )}

      {view === "essays" && essaysSet && (
        <EssaysView set={essaysSet} onUpdateSets={handleUpdateSets} onDone={() => setView("home")} />
      )}
        </>
      )}
    </div>
  )
}