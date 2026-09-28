import { aiGenerateText, callWithBudgetFallback, resolveConfigError, resolveModel } from "./ai"
import { buildGroundingBlock, isUsableGrounding, rankResults } from "./grounding"
import { searchWithCache } from "./searchCache"
import { isTopicCovered } from "./relevance"
import { verifyTextDraft } from "./verify"
import type { TopicSource } from "./types"
import {
  billingMessage,
  callWithRetry,
  messageOf,
  rateLimitMessage,
  statusOf,
} from "./geminiClient"

export type EssayAnswerFailureKind =
  | "config"
  | "billing"
  | "rate-limit"
  | "model"
  | "response"
  | "service"

export type EssayAnswerResult =
  | {
      ok: true
      answer: string
      sources: TopicSource[]
      ungrounded: boolean
      verified: boolean
      removed: string[]
      verificationNote?: string
    }
  | { ok: false; kind: EssayAnswerFailureKind; message: string }

export const ESSAY_ANSWER_SYSTEM_PROMPT = `You write complete, standalone essay answers for students.

You will receive a topic, an essay question, and optionally web sources. Write a real answer a student could hand in: several paragraphs that directly and fully answer the question.

Rules:
1. Base every factual claim on the provided web sources and cite the source as [n] where a fact comes from it (for example "…worth around 750 million acres (USDA, 2023) [1]").
2. Never invent people, dates, statistics, quotes, or sources.
3. When no reliable web sources are provided, use only accurate general knowledge and do not cite sources.
4. Write in clear, direct prose. Do NOT include rubric language, checklists, grading criteria, glossaries of what the answer should contain, meta-commentary, or questions back to the reader.
5. Start with a short introduction that states your answer, then support it across body paragraphs tied to the question.
6. End with a brief conclusion.
7. Write a complete answer. A student should not need to add, expand, or finish anything.`;

export interface EssayAnswerInput {
  title: string
  question: string
  fresh?: boolean
}

async function searchEssayGrounding(
  query: string,
  topicLabel: string,
  fresh: boolean,
): Promise<{ sources: TopicSource[]; ungrounded: boolean; groundingBlock: string }> {
  const outcome = await searchWithCache(query, { fresh })
  if (!outcome.ok || outcome.results.length === 0) {
    return { sources: [], ungrounded: true, groundingBlock: "" }
  }
  const ranked = rankResults(outcome.results)
  const usable = isUsableGrounding(ranked)
  if (!usable) {
    return { sources: [], ungrounded: true, groundingBlock: "" }
  }
  const covered = await isTopicCovered(topicLabel, ranked)
  if (!covered) {
    return { sources: [], ungrounded: true, groundingBlock: "" }
  }
  const sources = ranked.map((r) => ({ title: r.title, url: r.url }))
  const groundingBlock = buildGroundingBlock(ranked)
  return { sources, ungrounded: false, groundingBlock }
}

export async function generateEssayAnswer(
  input: EssayAnswerInput,
): Promise<EssayAnswerResult> {
  const configError = resolveConfigError()
  if (configError) {
    return { ok: false, kind: "config", message: configError }
  }

  const model = resolveModel()

  const query = (input.title.trim() + " " + input.question.trim()).slice(0, 400)
  const { sources, ungrounded, groundingBlock } = await searchEssayGrounding(
    query,
    input.title.trim(),
    input.fresh ?? false,
  )

  const contents = [
    "Topic: " + input.title.trim(),
    "Essay question: " + input.question.trim(),
    groundingBlock !== ""
      ? groundingBlock
      : "No reliable web sources were found for this topic. Use only accurate general knowledge and do not cite any sources.",
  ].join("\n\n")

  async function attempt(): Promise<string | null> {
    const response = await callWithRetry(() =>
      callWithBudgetFallback(
        (maxOutputTokens) =>
          aiGenerateText({
            systemPrompt: ESSAY_ANSWER_SYSTEM_PROMPT,
            userContent: contents,
            temperature: 0.5,
            maxOutputTokens,
          }),
        8192,
      ),
    )
    const text = response.text.trim()
    if (text === "") return null
    return text
  }

  try {
    let answer = await attempt()

    if (!answer) {
      answer = await attempt()
    }

    if (!answer) {
      return {
        ok: false,
        kind: "response",
        message: "The AI did not return an essay answer. Please try again.",
      }
    }

    if (ungrounded) {
      return {
        ok: true,
        answer,
        sources,
        ungrounded,
        verified: false,
        removed: [],
        verificationNote:
          "No web sources were retrieved, so the answer was generated from general knowledge and source-conformance checking was skipped.",
      }
    }

    const checked = await verifyTextDraft(answer, groundingBlock)
    return {
      ok: true,
      answer: checked.revised,
      sources,
      ungrounded,
      verified: checked.verified,
      removed: checked.removed,
      verificationNote: checked.note,
    }
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

    console.error("generateEssayAnswer failed:", status, message)
    return {
      ok: false,
      kind: "service",
      message: "Something went wrong while generating the essay answer. Please try again.",
    }
  }
}