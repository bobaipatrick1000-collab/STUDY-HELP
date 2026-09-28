import { generateQuizOptions, type QuizOptionCard } from "@/lib/quizOptions"
import type { TopicSource } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    return await handle(request)
  } catch (err) {
    console.error("quiz-options route failed:", err)
    return Response.json(
      { ok: false, kind: "service", error: "Something went wrong while generating quiz options. Please try again." },
      { status: 500 },
    )
  }
}

async function handle(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON body." }, { status: 400 })
  }

  const record = (body ?? {}) as Record<string, unknown>
  const rawCards = Array.isArray(record.cards) ? record.cards : []
  const rawSources = Array.isArray(record.sources) ? record.sources : []

  const sources: TopicSource[] = []
  for (const entry of rawSources.slice(0, 20)) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const url = typeof item.url === "string" ? item.url.trim() : ""
    const title = typeof item.title === "string" ? item.title.trim() : ""
    if (!url) continue
    sources.push({ url, title: title !== "" ? title : url })
  }

  const cards: QuizOptionCard[] = []
  const seen = new Set<string>()
  for (const entry of rawCards) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const cardId = typeof item.cardId === "string" ? item.cardId.trim() : ""
    const question = typeof item.question === "string" ? item.question.trim() : ""
    const answer = typeof item.answer === "string" ? item.answer.trim() : ""
    if (!cardId || !question || !answer) continue
    if (seen.has(cardId)) {
      return Response.json(
        { ok: false, error: "Duplicate cardId in the request." },
        { status: 400 },
      )
    }
    seen.add(cardId)
    cards.push({ cardId, question, answer })
  }

  if (cards.length === 0) {
    return Response.json({ ok: false, error: "Send at least one card." }, { status: 400 })
  }
  if (cards.length > 100) {
    return Response.json({ ok: false, error: "Too many cards. Send at most 100." }, { status: 400 })
  }

  const result = await generateQuizOptions(cards, { sources })

  if (result.ok) {
    return Response.json({
      ok: true,
      options: cards.map((c) => ({ cardId: c.cardId, choices: result.options[c.cardId] })),
    })
  }

  const status =
    result.kind === "billing"
      ? 402
      : result.kind === "rate-limit"
      ? 429
      : result.kind === "config"
        ? 500
        : 502

  return Response.json({ ok: false, kind: result.kind, error: result.message }, { status })
}