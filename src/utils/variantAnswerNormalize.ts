/**
 * Client-side mirror of the server-side normalize_variant_answer() and
 * strip_html_simple() SQL functions.  Both must stay in sync with the DB.
 */

/** Strip HTML tags (simple regex — matches server strip_html_simple). */
export function stripHtmlSimple(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

/**
 * Normalise a student-typed answer:
 *   1. replace EVERY decimal comma with a dot
 *   2. collapse whitespace runs to a single space
 *   3. trim the edges
 *   4. lowercase
 *
 * Порядок повторяет SQL и важен в обе стороны:
 *
 * - Обрезка идёт ПОСЛЕ схлопывания. Неразрывный пробел не убирается trim'ом,
 *   но попадает под \s и превращается в обычный — если обрезать раньше, он
 *   остаётся в начале строки и ответ перестаёт быть числом (§62).
 * - Заменяются ВСЕ запятые. `String.replace` со строковым образцом меняет
 *   только первую, из-за чего клиент и сервер расходились на ответах вроде
 *   «1,2,3»: SQL `replace()` менял все, JS — одну.
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Strict full-string numeric check (no parseFloat partial matching). */
const NUMERIC_RE = /^-?[0-9]+(\.[0-9]+)?$/

export function isNumeric(s: string): boolean {
  return NUMERIC_RE.test(s)
}

/**
 * True when the correct answer (stripped + normalised) is a pure number and
 * can therefore be auto-checked without a teacher.
 */
export function isAutoCheckable(answerHtml: string | null | undefined): boolean {
  if (!answerHtml) return false
  const norm = normalizeAnswer(stripHtmlSimple(answerHtml))
  return isNumeric(norm)
}

export type PartialCheckType = 'multi_choice' | 'matching' | null

export function normalizeAnswerDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function scorePartialMultiChoice(studentRaw: string, correctRaw: string): 0 | 1 | 2 {
  const student = normalizeAnswerDigits(studentRaw)
  const correct = normalizeAnswerDigits(correctRaw)
  if (!student || !correct) return 0

  const countDigits = (value: string) => {
    const counts: Record<string, number> = {}
    for (const digit of value) counts[digit] = (counts[digit] ?? 0) + 1
    return counts
  }

  const studentCounts = countDigits(student)
  const correctCounts = countDigits(correct)
  const allDigits = new Set([...Object.keys(studentCounts), ...Object.keys(correctCounts)])
  let diff = 0

  for (const digit of allDigits) {
    diff += Math.abs((studentCounts[digit] ?? 0) - (correctCounts[digit] ?? 0))
  }

  if (diff === 0) return 2
  if (diff === 1) return 1
  return 0
}

export function scorePartialMatching(studentRaw: string, correctRaw: string): 0 | 1 | 2 {
  const student = normalizeAnswerDigits(studentRaw)
  const correct = normalizeAnswerDigits(correctRaw)
  if (!student || !correct) return 0
  if (student.length > correct.length) return 0

  let mismatches = 0
  for (let i = 0; i < correct.length; i++) {
    if (student[i] !== correct[i]) mismatches += 1
  }

  if (mismatches === 0) return 2
  if (mismatches === 1) return 1
  return 0
}

export function scoreAutoAnswer(studentRaw: string, correctRaw: string, partialType: PartialCheckType): 0 | 1 | 2 {
  const correctDigits = normalizeAnswerDigits(stripHtmlSimple(correctRaw))
  if (partialType === 'multi_choice') return scorePartialMultiChoice(studentRaw, correctDigits)
  if (partialType === 'matching') return scorePartialMatching(studentRaw, correctDigits)

  const studentNorm = normalizeAnswer(studentRaw)
  const correctNorm = normalizeAnswer(stripHtmlSimple(correctRaw))
  return studentNorm !== '' && studentNorm === correctNorm ? 1 : 0
}
