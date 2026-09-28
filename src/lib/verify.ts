import { aiGenerateText, callWithBudgetFallback } from "./ai"
import { callWithRetry } from "./geminiClient"
import { parseJsonSmart, stripCodeFences } from "./json"

export interface VerifyTextResult {
  verified: boolean
  revised: string
  removed: string[]
  note?: string
}

export interface VerifyPackResult {
  verified: boolean
  packText: string
  removed: string[]
  note?: string
}

const VERIFY_TEXT_SYSTEM_PROMPT = `You check whether a written answer contradicts or overreaches its cited sources.

You will receive the exact retrieved web source text the answer was originally written from, followed by the draft answer. The draft cites facts with [n], where [n] refers to a numbered source above.

Task:
1. Flag every claim that is NOT directly supported by the retrieved source text. This includes invented numbers, names, dates, quotes, or events, and claims cited to a source that does not actually support them.
2. Rewrite the answer so it contains only claims directly supported by the sources. Remove unsupported claims, or reword them to stay strictly accurate to what the sources say. If a claim is cited [n] but the source does not support it, drop the claim or the citation.
3. Do not add new facts, do not soften claims the sources do support, and keep the answer fluent and complete.

Return ONLY valid JSON with no explanation and no markdown code fences:
{"revised":"<the full rewritten answer>","removed":["<short description of each removed or reworded claim>"]}

If every claim is supported, return the input unchanged with an empty "removed" array.`;

const VERIFY_PACK_SYSTEM_PROMPT = `You check whether part of a study pack contradicts or overreaches its cited sources.

You will receive the exact retrieved web source text the study pack was originally written from, followed by part of the study pack. The pack cites facts with [n], where [n] refers to a numbered source above.

Task:
1. Identify every claim in the study pack part that is NOT directly supported by the retrieved source text. This includes invented numbers, names, dates, quotes, or events, claims cited to a source that does not actually support them, and cards that are near-duplicates of another card.
2. For each unsupported or duplicate claim, write a short description (one or two sentences) naming the offending card or objective and why it was removed.

Do NOT reproduce the study pack. List only the claims that must be removed.

Return ONLY valid JSON with no explanation and no markdown code fences:
{"removed":["<short description of each claim to remove>"]}

If everything is supported, return only {"removed":[]}.`;

function parseRemovedOnly(text: string): { removed: string[]; parsed: boolean } {
  const cleaned = stripCodeFences(text)
  const parsed = parseJsonSmart(text)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.removed)) {
      return {
        removed: record.removed.filter((x): x is string => typeof x === "string").slice(0, 20),
        parsed: true,
      }
    }
  }
  const recovered = extractRemovedList(cleaned)
  if (recovered.length > 0) return { removed: recovered, parsed: true }
  return { removed: [], parsed: false }
}

function extractRemovedList(text: string): string[] {
  const match = /"removed"\s*:\s*\[([\s\S]*?)\]\s*\}\s*$/.exec(stripCodeFences(text))
  if (!match) return []
  try {
    const arr = JSON.parse("[" + match[1] + "]")
    if (Array.isArray(arr)) {
      return arr.filter((x): x is string => typeof x === "string").slice(0, 20)
    }
  } catch {
    return []
  }
  return []
}

function parseVerifyResponse(
  text: string,
  fallbackRevised: string,
): { revised: string; removed: string[]; parsed: boolean } {
  const cleaned = stripCodeFences(text)
  const parsed = parseJsonSmart(text)
  if (!parsed || typeof parsed !== "object") {
    return { revised: fallbackRevised, removed: [], parsed: false }
  }
  const record = parsed as Record<string, unknown>
  let revised = ""
  if (typeof record.revised === "string") {
    revised = record.revised.trim()
  } else if (record.revised && typeof record.revised === "object") {
    revised = JSON.stringify(record.revised)
  } else if (typeof record.answer === "string" && record.answer.trim() !== "") {
    revised = record.answer.trim()
  } else if (typeof record.content === "string" && record.content.trim() !== "") {
    revised = record.content.trim()
  } else if (
    typeof record.intro === "string" &&
    (Array.isArray(record.sections) ||
      Array.isArray(record.mcqs) ||
      Array.isArray(record.essays))
  ) {
    revised = JSON.stringify(record)
  }
  if (revised === "") return { revised: fallbackRevised, removed: [], parsed: false }
  let removed = Array.isArray(record.removed)
    ? (record.removed.filter((x): x is string => typeof x === "string").slice(0, 20) ?? [])
    : []
  if (removed.length === 0 && Array.isArray(record.removed) === false) {
    const recoveredRemoved = extractRemovedList(cleaned)
    if (recoveredRemoved.length > 0) removed = recoveredRemoved
  }
  return { revised, removed, parsed: true }
}

export async function verifyTextDraft(
  draft: string,
  sourceBlock: string,
): Promise<VerifyTextResult> {
  if (draft.trim() === "" || sourceBlock.trim() === "") {
    return {
      verified: false,
      revised: draft,
      removed: [],
      note: "Verification skipped: no retrieved source text was available.",
    }
  }
  const userContent =
    "Retrieved web source text:\n\n" +
    sourceBlock +
    "\n\n---\n\nDraft answer to check:\n\n" +
    draft

  let lastNote = "The source-conformance check could not run, so the answer was returned unchanged."
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: { text: string }
    try {
      response = await callWithRetry(() =>
        callWithBudgetFallback(
          (maxOutputTokens) =>
            aiGenerateText({
              systemPrompt: VERIFY_TEXT_SYSTEM_PROMPT,
              userContent,
              temperature: 0,
              maxOutputTokens,
            }),
          4096,
        ),
      )
    } catch (err) {
      // Safe fallback: if the verification pass fails, keep the draft untouched.
      console.error("verifyTextDraft failed:", err)
      break
    }
    if (response.text === "") {
      lastNote = "The verification pass returned an empty result, so the answer was returned unchanged."
      continue
    }
    const parsed = parseVerifyResponse(response.text, draft)
    if (!parsed.parsed) {
      lastNote =
        "The verification pass could not parse its output, so the answer was returned unchanged."
      continue
    }
    return { verified: true, revised: parsed.revised, removed: parsed.removed }
  }
  return { verified: false, revised: draft, removed: [], note: lastNote }
}

async function runSegmentVerify(
  userContent: string,
): Promise<{ ok: true; removed: string[] } | { ok: false; apiError?: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: { text: string }
    try {
      response = await callWithRetry(() =>
        callWithBudgetFallback(
          (maxOutputTokens) =>
            aiGenerateText({
              systemPrompt: VERIFY_PACK_SYSTEM_PROMPT,
              userContent,
              temperature: 0,
              maxOutputTokens,
            }),
          4096,
        ),
      )
    } catch (err) {
      console.error("verifyPackText failed:", err)
      return { ok: false, apiError: true }
    }
    if (response.text === "") continue
    const parsed = parseRemovedOnly(response.text)
    if (!parsed.parsed) {
      console.error(
        "verifyPackText segment parse failure. len=" +
          response.text.length +
          " head=" +
          JSON.stringify(response.text.slice(0, 80)) +
          " tail=" +
          JSON.stringify(response.text.slice(-120)),
      )
      continue
    }
    return { ok: true, removed: parsed.removed }
  }
  return { ok: false }
}

export async function verifyPackText(
  packJson: string,
  sourceBlock: string,
  accepts: (revisedJson: string) => boolean,
): Promise<VerifyPackResult> {
  if (packJson.trim() === "" || sourceBlock.trim() === "") {
    return {
      verified: false,
      packText: packJson,
      removed: [],
      note: "Verification skipped: no retrieved source text was available.",
    }
  }
  let pack: Record<string, unknown>
  try {
    pack = JSON.parse(packJson) as Record<string, unknown>
  } catch {
    return {
      verified: false,
      packText: packJson,
      removed: [],
      note: "Verification skipped because the draft pack was not valid JSON.",
    }
  }
  if (typeof pack !== "object" || Array.isArray(pack)) {
    return {
      verified: false,
      packText: packJson,
      removed: [],
      note: "Verification skipped because the draft pack was not an object.",
    }
  }

  const head = JSON.stringify({
    intro: pack.intro,
    sections: pack.sections,
    mcqs: pack.mcqs,
  })
  const tail = JSON.stringify({ essays: pack.essays })

  let parsedHead: Record<string, unknown>
  let parsedTail: Record<string, unknown>
  try {
    parsedHead = JSON.parse(head) as Record<string, unknown>
    parsedTail = JSON.parse(tail) as Record<string, unknown>
  } catch {
    return {
      verified: false,
      packText: packJson,
      removed: [],
      note: "Verification skipped because the draft pack was not valid JSON.",
    }
  }

  const block = "Retrieved web source text:\n\n" + sourceBlock + "\n\n---\n\nDraft study pack (JSON part) to check for unsupported claims:\n\n"

  const headResult = await runSegmentVerify(block + head)
  const tailResult = headResult.ok ? await runSegmentVerify(block + tail) : headResult

  if (!headResult.ok || !tailResult.ok) {
    const apiError =
      (headResult.ok === false && headResult.apiError === true) ||
      (tailResult.ok === false && tailResult.apiError === true)
    return {
      verified: false,
      packText: packJson,
      removed: [],
      note: apiError
        ? "Source verification could not run because the AI service is unavailable or out of credits, so the original pack was kept."
        : "The verification pass could not parse its output, so the original pack was kept.",
    }
  }

  const merged = { ...parsedHead, ...parsedTail }
  const mergedJson = JSON.stringify(merged)
  if (!accepts(mergedJson)) {
    return {
      verified: false,
      packText: packJson,
      removed: [],
      note: "The verification pass returned an invalid study pack, so the original pack was kept.",
    }
  }
  return {
    verified: true,
    packText: mergedJson,
    removed: [...headResult.removed, ...tailResult.removed],
  }
}