import type { Grade, Flashcard } from "./types"
import { addDays } from "./dates"

export function nextInterval(grade: Grade, current: number): number {
  if (grade === "again") return 0
  if (current === 0) return grade === "good" ? 1 : 3
  return grade === "good" ? current * 2 : current * 3
}

export function applyGrade(card: Flashcard, grade: Grade, today: string): Flashcard {
  const interval = nextInterval(grade, card.interval)
  return { ...card, interval, dueDate: addDays(today, interval) }
}