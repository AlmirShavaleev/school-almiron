/**
 * Post-load classifier for TeX-rendered answer-template blanks (А|Б, А|Б|В tables).
 *
 * Classification requires ALL four criteria:
 *   1. class="math-display" — TeX block SVG, not an inline math formula
 *   2. naturalWidth ≤ 220 AND naturalHeight ≤ 180 — excludes large condition tables (600-1200px)
 *   3. aspect ratio < 5:1 — excludes long horizontal formulas (e.g. E = mc² at 400×25px)
 *   4. alt matches an ASCII-table or Cyrillic column-header pattern
 *
 * NOT classified as answer-template:
 *   - Inline formulas (class="math", hasMathDisplay=false) → fails criterion 1
 *   - Condition/solution diagrams 600-1200px wide → fails criterion 2
 *   - Long formula SVGs with ultra-wide aspect ratio → fails criterion 3
 *   - Small diagrams / physics symbols / fractions without table markers → fails criterion 4
 */
export function isAnswerTemplateSvg(
  naturalWidth:  number,
  naturalHeight: number,
  hasMathDisplay: boolean,
  alt: string,
): boolean {
  if (!hasMathDisplay) return false
  if (naturalWidth > 220 || naturalHeight > 180) return false
  if (naturalHeight > 0 && naturalWidth / naturalHeight >= 5) return false
  // Alt must signal a blank answer form:
  //   Pattern 1: ASCII-table row  |--|--|  (TeX-generated blank tables)
  //   Pattern 2: Cyrillic column  А-|  or  |А-  (А, Б, В header cells with dash separator)
  return (
    /^\s*\|[-|]/.test(alt) ||
    /[АБВ]-\|/.test(alt)   ||
    /\|[АБВ]-/.test(alt)
  )
}
