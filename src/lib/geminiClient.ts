export function statusOf(err: unknown): number | null {
  if (err && typeof err === "object") {
    const candidate = (err as { status?: unknown }).status
    if (typeof candidate === "number") return candidate
    const statusCode = (err as { statusCode?: unknown }).statusCode
    if (typeof statusCode === "number") return statusCode
  }
  return null
}

export function messageOf(err: unknown): string {
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message
    if (typeof m === "string") return m
  }
  return "Unknown error"
}

export function isRetryable(err: unknown): boolean {
  const status = statusOf(err)
  if (status === 429 || status === 503) return true
  const lower = messageOf(err).toLowerCase()
  return (
    lower.includes("resource_exhausted") ||
    lower.includes("before finishing") ||
    lower.includes("finish_reason:") ||
    lower.includes("finishreason:")
  )
}

export function isDailyQuota(err: unknown): boolean {
  const lower = messageOf(err).toLowerCase()
  return (
    lower.includes("perday") ||
    lower.includes("per day") ||
    lower.includes("requests_per_day") ||
    lower.includes("_perday")
  )
}

function retryAfterMs(err: unknown): number | null {
  const headers = (err as { response?: { headers?: { get?: (k: string) => string | null } } })
    ?.response?.headers
  const value = headers?.get?.("retry-after")
  if (typeof value === "string" && value !== "") {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000)
  }
  return null
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function callWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (!isRetryable(err) || isDailyQuota(err) || i === attempts - 1) throw err
      await sleep(retryAfterMs(err) ?? 3_000 + Math.floor(Math.random() * 2_000))
    }
  }
  throw last
}

export function affordableTokens(err: unknown): number | null {
  const match = messageOf(err).match(/can only afford (\d+)/i)
  if (!match) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function billingMessage(err: unknown): string | null {
  const status = statusOf(err)
  const lower = messageOf(err).toLowerCase()
  const isBilling =
    status === 402 ||
    lower.includes("insufficient") ||
    lower.includes("funds") ||
    lower.includes("payment") ||
    lower.includes("billing") ||
    lower.includes("credit")
  if (!isBilling) return null

  const affordable = affordableTokens(err)
  if (affordable !== null) {
    return (
      "Your OpenRouter balance is too low for this request. It can currently afford about " +
      String(affordable) +
      " output tokens, but the app asked for more. Add credits at openrouter.ai/settings/credits, " +
      "or pick a cheaper model in AI_MODEL in .env.local."
    )
  }
  return "Your AI provider has no credits for this request. Add credits on OpenRouter (openrouter.ai) or Google AI Studio, then try again."
}

export function rateLimitMessage(err: unknown, model: string): string {
  if (isDailyQuota(err)) {
    return (
      'Google free tier ran out of requests for the model "' +
      model +
      '" today. Daily limits reset at midnight Pacific Time. For a much larger free allowance, set AI_MODEL=gemini-3.5-flash-lite in .env.local and restart the dev server.'
    )
  }
  return "The AI hit a rate limit. Wait about a minute, then try again."
}