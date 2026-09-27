import { generateEssayAnswer } from "@/lib/essayAnswer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    return await handle(request)
  } catch (err) {
    console.error("essay-answer route failed:", err)
    return Response.json(
      { ok: false, kind: "service", error: "Something went wrong. Please try again." },
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

  const title = typeof record.title === "string" ? record.title.trim() : ""
  const question = typeof record.question === "string" ? record.question.trim() : ""
  const fresh = record.fresh === true

  if (!title) {
    return Response.json({ ok: false, error: "A topic is required." }, { status: 400 })
  }
  if (title.length > 200) {
    return Response.json({ ok: false, error: "The topic is too long." }, { status: 400 })
  }
  if (!question) {
    return Response.json({ ok: false, error: "An essay question is required." }, { status: 400 })
  }
  if (question.length > 2000) {
    return Response.json(
      { ok: false, error: "The question is too long." },
      { status: 400 },
    )
  }

  const result = await generateEssayAnswer({ title, question, fresh })

  if (result.ok) {
    return Response.json({
      ok: true,
      answer: result.answer,
      sources: result.sources,
      ungrounded: result.ungrounded,
      verified: result.verified,
      removed: result.removed,
      verificationNote: result.verificationNote,
    })
  }

  const status =
    result.kind === "rate-limit"
      ? 429
      : result.kind === "config"
        ? 500
        : 502

  return Response.json({ ok: false, kind: result.kind, error: result.message }, { status })
}