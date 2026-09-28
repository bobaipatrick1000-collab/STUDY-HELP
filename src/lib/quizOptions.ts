import { aiGenerateText, callWithBudgetFallback, resolveConfigError, resolveModel } from "./ai"
import { buildSourceList } from "./grounding"
import type { TopicSource } from "./types"
import {
  billingMessage,
  callWithRetry,
  messageOf,
  rateLimitMessage,
  statusOf,
} from "./geminiClient"

export interface QuizOptionCard {
  cardId: string
  question: string
  answer: string
}

export interface QuizOptionsInput extends QuizOptionCard {
  sources?: TopicSource[]
}

export type QuizOptionsFailureKind =
  | "config"
  | "billing"
  | "rate-limit"
  | "model"
  | "response"
  | "service"

export type QuizOptionsResult =
  | { ok: true; options: Record<string, string[]> }
  | { ok: false; kind: QuizOptionsFailureKind; message: string }

export const QUIZ_OPTIONS_SYSTEM_PROMPT = `You write multiple-choice distractors (wrong answer options) for flashcards.

You will receive flashcards as JSON, each with a cardId, a question, and its correct answer, and optionally the set's sources. For each flashcard return 3 short, plausible wrong answers.

Rules:
1. Each distractor must be clearly incorrect but believable for someone studying the topic.
2. No distractor may equal the correct answer, and no two distractors may be the same.
3. Keep every distractor short (a few words up to one sentence).
4. Base distractors only on the card's question and answer. Do not invent unrelated content or new questions. When a set's sources are provided, keep the distractors consistent with that material.
5. Return an entry for every flashcard you receive, in the same cardId.

Return ONLY valid JSON with no explanation and no markdown code fences, in exactly this shape:

{"options":[{"cardId":"...","choices":["wrong1","wrong2","wrong3"]}]}`;

function stripCodeFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) return fenced[1].trim()
  return text.trim()
}

export function validateChoices(answer: string, raw: unknown[]): string[] | null {
  const seen = new Set<string>()
  const choices: string[] = []
  for (const choice of raw) {
    if (typeof choice !== "string") continue
    const normalized = choice.trim().slice(0, 500)
    if (normalized === "") continue
    if (normalized === answer) continue
    const lower = normalized.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    choices.push(normalized)
    if (choices.length === 3) break
  }
  return choices.length === 3 ? choices : null
}

function parseOptions(text: string, cards: QuizOptionCard[]): Record<string, string[]> | null {
  const cleaned = stripCodeFences(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>
  const list = Array.isArray(record.options) ? record.options : []
  if (list.length === 0) return null

  const answers = new Map(cards.map((c) => [c.cardId, c.answer]))
  const byId = new Map(cards.map((c) => [c.cardId, c]))
  const result: Record<string, string[]> = {}

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const cardId = typeof item.cardId === "string" ? item.cardId : ""
    if (!byId.has(cardId)) continue
    const raw = Array.isArray(item.choices) ? item.choices : []
    const choices = validateChoices(answers.get(cardId) ?? "", raw)
    if (choices) {
      result[cardId] = choices
    }
  }

  for (const requested of cards) {
    if (!result[requested.cardId]) return null
  }

  return result
}

export async function generateQuizOptions(
  cards: QuizOptionCard[],
  opts: { sources?: TopicSource[] } = {},
): Promise<QuizOptionsResult> {
  const configError = resolveConfigError()
  if (configError) {
    return { ok: false, kind: "config", message: configError }
  }

  const model = resolveModel()

  const sourceBlock = buildSourceList(opts.sources ?? [])
  const contents = [
    sourceBlock !== ""
      ? "Set sources (keeps the wrong options plausible; cite them only if helpful):\n" +
        sourceBlock +
        "\n\n"
      : "",
    "Flashcards to create wrong answer options for:\n\n" +
      JSON.stringify(
        cards.map((c) => ({ cardId: c.cardId, question: c.question, answer: c.answer })),
      ),
  ].join("\n\n")

  async function attempt(): Promise<Record<string, string[]> | null> {
    const response = await callWithRetry(() =>
      callWithBudgetFallback(
        (maxOutputTokens) =>
          aiGenerateText({
            systemPrompt: QUIZ_OPTIONS_SYSTEM_PROMPT,
            userContent: contents,
            temperature: 1,
            maxOutputTokens,
          }),
        8192,
      ),
    )
    if (response.text === "") return null
    return parseOptions(response.text, cards)
  }

  try {
    let options = await attempt()

    if (!options) {
      options = await attempt()
    }

    if (!options) {
      return {
        ok: false,
        kind: "response",
        message: "The AI did not return valid wrong options. Please try again.",
      }
    }

    return { ok: true, options }
  } catch (err) {
    const status = statusOf(err)
    const message = messageOf(err)
    const lower = message.toLowerCase()

    const billing = billingMessage(err)
    if (billing) {
      return { ok: false, kind: "billing", message: billing }
    }

    if (
      status === 429 ||
      status === 403 ||
      lower.includes("rate limit") ||
      lower.includes("resource_exhausted") ||
      lower.includes("quota") ||
      lower.includes("429") ||
      lower.includes("503")
    ) {
      return {
        ok: false,
        kind: "rate-limit",
        message: rateLimitMessage(err, model),
      }
    }

    if (
      (status === 400 || status === 404) &&
      (lower.includes("model") || lower.includes("not found"))
    ) {
      return {
        ok: false,
        kind: "model",
        message:
          "The model \"" +
          model +
          "\" was not found. Change AI_MODEL in .env.local to a valid model for your provider, then restart the dev server.",
      }
    }

    console.error("generateQuizOptions failed:", status, message)
    return {
      ok: false,
      kind: "service",
      message: "Something went wrong while generating quiz options. Please try again.",
    }
  }
}