import { generateCards } from "@/lib/generate"
import { CARD_COUNTS, NOTES_MAX_LENGTH } from "@/lib/constants"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    return await handle(request)
  } catch (err) {
    console.error("generate route failed:", err)
    return Response.json(
      { ok: false, kind: "service", error: "Something went wrong while generating cards. Please try again." },
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

  const focus = typeof record.focus === "string" ? record.focus.trim() : ""
  const notes = typeof record.notes === "string" ? record.notes : ""
  const count = record.count

  if (!focus) {
    return Response.json({ ok: false, error: "Add a focus first." }, { status: 400 })
  }
  if (notes.length > NOTES_MAX_LENGTH) {
    return Response.json(
      { ok: false, error: `Notes must be at most ${NOTES_MAX_LENGTH} characters.` },
      { status: 400 },
    )
  }
  if (typeof count !== "number" || !CARD_COUNTS.includes(count as (typeof CARD_COUNTS)[number])) {
    return Response.json({ ok: false, error: "Choose 5, 10, or 20 cards." }, { status: 400 })
  }

  const result = await generateCards({ focus, notes, count })

  if (result.ok) {
    return Response.json({
      ok: true,
      cards: result.cards,
      sources: result.sources,
      ungrounded: result.ungrounded,
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