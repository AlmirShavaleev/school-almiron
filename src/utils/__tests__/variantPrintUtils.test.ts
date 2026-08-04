import { describe, it, expect } from 'vitest'
import {
  buildVariantFileName,
  buildHumanPdfFileName,
  resolveSourceLabel,
  resolveSectionLabel,
  buildAnswersList,
  buildKeyTable,
  htmlToPlainText,
  marginsToCss,
  fontSizeToCss,
  type PrintableItem,
} from '../variantPrintUtils'
import {
  normalizeVariantPrintSettings,
  DEFAULT_VARIANT_PRINT_SETTINGS,
  loadVariantPrintSettings,
  saveVariantPrintSettings,
} from '@/types/variantPrint'

// ══════════════════════════════════════════════════════════════════════════════
// buildVariantFileName
// ══════════════════════════════════════════════════════════════════════════════

describe('buildVariantFileName', () => {
  it('builds a variant-numbered file name for physics/EGE', () => {
    expect(buildVariantFileName('Физика', 'ЕГЭ', '57189903'))
      .toBe('school-almiron-physics-ege-variant-57189903.pdf')
  })

  it('builds a date-based file name when no variant number is given', () => {
    const name = buildVariantFileName('Математика', 'ЕГЭ', undefined, new Date(2026, 5, 30))
    expect(name).toBe('school-almiron-math-ege-2026-06-30.pdf')
  })

  it('falls back to date for empty/whitespace variant number', () => {
    const name = buildVariantFileName('Математика', 'ОГЭ', '   ', new Date(2026, 0, 1))
    expect(name).toBe('school-almiron-math-oge-2026-01-01.pdf')
  })

  it('slugifies unusual variant numbers', () => {
    expect(buildVariantFileName('Физика', 'ЕГЭ', 'Вариант #5!'))
      .toBe('school-almiron-physics-ege-variant-вариант-5.pdf')
  })

  it('handles slug subjects directly (math/physics)', () => {
    expect(buildVariantFileName('physics', 'ege', '1'))
      .toBe('school-almiron-physics-ege-variant-1.pdf')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// buildHumanPdfFileName
// ══════════════════════════════════════════════════════════════════════════════

describe('buildHumanPdfFileName', () => {
  it('склеивает префикс и заголовок', () => {
    expect(buildHumanPdfFileName('№1 Кинематика', { prefix: 'Подборка' }))
      .toBe('Подборка — №1 Кинематика.pdf')
  })

  it('не повторяет префикс, если заголовок уже с него начинается', () => {
    expect(buildHumanPdfFileName('Подборка из каталога', { prefix: 'Подборка' }))
      .toBe('Подборка из каталога.pdf')
  })

  it('добавляет номер варианта, когда он задан', () => {
    expect(buildHumanPdfFileName('Пробник', { prefix: 'Вариант', variantNumber: '57189903' }))
      .toBe('Вариант — Пробник №57189903.pdf')
  })

  it('вычищает символы, запрещённые в именах файлов', () => {
    expect(buildHumanPdfFileName('Оптика: линзы / зеркала?', { prefix: 'Подборка' }))
      .toBe('Подборка — Оптика линзы зеркала.pdf')
  })

  it('сохраняет дефисы внутри названия', () => {
    expect(buildHumanPdfFileName('RC-цепи', { prefix: 'Подборка' }))
      .toBe('Подборка — RC-цепи.pdf')
  })

  it('возвращает null на пустом заголовке — вызывающий берёт слаг', () => {
    expect(buildHumanPdfFileName('   ')).toBeNull()
    expect(buildHumanPdfFileName(null)).toBeNull()
    expect(buildHumanPdfFileName(undefined)).toBeNull()
  })

  it('обрезает слишком длинный заголовок', () => {
    const name = buildHumanPdfFileName('А'.repeat(300), { prefix: 'Подборка' })!
    expect(name.endsWith('.pdf')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(124)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Metadata filtering — source / section
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveSourceLabel', () => {
  it('returns the trimmed source url when present', () => {
    expect(resolveSourceLabel({ source_url: '  https://fipi.ru/x  ' })).toBe('https://fipi.ru/x')
  })
  it('returns null when source_url is empty/whitespace/null/undefined', () => {
    expect(resolveSourceLabel({ source_url: '' })).toBeNull()
    expect(resolveSourceLabel({ source_url: '   ' })).toBeNull()
    expect(resolveSourceLabel({ source_url: null })).toBeNull()
    expect(resolveSourceLabel({})).toBeNull()
  })
})

describe('resolveSectionLabel', () => {
  it('returns the trimmed section title when present', () => {
    expect(resolveSectionLabel({ sectionTitle: '  Механика  ' })).toBe('Механика')
  })
  it('returns null when sectionTitle is empty/null/undefined', () => {
    expect(resolveSectionLabel({ sectionTitle: '' })).toBeNull()
    expect(resolveSectionLabel({ sectionTitle: null })).toBeNull()
    expect(resolveSectionLabel({})).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Answers list
// ══════════════════════════════════════════════════════════════════════════════

function makeItem(overrides: Partial<PrintableItem> = {}): PrintableItem {
  return {
    id: 'item-1',
    customNumber: null,
    task: {
      id: 'task-1',
      external_id: 1,
      section_id: 'sec-1',
      subject: 'Физика',
      exam_type: 'ЕГЭ',
      statement_html: '<p>Условие</p>',
      answer_html: '<p>42</p>',
      solution_html: null,
      solution_plan_html: null,
      grade_criteria_html: null,
      source_url: null,
      has_answer: true,
      has_solution: false,
      position: 1,
      assets: [],
    },
    ...overrides,
  }
}

const identityResolve = (html: string | null | undefined) => html ?? ''

describe('buildAnswersList', () => {
  it('includes items with has_answer and non-empty answer_html', () => {
    const list = buildAnswersList([makeItem()], identityResolve)
    expect(list).toHaveLength(1)
    expect(list[0].answerHtml).toBe('<p>42</p>')
    expect(list[0].number).toBe('1')
  })

  it('skips items with has_answer=false', () => {
    const item = makeItem({ task: { ...makeItem().task!, has_answer: false } })
    expect(buildAnswersList([item], identityResolve)).toHaveLength(0)
  })

  it('skips items with no task (unavailable)', () => {
    const item = makeItem({ task: undefined })
    expect(buildAnswersList([item], identityResolve)).toHaveLength(0)
  })

  it('skips items whose resolved answer html is empty', () => {
    const list = buildAnswersList([makeItem()], () => '')
    expect(list).toHaveLength(0)
  })

  it('uses custom_number when set, falls back to position otherwise', () => {
    const list = buildAnswersList(
      [makeItem({ customNumber: '7а' }), makeItem({ id: 'item-2' })],
      identityResolve,
    )
    expect(list[0].number).toBe('7а')
    expect(list[1].number).toBe('2')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Key table
// ══════════════════════════════════════════════════════════════════════════════

describe('htmlToPlainText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToPlainText('<p>  42  </p>\n<span>м/с</span>')).toBe('42 м/с')
  })
  it('handles &nbsp;', () => {
    expect(htmlToPlainText('42&nbsp;м/с')).toBe('42 м/с')
  })
})

describe('buildKeyTable', () => {
  it('only includes tasks with has_answer=true', () => {
    const withAnswer = makeItem()
    const withoutAnswer = makeItem({ id: 'item-2', task: { ...makeItem().task!, has_answer: false } })
    const rows = buildKeyTable([withAnswer, withoutAnswer])
    expect(rows).toHaveLength(1)
    expect(rows[0].itemId).toBe('item-1')
  })

  it('produces plain-text short answers', () => {
    const item = makeItem({ task: { ...makeItem().task!, answer_html: '<p><b>42</b> м/с</p>' } })
    const rows = buildKeyTable([item])
    expect(rows[0].shortAnswer).toBe('42 м/с')
  })

  it('skips tasks with empty answer_html', () => {
    const item = makeItem({ task: { ...makeItem().task!, answer_html: '' } })
    expect(buildKeyTable([item])).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Print page CSS helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('marginsToCss / fontSizeToCss', () => {
  it('maps normal/wide margins', () => {
    expect(marginsToCss('normal')).toBe('15mm 12mm')
    expect(marginsToCss('wide')).toBe('25mm 20mm')
  })
  it('maps normal/large font sizes', () => {
    expect(fontSizeToCss('normal')).toBe('8pt')
    expect(fontSizeToCss('large')).toBe('9pt')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Settings normalization + localStorage merge
// ══════════════════════════════════════════════════════════════════════════════

describe('normalizeVariantPrintSettings', () => {
  it('returns defaults for null/undefined/non-object input', () => {
    expect(normalizeVariantPrintSettings(null)).toEqual(DEFAULT_VARIANT_PRINT_SETTINGS)
    expect(normalizeVariantPrintSettings(undefined)).toEqual(DEFAULT_VARIANT_PRINT_SETTINGS)
    expect(normalizeVariantPrintSettings('nonsense')).toEqual(DEFAULT_VARIANT_PRINT_SETTINGS)
  })

  it('merges valid partial input on top of defaults', () => {
    const merged = normalizeVariantPrintSettings({ showAnswers: true, title: 'Вариант 1' })
    expect(merged.showAnswers).toBe(true)
    expect(merged.title).toBe('Вариант 1')
    expect(merged.showKey).toBe(DEFAULT_VARIANT_PRINT_SETTINGS.showKey)
  })

  it('falls back to defaults for invalid enum values', () => {
    const merged = normalizeVariantPrintSettings({ orientation: 'sideways', fontSize: 'huge', margins: 'zero' })
    expect(merged.orientation).toBe('portrait')
    expect(merged.fontSize).toBe('normal')
    expect(merged.margins).toBe('normal')
  })

  it('coerces wrong-typed boolean/string fields back to defaults', () => {
    const merged = normalizeVariantPrintSettings({ showAnswers: 'yes', title: 123 })
    expect(merged.showAnswers).toBe(DEFAULT_VARIANT_PRINT_SETTINGS.showAnswers)
    expect(merged.title).toBe(DEFAULT_VARIANT_PRINT_SETTINGS.title)
  })

  it('does not include difficulty/fipi/rule fields', () => {
    const merged = normalizeVariantPrintSettings({})
    expect(merged).not.toHaveProperty('difficulty')
    expect(merged).not.toHaveProperty('fipi')
    expect(merged).not.toHaveProperty('rule')
  })
})

describe('loadVariantPrintSettings / saveVariantPrintSettings', () => {
  it('round-trips through a storage-like object', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
    saveVariantPrintSettings({ ...DEFAULT_VARIANT_PRINT_SETTINGS, showKey: true }, storage)
    const loaded = loadVariantPrintSettings(storage)
    expect(loaded.showKey).toBe(true)
  })

  it('returns defaults when storage is empty', () => {
    const storage = { getItem: () => null }
    expect(loadVariantPrintSettings(storage)).toEqual(DEFAULT_VARIANT_PRINT_SETTINGS)
  })

  it('returns defaults when stored JSON is corrupt', () => {
    const storage = { getItem: () => '{not json' }
    expect(loadVariantPrintSettings(storage)).toEqual(DEFAULT_VARIANT_PRINT_SETTINGS)
  })
})
