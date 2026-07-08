/**
 * Pure helper functions for the variant PDF/print pipeline.
 * No DOM/React here so they stay trivially unit-testable.
 */
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'
import type { VariantPrintSettings } from '@/types/variantPrint'

export type PrintableTask = CatalogTask & {
  assets?: CatalogTaskAsset[]
  source_url?: string | null
  sectionTitle?: string | null
}

export interface PrintableItem {
  id: string
  task?: PrintableTask
  customNumber?: string | null
}

// ── File name ────────────────────────────────────────────────────────────────

const SUBJECT_SLUGS: Record<string, string> = {
  'Математика': 'math',
  'Физика': 'physics',
  math: 'math',
  physics: 'physics',
}

const EXAM_SLUGS: Record<string, string> = {
  'ЕГЭ': 'ege',
  'ОГЭ': 'oge',
  ege: 'ege',
  oge: 'oge',
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'variant'
}

/**
 * Builds a deterministic PDF file name for a variant document. Used as
 * document.title before window.print() so "Save as PDF" defaults to it.
 *
 * Examples:
 *   buildVariantFileName('Физика', 'ЕГЭ', '57189903')
 *     -> 'school-almiron-physics-variant-57189903.pdf'
 *   buildVariantFileName('Математика', 'ЕГЭ', undefined, new Date('2026-06-30'))
 *     -> 'school-almiron-math-2026-06-30.pdf'
 */
export function buildVariantFileName(
  subject: string,
  examType: string,
  variantNumber?: string | null,
  fallbackDate: Date = new Date(),
): string {
  const subjectSlug = SUBJECT_SLUGS[subject] ?? slugify(subject)
  const examSlug = EXAM_SLUGS[examType] ?? slugify(examType)
  const parts = ['school-almiron', subjectSlug]
  if (examSlug) parts.push(examSlug)

  const trimmedNumber = variantNumber?.trim()
  if (trimmedNumber) {
    parts.push('variant', slugify(trimmedNumber))
  } else {
    const y = fallbackDate.getFullYear()
    const m = String(fallbackDate.getMonth() + 1).padStart(2, '0')
    const d = String(fallbackDate.getDate()).padStart(2, '0')
    parts.push(`${y}-${m}-${d}`)
  }

  return `${parts.join('-')}.pdf`
}

// ── Metadata filtering ──────────────────────────────────────────────────────

/** Returns a trimmed source URL string, or null when there's nothing to show. */
export function resolveSourceLabel(task: Pick<PrintableTask, 'source_url'>): string | null {
  const url = task.source_url?.trim()
  return url ? url : null
}

/** Returns the section title to display, or null when there's nothing to show. */
export function resolveSectionLabel(task: Pick<PrintableTask, 'sectionTitle'>): string | null {
  const title = task.sectionTitle?.trim()
  return title ? title : null
}

// ── Answers list ─────────────────────────────────────────────────────────────

export interface AnswerEntry {
  itemId: string
  number: string
  answerHtml: string
}

/**
 * Builds the ordered "Ответы" list: one entry per item that has a task with
 * has_answer=true and non-empty answer_html. Skips everything else instead
 * of rendering placeholder "no data" text.
 */
export function buildAnswersList(
  items: PrintableItem[],
  resolveHtml: (html: string | null | undefined, assets: CatalogTaskAsset[] | undefined) => string,
): AnswerEntry[] {
  const entries: AnswerEntry[] = []
  items.forEach((item, idx) => {
    const task = item.task
    if (!task || !task.has_answer || !task.answer_html) return
    const html = resolveHtml(task.answer_html, task.assets)
    if (!html) return
    entries.push({
      itemId: item.id,
      number: item.customNumber ?? String(idx + 1),
      answerHtml: html,
    })
  })
  return entries
}

// ── Key table ────────────────────────────────────────────────────────────────

export interface KeyEntry {
  itemId: string
  number: string
  shortAnswer: string
}

/** Strips HTML tags and collapses whitespace for a compact plain-text answer. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Builds the compact "Ключ" table: task number -> short plain-text answer.
 * Only includes items whose task has has_answer=true (per spec — no
 * invented "difficulty"/"rule" fields).
 */
export function buildKeyTable(items: PrintableItem[]): KeyEntry[] {
  const entries: KeyEntry[] = []
  items.forEach((item, idx) => {
    const task = item.task
    if (!task || !task.has_answer || !task.answer_html) return
    const shortAnswer = htmlToPlainText(task.answer_html)
    if (!shortAnswer) return
    entries.push({
      itemId: item.id,
      number: item.customNumber ?? String(idx + 1),
      shortAnswer,
    })
  })
  return entries
}

// ── Print page setup ─────────────────────────────────────────────────────────

export function marginsToCss(margins: VariantPrintSettings['margins']): string {
  return margins === 'wide' ? '25mm 20mm' : '15mm 12mm'
}

export function fontSizeToCss(fontSize: VariantPrintSettings['fontSize']): string {
  // ~30% smaller than the previous 13pt/11.5pt — a literal /2 (6.5pt/5.75pt)
  // was illegible on paper and disproportionate to formula images (SVGs,
  // which don't scale with text CSS).
  return fontSize === 'large' ? '9pt' : '8pt'
}

/**
 * Height of the printable content area (page height minus top+bottom
 * margins), in mm. Used by worksheet mode to size the ruled-grid field so it
 * reaches exactly to the bottom margin regardless of orientation/margins.
 * Mirrors the mm values in marginsToCss() and the A4 dimensions in @page.
 */
export function printContentHeightMm(
  orientation: VariantPrintSettings['orientation'],
  margins: VariantPrintSettings['margins'],
): number {
  const pageHeightMm = orientation === 'landscape' ? 210 : 297
  const verticalMarginMm = margins === 'wide' ? 25 : 15
  return pageHeightMm - 2 * verticalMarginMm
}

/**
 * Width of the printable content area (page width minus left+right margins),
 * in mm. Used by worksheet mode to know how many vertical grid lines span the
 * ruled field's width — the field's rendered width always equals this value
 * (same column as the task statement above it), so it can be computed from
 * the settings alone, no DOM measurement needed. Mirrors marginsToCss().
 */
export function printContentWidthMm(
  orientation: VariantPrintSettings['orientation'],
  margins: VariantPrintSettings['margins'],
): number {
  const pageWidthMm = orientation === 'landscape' ? 297 : 210
  const horizontalMarginMm = margins === 'wide' ? 20 : 12
  return pageWidthMm - 2 * horizontalMarginMm
}
