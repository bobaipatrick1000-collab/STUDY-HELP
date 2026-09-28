import { aiGenerateText, callWithBudgetFallback, resolveConfigError, resolveModel } from "./ai"
import { buildGroundingBlock, isUsableGrounding, rankResults } from "./grounding"
import { validateChoices } from "./quizOptions"
import { searchWithCache } from "./searchCache"
import { isTopicCovered } from "./relevance"
import { verifyPackText } from "./verify"
import { billingMessage, callWithRetry, messageOf, statusOf } from "./geminiClient"
import { parseJsonSmart, stripCodeFences } from "./json"
import type { TopicSource } from "./types"

export interface TopicSectionResult {
  id: string
  title: string
  objectives: string[]
}

export interface TopicMcqResult {
  question: string
  answer: string
  choices: string[]
}

export interface TopicEssayResult {
  question: string
  guideline: string
}

export type TopicPackFailureKind =
  | "config"
  | "billing"
  | "rate-limit"
  | "model"
  | "response"
  | "service"

export interface TopicPackData {
  title: string
  level?: string
  intro: string
  sections: TopicSectionResult[]
  mcqs: TopicMcqResult[]
  essays: TopicEssayResult[]
  sources: TopicSource[]
  limitedSources: boolean
  ungrounded?: boolean
  groundingNote?: string
  verified?: boolean
  removedClaims?: string[]
  verificationNote?: string
}

export type TopicPackResult =
  | { ok: true; pack: TopicPackData }
  | { ok: false; kind: TopicPackFailureKind; message: string }

const PACK_SYSTEM_PROMPT = `You are an expert instructor who builds complete, structured study packs.

You will receive a topic and, optionally, a field of study or level. Follow the user's level when given. When the user message includes web sources, base every factual statement on them; otherwise use reliable general knowledge. Never invent people, dates, statistics, or sources.

Return ONLY valid JSON with no explanation and no markdown code fences, in exactly this shape:

{"intro":"...","sections":[{"id":"sec-1","title":"...","objectives":["...","..."]}],"mcqs":[{"question":"...","answer":"...","choices":["wrong1","wrong2","wrong3"]}],"essays":[{"question":"...","guideline":"..."}]}

Rules:
1. "intro" is 2-4 sentences explaining what the topic is, why it matters, and any assumptions you made about the topic.
2. Provide 4-7 sections. Each section has a short title and 2-4 concrete learning objectives phrased as "By the end of this section, the learner should be able to ...".
3. Provide exactly 10 multiple choice questions. Each has a clear question, one correct answer, and 3 plausible wrong choices. Wrong choices must be clearly incorrect but believable, must not equal the answer, and must not repeat each other. Keep questions and answers short.
4. Provide exactly 5 essay questions. Each has a clear question and a short guideline describing what a strong answer should cover.
5. Keep objectives, questions, and guidelines specific, testable, and aligned with the topic.
6. Do NOT include URLs in the JSON. They are handled separately.
7. Do not reuse questions: no essay question may duplicate or overlap any multiple choice question, and no two MCQs may ask the same thing.`;
const MCQ_COUNT = 10
const ESSAY_COUNT = 5

function classify(err: unknown, model: string): TopicPackResult {
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
      message:
        "The AI hit a rate limit. Wait about a minute, then try again. You can check your OpenRouter usage at openrouter.ai/api/usage.",
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

  console.error("generateTopicPack failed:", status, message)
  return {
    ok: false,
    kind: "service",
    message: "Something went wrong while generating the study pack. Please try again.",
  }
}

function parseFullText(text: string): {
  intro: string
  sections: TopicSectionResult[]
  mcqs: TopicMcqResult[]
  essays: TopicEssayResult[]
} | null {
  const parsed = parseJsonSmart(text)
  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>

  const intro = typeof record.intro === "string" ? record.intro.trim().slice(0, 2000) : ""
  if (intro === "") return null

  const sections: TopicSectionResult[] = []
  const rawSections = Array.isArray(record.sections) ? record.sections : []
  for (const entry of rawSections) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 200) : ""
    if (title === "") continue
    const objectives = Array.isArray(item.objectives)
      ? item.objectives
          .filter((o): o is string => typeof o === "string")
          .map((o) => o.trim().slice(0, 500))
          .filter((o) => o !== "")
      : []
    if (objectives.length === 0) continue
    sections.push({
      id: typeof item.id === "string" && item.id !== "" ? item.id : "sec-" + (sections.length + 1),
      title,
      objectives,
    })
  }
  if (sections.length === 0) return null

  const mcqs: TopicMcqResult[] = []
  const rawMcqs = Array.isArray(record.mcqs) ? record.mcqs : []
  for (const entry of rawMcqs) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const question = typeof item.question === "string" ? item.question.trim().slice(0, 1000) : ""
    const answer = typeof item.answer === "string" ? item.answer.trim().slice(0, 500) : ""
    if (question === "" || answer === "") continue
    const rawChoices = Array.isArray(item.choices) ? item.choices : []
    const choices = validateChoices(answer, rawChoices)
    if (!choices) continue
    mcqs.push({ question, answer, choices })
  }

  const essays: TopicEssayResult[] = []
  const rawEssays = Array.isArray(record.essays) ? record.essays : []
  for (const entry of rawEssays) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const question = typeof item.question === "string" ? item.question.trim().slice(0, 1000) : ""
    const guideline = typeof item.guideline === "string" ? item.guideline.trim().slice(0, 1500) : ""
    if (question === "") continue
    essays.push({ question, guideline })
  }

  if (mcqs.length === 0 || essays.length === 0) return null
  return { intro, sections, mcqs, essays }
}

export async function generateTopicPack(params: {
  topic: string
  level?: string
  fresh?: boolean
}): Promise<TopicPackResult> {
  const configError = resolveConfigError()
  if (configError) {
    return { ok: false, kind: "config", message: configError }
  }

  const model = resolveModel()

  const topic = params.topic.trim()
  const level = params.level?.trim() ?? ""
  const searchQuery = level !== "" ? topic + " " + level : topic

  const search = await searchWithCache(searchQuery, { fresh: params.fresh === true })
  const ranked = search.ok ? rankResults(search.results) : []
  const usable = search.ok && isUsableGrounding(ranked)
  let grounded = usable
  let searchIrrelevant = false
  if (search.ok && usable) {
    const covered = await isTopicCovered(topic, ranked)
    if (!covered) {
      grounded = false
      searchIrrelevant = true
    }
  }

  const sources: TopicSource[] = grounded ? ranked.map((r) => ({ title: r.title, url: r.url })) : []

  let groundingNote: string | undefined
  if (!grounded) {
    if (!search.ok) {
      if (search.kind === "credits") {
        groundingNote =
          "The web search quota is exhausted, so this pack was generated from general knowledge only. Verify everything against your own material."
      } else {
        groundingNote =
          "Live web search is currently unavailable, so this pack was generated from general knowledge only. Verify everything against your own material."
      }
    } else if (searchIrrelevant) {
      groundingNote =
        "No reliable web sources genuinely covering this topic could be found, so this pack was generated from general knowledge only. Verify everything against your own material."
    } else {
      groundingNote =
        "We could not find reliable web sources for this topic, so this pack was generated from general knowledge only. Verify everything against your own material."
    }
  }

  const base =
    "Topic: " + topic + "\n" + (level !== "" ? "Field of study or level: " + level + "\n" : "")

  let groundingBlock = ""
  if (grounded) {
    groundingBlock = "\n\n" + buildGroundingBlock(ranked)
  } else {
    groundingBlock =
      "\n\nNo live web sources could be retrieved for this topic, so build the study pack from general knowledge only. Never invent URLs, citations, or sources — the app labels this pack as ungrounded."
  }

  const packPrompt =
    base +
    (grounded
      ? "\nResearch this topic using the web sources below, then produce the complete study pack (intro, sections, " +
        MCQ_COUNT +
        " MCQs, and " +
        ESSAY_COUNT +
        " essays). Base every factual statement on the sources and mark facts with their source number in brackets, e.g. [1]."
      : "\nProduce the complete study pack from general knowledge (intro, sections, " +
        MCQ_COUNT +
        " MCQs, and " +
        ESSAY_COUNT +
        " essays).") +
    groundingBlock

  async function callPack(): Promise<{ text: string } | null> {
    const response = await callWithRetry(
      () =>
        callWithBudgetFallback(
          (maxOutputTokens) =>
            aiGenerateText({
              systemPrompt: PACK_SYSTEM_PROMPT,
              userContent: packPrompt,
              temperature: 0.6,
              maxOutputTokens,
            }),
          8192,
        ),
      2,
    )
    if (response.text === "") return null
    return { text: response.text }
  }

  try {
    const first = await callPack()
    if (!first) {
      return {
        ok: false,
        kind: "response",
        message: "The AI did not return a valid study pack for this topic. Please try again.",
      }
    }

    let raw = first.text
    let parsed = parseFullText(raw)

    if (!parsed) {
      const second = await callPack()
      if (!second) {
        return {
          ok: false,
          kind: "response",
          message: "The AI did not return a valid study pack for this topic. Please try again.",
        }
      }
      raw = second.text
      parsed = parseFullText(raw)
    }

    if (!parsed) {
      return {
        ok: false,
        kind: "response",
        message: "The AI did not return a valid study pack for this topic. Please try again.",
      }
    }

    let verified = false
    let removedClaims: string[] = []
    let verificationNote: string | undefined
    if (grounded) {
      const rawJson = stripCodeFences(raw)
      const checked = await verifyPackText(
        rawJson,
        groundingBlock,
        (json) => parseFullText(json) !== null,
      )
      verified = checked.verified
      removedClaims = checked.removed
      verificationNote = checked.note
      if (checked.packText !== rawJson) {
        const revisedParsed = parseFullText(checked.packText)
        if (revisedParsed) parsed = revisedParsed
      }
    }

    const ungrounded = !grounded
    const limitedSources = ungrounded || sources.length < 3

    return {
      ok: true,
      pack: {
        title: topic,
        level: level !== "" ? level : undefined,
        intro: parsed.intro,
        sections: parsed.sections,
        mcqs: parsed.mcqs,
        essays: parsed.essays,
        sources,
        limitedSources,
        ungrounded,
        groundingNote,
        verified,
        removedClaims,
        verificationNote,
      },
    }
  } catch (err) {
    return classify(err, model)
  }
}