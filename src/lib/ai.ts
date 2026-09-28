import { GoogleGenAI } from "@google/genai"
import { affordableTokens } from "./geminiClient"

export type AiProvider = "google" | "openrouter"

export interface GroundedChunk {
  web?: { title?: string; uri?: string }
}

export interface AiTextResult {
  text: string
  groundingChunks: GroundedChunk[]
}

export interface AiGenerateInput {
  systemPrompt: string
  userContent: string
  temperature: number
  maxOutputTokens: number
  toolsGoogleSearch?: boolean
}

export function resolveProvider(): AiProvider {
  const explicit = (process.env.AI_PROVIDER ?? "").trim().toLowerCase()
  if (explicit === "google" || explicit === "openrouter") return explicit
  return process.env.OPENROUTER_API_KEY ? "openrouter" : "google"
}

export function resolveModel(): string {
  const fromEnv = (process.env.AI_MODEL ?? "").trim()
  if (fromEnv !== "") return fromEnv
  return resolveProvider() === "google" ? "gemini-3.5-flash-lite" : "openai/gpt-4o-mini"
}

export function resolveConfigError(): string | null {
  if (resolveProvider() === "google") {
    return process.env.GEMINI_API_KEY
      ? null
      : "GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server."
  }
  return process.env.OPENROUTER_API_KEY
    ? null
    : "OPENROUTER_API_KEY is not set. Add your OpenRouter key to .env.local and restart the dev server."
}

async function generateGoogleText(input: AiGenerateInput): Promise<AiTextResult> {
  const ai = new GoogleGenAI()
  const response = (await ai.models.generateContent({
    model: resolveModel(),
    contents: input.userContent,
    config: {
      systemInstruction: input.systemPrompt,
      temperature: input.temperature,
      responseMimeType: "application/json",
      maxOutputTokens: input.maxOutputTokens,
      ...(input.toolsGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  })) as {
    text?: string | null
    candidates?: Array<{
      finishReason?: string | null
      groundingMetadata?: { groundingChunks?: GroundedChunk[] }
    }>
  }
  const finishReason = response.candidates?.[0]?.finishReason
  if (finishReason === "MAX_TOKENS" || finishReason === "SAFETY") {
    const err = new Error(
      "The model stopped before finishing its output (finishReason: " +
        finishReason +
        "). Retrying may help.",
    ) as Error & { status?: number }
    throw err
  }
  return {
    text: typeof response.text === "string" ? response.text : "",
    groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [],
  }
}

async function generateOpenRouterText(input: AiGenerateInput): Promise<AiTextResult> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim()
  if (apiKey === "") {
    const err = new Error("OPENROUTER_API_KEY is not set.") as Error & { status?: number }
    err.status = 401
    throw err
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: resolveModel(),
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userContent },
      ],
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
    }),
  })

  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{
      message?: { content?: string }
      finish_reason?: string | null
    }>
    error?: { message?: string }
  } | null

  if (!res.ok) {
    const remote = data?.error?.message
    const raw = remote && remote !== "" ? remote : "OpenRouter request failed with status " + res.status + "."
    const err = new Error(raw) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const choice = data?.choices?.[0]
  const text = choice?.message?.content
  if (typeof text !== "string") return { text: "", groundingChunks: [] }

  const finishReason = choice?.finish_reason ?? ""
  if (finishReason === "length" || finishReason === "content_filter") {
    const err = new Error(
      "The model stopped before finishing its output (finish_reason: " +
        finishReason +
        "). Retrying may help.",
    ) as Error & { status?: number }
    throw err
  }

  return { text: text.trim(), groundingChunks: [] }
}

export async function aiGenerateText(input: AiGenerateInput): Promise<AiTextResult> {
  if (resolveProvider() === "google") return generateGoogleText(input)
  return generateOpenRouterText(input)
}

export async function callWithBudgetFallback(
  fn: (maxOutputTokens: number) => Promise<AiTextResult>,
  requested: number,
): Promise<AiTextResult> {
  try {
    return await fn(requested)
  } catch (err) {
    const affordable = affordableTokens(err)
    if (affordable === null) throw err
    const reduced = Math.max(1_024, Math.min(requested, affordable - 256))
    console.warn(
      "AI call failed for budget reasons; retrying with maxOutputTokens",
      requested,
      "->",
      reduced,
    )
    return await fn(reduced)
  }
}