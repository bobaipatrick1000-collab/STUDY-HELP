"use client"

import { useSyncExternalStore } from "react"
import type { CardSet, StudySession } from "./types"
import {
  clearAllData,
  loadFocus,
  loadSets,
  loadSessions,
  saveFocus,
  saveSets,
  saveSessions,
} from "./storage"

export interface AppData {
  focus: string
  sets: CardSet[]
  sessions: StudySession[]
}

const emptySets: CardSet[] = []
const emptySessions: StudySession[] = []

const SERVER_DATA: AppData = { focus: "", sets: emptySets, sessions: emptySessions }

let data: AppData | null = null

const listeners = new Set<() => void>()

function getData(): AppData {
  if (data === null) {
    data = {
      focus: loadFocus(),
      sets: loadSets(),
      sessions: loadSessions(),
    }
  }
  return data
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): AppData {
  return getData()
}

function getServerSnapshot(): AppData {
  return SERVER_DATA
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function setFocus(focus: string): void {
  saveFocus(focus)
  const d = getData()
  data = { ...d, focus }
  emit()
}

export function updateSets(updater: (prev: CardSet[]) => CardSet[]): void {
  const d = getData()
  const sets = updater(d.sets)
  saveSets(sets)
  data = { ...d, sets }
  emit()
}

export function addSession(session: StudySession): void {
  const d = getData()
  const sessions = [...d.sessions, session]
  saveSessions(sessions)
  data = { ...d, sessions }
  emit()
}

export function clearAll(): void {
  clearAllData()
  data = { focus: "", sets: emptySets, sessions: emptySessions }
  emit()
}