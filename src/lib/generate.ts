import { NOTES_MAX_LENGTH } from "./constants"
import { GENERATE_CARDS_SYSTEM_PROMPT } from "./generatePrompt"
import { aiGenerateText, callWithBudgetFallback, resolveConfigError, resolveModel } from "./ai"
import { buildGroundingBlock, isUsableGrounding, rankResults } from "./grounding"
import { searchWithCache } from "./searchCache"
import { isTopicCovered } from "./relevance"
import { parseJsonSmart } from "./json"
import type { TopicSource } from "./types"
import {
  billingMessage,
  callWithRetry,
  messageOf,
  rateLimitMessage,
  statusOf,
} from "./geminiClient"

export interface DraftCard {
  question: string
  answer: string
}

export type GenerateFailureKind =
  | "config"
  | "billing"
  | "rate-limit"
  | "model"
  | "response"
  | "service"

export type GenerateResult =
  | { ok: true; cards: DraftCard[]; sources: TopicSource[]; ungrounded: boolean }
  | { ok: false; kind: GenerateFailureKind; message: string }

interface GenerateInput {
  focus: string
  notes: string
  count: number
}

function parseCards(text: string, count: number): DraftCard[] | null {
  const parsed = parseJsonSmart(text)
  if (parsed === undefined) return null

  let list: unknown[] = []
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.cards)) {
      list = record.cards
    }
  }
  if (list.length === 0) return null

  const cards: DraftCard[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const question = typeof record.question === "string" ? record.question : ""
    const answer = typeof record.answer === "string" ? record.answer : ""
    if (question.trim() === "" || answer.trim() === "") continue
    cards.push({
      question: question.trim().slice(0, 3000),
      answer: answer.trim().slice(0, 3000),
    })
  }
  if (cards.length === 0) return null
  return cards.slice(0, count)
}

export async function generateCards(input: GenerateInput): Promise<GenerateResult> {
  const configError = resolveConfigError()
  if (configError) {
    return { ok: false, kind: "config", message: configError }
  }

  const model = resolveModel()

  const hasNotes = input.notes.trim().length > 0
  const { sources, ungrounded, groundingBlock } = hasNotes
    ? { sources: [] as TopicSource[], ungrounded: false, groundingBlock: "" }
    : await searchGrounding(input.focus)

  const contents = hasNotes
    ? [
        "The user is trying to get better at: " + input.focus,
        "Generate exactly " + input.count + " flashcards.",
        "Notes to turn into flashcards:\n\n" + input.notes.slice(0, NOTES_MAX_LENGTH),
      ].join("\n\n")
    : [
        "The user is trying to get better at: " + input.focus,
        "Generate exactly " + input.count + " flashcards about " + input.focus + ".",
        groundingBlock !== ""
          ? "Web sources (cite facts as [n]):\n\n" + groundingBlock
          : "No reliable web sources were found for this topic. Use only accurate general knowledge. Never invent people, dates, statistics, or sources.",
      ].join("\n\n")

  async function attempt(): Promise<DraftCard[] | null> {
    const response = await callWithRetry(() =>
      callWithBudgetFallback(
        (maxOutputTokens) =>
          aiGenerateText({
            systemPrompt: GENERATE_CARDS_SYSTEM_PROMPT,
            userContent: contents,
            temperature: 0.5,
            maxOutputTokens,
          }),
        8192,
      ),
    )
    if (response.text === "") return null
    return parseCards(response.text, input.count)
  }

  try {
    let cards = await attempt()

    if (!cards) {
      // Parsing failed; retry once before giving up.
      cards = await attempt()
    }

    if (!cards) {
      return {
        ok: false,
        kind: "response",
        message: "The AI did not return valid flashcards. Please try again.",
      }
    }

    return { ok: true, cards, sources, ungrounded }
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

    console.error("generateCards failed:", status, message)
    return {
      ok: false,
      kind: "service",
      message: "Something went wrong while generating cards. Please try again.",
    }
  }
}

async function searchGrounding(
  query: string,
): Promise<{ sources: TopicSource[]; ungrounded: boolean; groundingBlock: string }> {
  const outcome = await searchWithCache(query)
  if (!outcome.ok || outcome.results.length === 0) {
    return { sources: [], ungrounded: true, groundingBlock: "" }
  }
  const ranked = rankResults(outcome.results)
  const usable = isUsableGrounding(ranked)
  if (!usable) {
    return { sources: [], ungrounded: true, groundingBlock: "" }
  }
  const covered = await isTopicCovered(query, ranked)
  if (!covered) {
    return { sources: [], ungrounded: true, groundingBlock: "" }
  }
  const sources = ranked.map((r) => ({ title: r.title, url: r.url }))
  const groundingBlock = buildGroundingBlock(ranked)
  return { sources, ungrounded: false, groundingBlock }
}