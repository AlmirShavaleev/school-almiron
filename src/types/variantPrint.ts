/**
 * Print/PDF settings for a test variant document.
 *
 * IMPORTANT: catalog_tasks has NO difficulty/сложность, ОБЗ ФИПИ номер,
 * "правило"/rule, or актуальность columns. Do NOT add settings for fields
 * that do not exist in the database — this type must only expose toggles
 * backed by real columns (see src/hooks/useCatalog.ts CatalogTask,
 * src/hooks/useVariants.ts TestVariant/TestVariantItem).
 */

export type VariantOrientation = 'portrait' | 'landscape'
export type VariantFontSize = 'normal' | 'large'
export type VariantMargins = 'normal' | 'wide'
/** Document preset: 'standard' = regular variant; 'worksheet' = conditions only,
 *  one task per page, ruled-grid field filling the rest of the page. */
export type VariantMode = 'standard' | 'worksheet'

export interface VariantPrintSettings {
  /** Document preset — see VariantMode. Worksheet mode forces
   *  showExplanations/showAnswers/showKey off and onePerPage on at render
   *  time regardless of their stored values (so switching back to 'standard'
   *  restores the user's previous toggles unchanged). */
  mode: VariantMode
  /** Whether to render the task ordinal number ("Задание N"). */
  showNumbers: boolean
  /** Document title shown in the header. */
  title: string
  /** Optional free-text comment shown under the header. */
  comment?: string
  /** Optional instruction block shown before the task list. */
  instruction?: string
  /** Left side of the running header, e.g. "School Almiron — физика". */
  headerLeft: string
  /** Optional variant number/label, e.g. "57189903". */
  variantNumber?: string
  /** Show "Пояснения" block sourced from solution_plan_html (when present). */
  showExplanations: boolean
  /** Show "Ответ" block sourced from answer_html (after each task). */
  showAnswers: boolean
  /** Show a compact "Ключ" table (task # -> short answer) for has_answer tasks. */
  showKey: boolean
  /** Show "Источник" line sourced from source_url (hidden when empty). */
  showSource: boolean
  /** Show the codifier section title (catalog_sections.title) per task. */
  showCodifierSection: boolean
  /** Force a page break before every task. */
  onePerPage: boolean
  orientation: VariantOrientation
  fontSize: VariantFontSize
  margins: VariantMargins
}

export const DEFAULT_VARIANT_PRINT_SETTINGS: VariantPrintSettings = {
  mode: 'standard',
  showNumbers: true,
  title: '',
  comment: '',
  instruction: '',
  headerLeft: '',
  variantNumber: '',
  showExplanations: false,
  showAnswers: false,
  showKey: false,
  showSource: false,
  showCodifierSection: false,
  onePerPage: false,
  orientation: 'portrait',
  fontSize: 'normal',
  margins: 'normal',
}

const VALID_ORIENTATIONS: VariantOrientation[] = ['portrait', 'landscape']
const VALID_FONT_SIZES: VariantFontSize[] = ['normal', 'large']
const VALID_MARGINS: VariantMargins[] = ['normal', 'wide']
const VALID_MODES: VariantMode[] = ['standard', 'worksheet']

/**
 * Merges partial/unknown settings (e.g. parsed from localStorage) on top of
 * the defaults, validating enum-like fields and coercing wrong-typed values
 * back to their defaults instead of trusting untyped storage content.
 */
export function normalizeVariantPrintSettings(
  input: unknown,
): VariantPrintSettings {
  const base = { ...DEFAULT_VARIANT_PRINT_SETTINGS }
  if (!input || typeof input !== 'object') return base

  const src = input as Partial<Record<keyof VariantPrintSettings, unknown>>

  const bool = (key: keyof VariantPrintSettings, fallback: boolean): boolean =>
    typeof src[key] === 'boolean' ? (src[key] as boolean) : fallback

  const str = (key: keyof VariantPrintSettings, fallback: string): string =>
    typeof src[key] === 'string' ? (src[key] as string) : fallback

  return {
    mode: VALID_MODES.includes(src.mode as VariantMode) ? (src.mode as VariantMode) : base.mode,
    showNumbers: bool('showNumbers', base.showNumbers),
    title: str('title', base.title),
    comment: str('comment', base.comment ?? ''),
    instruction: str('instruction', base.instruction ?? ''),
    headerLeft: str('headerLeft', base.headerLeft),
    variantNumber: str('variantNumber', base.variantNumber ?? ''),
    showExplanations: bool('showExplanations', base.showExplanations),
    showAnswers: bool('showAnswers', base.showAnswers),
    showKey: bool('showKey', base.showKey),
    showSource: bool('showSource', base.showSource),
    showCodifierSection: bool('showCodifierSection', base.showCodifierSection),
    onePerPage: bool('onePerPage', base.onePerPage),
    orientation: VALID_ORIENTATIONS.includes(src.orientation as VariantOrientation)
      ? (src.orientation as VariantOrientation)
      : base.orientation,
    fontSize: VALID_FONT_SIZES.includes(src.fontSize as VariantFontSize)
      ? (src.fontSize as VariantFontSize)
      : base.fontSize,
    margins: VALID_MARGINS.includes(src.margins as VariantMargins)
      ? (src.margins as VariantMargins)
      : base.margins,
  }
}

export const VARIANT_PRINT_SETTINGS_STORAGE_KEY = 'variant-print-settings'

/** Loads settings from localStorage, falling back to defaults on any failure. */
export function loadVariantPrintSettings(
  storage: Pick<Storage, 'getItem'> = typeof localStorage !== 'undefined' ? localStorage : ({ getItem: () => null }),
): VariantPrintSettings {
  try {
    const raw = storage.getItem(VARIANT_PRINT_SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_VARIANT_PRINT_SETTINGS }
    return normalizeVariantPrintSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_VARIANT_PRINT_SETTINGS }
  }
}

/** Persists settings to localStorage; silently no-ops if storage is unavailable. */
export function saveVariantPrintSettings(
  settings: VariantPrintSettings,
  storage: Pick<Storage, 'setItem'> = typeof localStorage !== 'undefined' ? localStorage : ({ setItem: () => {} }),
): void {
  try {
    storage.setItem(VARIANT_PRINT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore quota/availability errors
  }
}
