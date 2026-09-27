import type { Flashcard } from "./types"

export function buildQuizPool(cards: Flashcard[], count: number, today: string): Flashcard[] {
  const due = cards.filter((card) => card.dueDate <= today)
  const rest = cards
    .filter((card) => card.dueDate > today)
    .sort((a, b) => (a.lastQuizzedAt ?? 0) - (b.lastQuizzedAt ?? 0))
  return [...due, ...rest].slice(0, Math.max(0, count))
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}