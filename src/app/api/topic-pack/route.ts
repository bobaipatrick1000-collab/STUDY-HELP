import { generateTopicPack } from "@/lib/topicPack"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    return await handle(request)
  } catch (err) {
    console.error("topic-pack route failed:", err)
    return Response.json(
      { ok: false, kind: "service", error: "Something went wrong while building the study pack. Please try again." },
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

  const rawTopic = record.topic
  const topic = typeof rawTopic === "string" ? rawTopic.trim() : ""
  if (topic === "") {
    return Response.json({ ok: false, error: "Topic is required." }, { status: 400 })
  }
  if (topic.length > 200) {
    return Response.json({ ok: false, error: "Topic is too long. Use at most 200 characters." }, { status: 400 })
  }

  const rawLevel = record.level
  const level = typeof rawLevel === "string" ? rawLevel.trim().slice(0, 200) : ""

  const fresh = record.fresh === true

  const result = await generateTopicPack({ topic, level, fresh })

  if (result.ok) {
    return Response.json({ ok: true, pack: result.pack })
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