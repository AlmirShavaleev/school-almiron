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
 *   1. trim whitespace
 *   2. replace decimal comma with dot
 *   3. collapse internal whitespace runs to a single space
 *   4. lowercase
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .trim()
    .replace(',', '.')
    .replace(/\s+/g, ' ')
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
