import { aiGenerateText } from "./ai"
import { callWithRetry } from "./geminiClient"
import type { SearchResult } from "./search"

const RELEVANCE_SYSTEM_PROMPT = `You decide whether a set of web search results genuinely covers a study topic.

You will receive a topic and the titles, URLs, and short snippets of the results a search engine returned for it. Decide whether these results provide real educational material to study this topic.

Answer false when:
- The topic is nonsense, gibberish, or a made-up term, and the results merely happen to match one or two ordinary words in it.
- The results are only tangentially related (e.g. a lab homepage or unrelated article) and do not actually explain the topic.
- The topic is so obscure that nothing returned is really about it.

Answer true when the results clearly explain, teach, or define the topic.

Return ONLY valid JSON with no explanation and no markdown code fences:
{"relevant":true}

or

{"relevant":false}`;

export async function isTopicCovered(topic: string, results: SearchResult[]): Promise<boolean> {
  if (results.length === 0) return false
  try {
    const sample = results
      .slice(0, 8)
      .map(
        (r) =>
          r.title +
          " — " +
          r.url +
          (r.snippet !== "" ? " :: " + r.snippet.slice(0, 140) : ""),
      )
      .join("\n")
    const response = await callWithRetry(() =>
      aiGenerateText({
        systemPrompt: RELEVANCE_SYSTEM_PROMPT,
        userContent: "Topic: " + topic + "\n\nReturned web results:\n" + sample,
        temperature: 0,
        maxOutputTokens: 400,
      }),
    )
    const cleaned = response.text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return true
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>
      if (typeof record.relevant === "boolean") return record.relevant
    }
    return true
  } catch (err) {
    // Safe fallback: if the relevance check cannot run, keep the sources.
    console.error("isTopicCovered failed:", err)
    return true
  }
}