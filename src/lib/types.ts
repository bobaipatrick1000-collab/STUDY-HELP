export interface Flashcard {
  id: string
  question: string
  answer: string
  interval: number
  dueDate: string
  quizChoices?: string[]
  lastQuizzedAt?: number
}

export interface TopicSection {
  id: string
  title: string
  objectives: string[]
}

export interface TopicSource {
  title: string
  url: string
}

export interface TopicEssayQuestion {
  id: string
  question: string
  guideline: string
  answer?: string
  answerSources?: TopicSource[]
}

export interface TopicPack {
  intro: string
  level?: string
  sections: TopicSection[]
  limitedSources?: boolean
  ungrounded?: boolean
  groundingNote?: string
  verified?: boolean
  removedClaims?: string[]
  verificationNote?: string
}

export interface CardSet {
  id: string
  title: string
  createdAt: string
  notes: string
  cards: Flashcard[]
  type?: "cards" | "topic"
  topicPack?: TopicPack
  sources?: TopicSource[]
  essayQuestions?: TopicEssayQuestion[]
}

export interface StudySession {
  id: string
  date: string
  setId: string
  setTitle: string
  studied: number
  correct: number
  type?: "flashcards" | "quiz"
}

export type Grade = "again" | "good" | "easy"

export interface DraftState {
  question: string
  answer: string
}