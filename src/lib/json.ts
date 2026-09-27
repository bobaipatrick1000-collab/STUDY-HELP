export function stripCodeFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) return fenced[1].trim()
  return text.trim()
}

export function balancedJson(text: string): unknown | undefined {
  const start = text.indexOf("{")
  if (start === -1) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === "{") {
      depth++
      continue
    }
    if (ch === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

export function parseJsonSmart(text: string): unknown | undefined {
  const cleaned = stripCodeFences(text)
  try {
    return JSON.parse(cleaned)
  } catch {
    const balanced = balancedJson(cleaned)
    if (balanced !== undefined) return balanced
    return repairJson(cleaned)
  }
}

function repairJson(text: string): unknown | undefined {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "]") {
      const candidate = text.slice(0, i) + "}" + text.slice(i)
      try {
        const value = JSON.parse(candidate)
        if (value && typeof value === "object") return value
      } catch {
        // keep trying
      }
    }
  }
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === "}") {
      const candidate = text.slice(0, i) + "]" + text.slice(i)
      try {
        const value = JSON.parse(candidate)
        if (value && typeof value === "object") return value
      } catch {
        // keep trying
      }
    }
  }
  return undefined
}