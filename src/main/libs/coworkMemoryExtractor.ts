const CHINESE_QUESTION_PREFIX_RE =
  /^(?:请问|问下|问一下|是否|能否|可否|为什么|为何|怎么|如何|谁|什么|哪(?:里|儿|个)?|几|多少|要不要|会不会|是不是|能不能|可不可以|行不行|对不对|好不好)/u
const ENGLISH_QUESTION_PREFIX_RE =
  /^(?:what|who|why|how|when|where|which|is|are|am|do|does|did|can|could|would|will|should)\b/i
const QUESTION_INLINE_RE = /(是不是|能不能|可不可以|要不要|会不会|有没有|对不对|好不好)/i
const QUESTION_SUFFIX_RE = /(吗|么|呢|嘛)\s*$/u

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function isQuestionLikeMemoryText(text: string): boolean {
  const normalized = normalizeText(text)
    .replace(/[。！!]+$/g, '')
    .trim()
  if (!normalized) return false
  if (/[？?]\s*$/.test(normalized)) return true
  if (CHINESE_QUESTION_PREFIX_RE.test(normalized)) return true
  if (ENGLISH_QUESTION_PREFIX_RE.test(normalized)) return true
  if (QUESTION_INLINE_RE.test(normalized)) return true
  if (QUESTION_SUFFIX_RE.test(normalized)) return true
  return false
}
