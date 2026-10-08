import { describe, expect, it } from 'vitest'
import sample from './fixtures/physics-catalog-v2-sample.json'
import {
  ARCHIVE_OFFSET, MD_MARKER, answerDisplay, buildContent, changedFields, figureLine, figureStoragePath,
  formatSummary, insertAfterFirstParagraph, kimOfFolder, normalizeAnswer, planImport, rowPayload, specVerdict,
  summarizePlan, textKey, validateTask,
// @ts-expect-error — скрипт на .mjs без типов, тестируем его чистые функции
} from '../../../scripts/physics-catalog-v2-plan.mjs'

/**
 * §269. Загрузчик переписанного каталога физики ЕГЭ: разбор задачи.json (8 настоящих задач из
 * D:\Задачник\Каталог физика ЕГЭ — fixtures/physics-catalog-v2-sample.json), строки базы и план
 * «на месте / новой строкой / без изменений».
 */

type Task = (typeof sample)[number]
type Spec = { type: string; value?: string; tol?: number; text?: string; any_order?: boolean }

const FIG_PATHS: Record<string, string> = {}
for (const t of sample as Task[]) {
  for (const f of [t.figure, t.solution_figure]) if (f) FIG_PATHS[f] = `fizika-ege/${f.replace(/\W/g, '')}.svg`
}
const contentOf = (t: Task) => buildContent(t, FIG_PATHS)

describe('kimOfFolder', () => {
  it('КИМ01..КИМ26 → номер, остальное — null', () => {
    expect(kimOfFolder('КИМ01')).toBe(1)
    expect(kimOfFolder('КИМ26')).toBe(26)
    expect(kimOfFolder('КИМ27')).toBeNull()
    expect(kimOfFolder('КИМ1')).toBeNull()
    expect(kimOfFolder('fig')).toBeNull()
  })
})

describe('normalizeAnswer / answerDisplay', () => {
  it('число: запятая → точка в базе, в показе — запятая и настоящий минус', () => {
    const { spec } = normalizeAnswer({ type: 'number', value: '-0,6', tol: 0.1 })
    expect(spec).toEqual({ type: 'number', value: '-0.6', tol: 0.1 })
    expect(answerDisplay(spec)).toBe('−0,6')
    expect(normalizeAnswer({ type: 'number', value: '−8' }).spec).toEqual({ type: 'number', value: '-8', tol: 0 })
  })
  it('цифры, «значение+погрешность» (КИМ 19) и слова', () => {
    expect(normalizeAnswer({ type: 'digits', text: '145', any_order: true }).spec).toEqual({ type: 'digits', text: '145', any_order: true })
    expect(normalizeAnswer({ type: 'digits', text: '4,40,2', any_order: false }).spec).toEqual({ type: 'digits', text: '4,40,2', any_order: false })
    expect(answerDisplay({ type: 'text', text: 'к <b>наблюдателю</b>' })).toBe('к &lt;b&gt;наблюдателю&lt;/b&gt;')
  })
  it('битые ответы — текст ошибки', () => {
    expect(normalizeAnswer({ type: 'number', value: '1,5 м' }).error).toMatch(/не разобрать/)
    expect(normalizeAnswer({ type: 'number', value: '2', tol: -1 }).error).toMatch(/допуск/)
    expect(normalizeAnswer({ type: 'digits', text: '1a' }).error).toMatch(/не разобрать/)
    expect(normalizeAnswer({ type: 'digits', text: '4,40,2', any_order: true }).error).toMatch(/погрешностью/)
    expect(normalizeAnswer({ type: 'text', text: '  ' }).error).toMatch(/пустой/)
    expect(normalizeAnswer({ type: 'formula' }).error).toMatch(/неизвестный/)
    expect(normalizeAnswer(null).error).toBeTruthy()
  })
})

describe('specVerdict — повтор правила базы (catalog_answer_spec_verdict)', () => {
  const num = (value: string, tol = 0): Spec => ({ type: 'number', value, tol })
  it.each([
    [num('-8'), '-8', true], [num('-8'), '−8', true], [num('-8'), '–8', true], [num('-8'), ' -8,0 ', true],
    [num('-8'), '8', false], [num('-8'), '-7,99', false], [num('-8'), '-8 м/с', false],
    [num('2.5', 0.1), '2,45', true], [num('2.5', 0.1), '2.6', true], [num('2.5', 0.1), '2,4', true],
    [num('2.5', 0.1), '2,61', false], [num('0.06'), ',06', true],
    [{ type: 'digits', text: '145', any_order: true }, '541', true],
    [{ type: 'digits', text: '145', any_order: true }, '1 4 5', true],
    [{ type: 'digits', text: '145', any_order: true }, '14', false],
    [{ type: 'digits', text: '235', any_order: false }, '253', false],
    [{ type: 'digits', text: '4,40,2', any_order: false }, '4,40,2', true],
    [{ type: 'digits', text: '4,40,2', any_order: false }, '4,4 0,2', true],
    [{ type: 'digits', text: '4,40,2', any_order: false }, '4.4;0.2', true],
    [{ type: 'digits', text: '4,40,2', any_order: false }, '4,4', false],
    [{ type: 'text', text: 'к наблюдателю' }, 'Кнаблюдателю', true],
    [{ type: 'text', text: 'к наблюдателю' }, 'К НАБЛЮДАТЕЛЮ.', true],
    [{ type: 'text', text: 'к наблюдателю' }, 'от наблюдателя', false],
    [{ type: 'text', text: 'отражённый' }, 'Отраженный', true],
    [{ type: 'text', text: 'к наблюдателю' }, '!!!', false],
  ])('%j ← «%s» → %s', (spec, raw, want) => {
    expect(specVerdict(spec, raw)).toBe(want)
  })
  it('textKey: регистр, ё, пробелы и знаки не важны', () => {
    expect(textKey('К  наблюдателю!')).toBe('кнаблюдателю')
    expect(textKey('ЁЖ')).toBe('еж')
  })
})

describe('рисунки', () => {
  it('путь по содержимому: тот же файл — тот же путь, другой — другой', () => {
    const a = figureStoragePath('fig/1.svg', Buffer.from('<svg>1</svg>'))
    expect(a).toMatch(/^fizika-ege\/[0-9a-f]{32}\.svg$/)
    expect(figureStoragePath('fig/other-name.svg', Buffer.from('<svg>1</svg>'))).toBe(a)
    expect(figureStoragePath('fig/1.svg', Buffer.from('<svg>2</svg>'))).not.toBe(a)
  })
  it('рисунок условия — после первого абзаца', () => {
    expect(insertAfterFirstParagraph('Абзац 1.\n\nВопрос?', figureLine('p.svg'))).toBe('Абзац 1.\n\n![Рисунок](fig:p.svg)\n\nВопрос?')
    expect(insertAfterFirstParagraph('Один абзац.', figureLine('p.svg'))).toBe('Один абзац.\n\n![Рисунок](fig:p.svg)')
  })
})

describe('buildContent — строка catalog_tasks из настоящих задач', () => {
  it('96090: Markdown с меткой, ответ «−8», answer_spec, план решения убирается', () => {
    const c = contentOf((sample as Task[]).find(t => t.external_id === '96090')!)
    expect(c.content_format).toBe('md')
    expect(c.statement_html.startsWith(`${MD_MARKER}\n`)).toBe(true)
    expect(c.statement_html).toContain('$x = 6 - 2t - 4t^2$')
    expect(c.solution_html.startsWith(MD_MARKER)).toBe(true)
    expect(c.answer_html).toBe('−8')
    expect(c.answer_spec).toEqual({ type: 'number', value: '-8', tol: 0 })
    expect(c).toMatchObject({ has_answer: true, has_solution: true, solution_plan_html: null })
  })
  it('16639: рисунок условия после первого абзаца, рисунок решения — в начале решения', () => {
    const c = contentOf((sample as Task[]).find(t => t.external_id === '16639')!)
    const paras = c.statement_html.replace(`${MD_MARKER}\n`, '').split('\n\n')
    expect(paras[1]).toBe(`![Рисунок](fig:${FIG_PATHS['fig/16639.svg']})`)
    expect(c.solution_html.split('\n')[1]).toBe(`![Рисунок к решению](fig:${FIG_PATHS['fig/16639_r.svg']})`)
  })
  it('эталон каждой задачи засчитывается самой проверкой', () => {
    for (const t of sample as Task[]) {
      const c = contentOf(t)
      const shown = c.answer_html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      expect(specVerdict(c.answer_spec, shown), t.external_id).toBe(true)
    }
  })
  it('нет пути рисунка — ошибка', () => {
    expect(() => buildContent((sample as Task[]).find(t => t.figure)!, {})).toThrow(/нет пути/)
  })
})

describe('validateTask', () => {
  const t = (sample as Task[])[1]
  it('годная задача без замечаний; нет файла рисунка, чужой КИМ, плохой путь — замечания', () => {
    expect(validateTask(t, 1, () => true)).toEqual([])
    expect(validateTask(t, 1, () => false).join()).toMatch(/нет файла fig\/16639\.svg/)
    expect(validateTask(t, 2, () => true).join()).toMatch(/папка КИМ02/)
    expect(validateTask({ ...t, figure: '../x.svg' }, 1, () => true).join()).toMatch(/не fig\//)
  })
})

describe('planImport', () => {
  const tasks = (sample as Task[]).map(t => ({ ...t, external_id: String(t.external_id) }))
  const contents = new Map(tasks.map(t => [t.external_id, contentOf(t)]))
  // Строки базы до загрузки (номера и разделы — как на проде 08.10; id выдуманы).
  const legacy = (ext: string, kim: number, extra: Record<string, unknown> = {}) => ({
    id: `id-${ext}`, external_id: Number(ext), kim, exam_part: 1, partial_type: null, is_published: true,
    content_format: 'html', statement_html: '<p>старое</p>', solution_html: '<p>старое</p>', answer_html: '1',
    answer_spec: null, has_answer: true, has_solution: true, solution_plan_html: null, replaced_by_task_id: null, ...extra,
  })
  const dbRows = [
    legacy('96090', 1), legacy('16639', 1), legacy('178838', 2), legacy('178857', 19),
    legacy('138762', 12, { exam_part: 2 }), legacy('177155', 5, { partial_type: 'multi_choice' }),
    legacy('34584', 6, { partial_type: 'matching' }),
    // 16640 уже заменялась раньше: скрытая старая строка (номер со сдвигом) и новая с тем же текстом
    legacy(String(16640 + ARCHIVE_OFFSET), 1, { id: 'id-16640-old', replaced_by_task_id: 'id-16640' }),
    { ...legacy('16640', 1), ...rowPayload(contents.get('16640')) },
    legacy('900000001', 1),
  ]
  const used = new Set(['id-96090', 'id-178857', 'id-138762'])

  it('в вариантах — новой строкой, остальное — на месте, совпавшее — без изменений', () => {
    const plan = planImport({ tasks, contents, dbRows, usedInVariants: used })
    const byExt = Object.fromEntries(plan.items.map((i: { external_id: string; action: string }) => [i.external_id, i.action]))
    expect(byExt).toEqual({
      96090: 'fork', 16639: 'update', 178838: 'update', 178857: 'fork', 138762: 'fork',
      177155: 'update', 34584: 'update', 16640: 'unchanged',
    })
    expect(plan.notInData.map((r: { external_id: number }) => r.external_id)).toEqual([900000001])
    expect(plan.anomalies).toEqual([])
    const s = summarizePlan(plan.items)
    expect(s.total).toEqual({ total: 8, update: 4, fork: 3, unchanged: 1, missing: 0 })
    expect(s.per[1]).toEqual({ total: 3, update: 1, fork: 1, unchanged: 1, missing: 0 })
    expect(formatSummary(s).at(-1)).toMatch(/итог\s+8\s+4\s+3\s+1\s+0/)
  })

  it('повторный прогон после загрузки: всё «без изменений»', () => {
    const after = dbRows.map(r => {
      const c = contents.get(String(r.external_id))
      return c && !r.replaced_by_task_id ? { ...r, ...rowPayload(c) } : r
    })
    const plan = planImport({ tasks, contents, dbRows: after, usedInVariants: used })
    expect(plan.items.every((i: { action: string }) => i.action === 'unchanged')).toBe(true)
  })

  it('странности: нет в базе, КИМ не совпал, текст в части 1, число при partial_type, скрытая задача', () => {
    const rows = dbRows
      .filter(r => r.external_id !== 16639)
      .map(r => r.external_id === 178838 ? { ...r, kim: 25 } : r)
      .map(r => r.external_id === 138762 ? { ...r, exam_part: 1 } : r)
      .map(r => r.external_id === 34584 ? { ...r, is_published: false } : r)
      .map(r => r.external_id === 96090 ? { ...r, partial_type: 'matching' } : r)
    const plan = planImport({ tasks, contents, dbRows: rows, usedInVariants: used })
    const text = plan.anomalies.join('\n')
    expect(plan.items.find((i: { external_id: string }) => i.external_id === '16639').action).toBe('missing')
    expect(text).toMatch(/16639 \(КИМ 1\): нет в базе/)
    expect(text).toMatch(/178838: в данных КИМ 2, в базе раздел №25/)
    expect(text).toMatch(/138762 \(КИМ 12\): текстовый ответ в части 1/)
    expect(text).toMatch(/34584: задача в базе скрыта/)
    expect(text).toMatch(/96090 \(КИМ 1\): числовой ответ, а в базе partial_type=matching/)
  })

  it('changedFields: answer_spec сравнивается без учёта порядка ключей', () => {
    const c = contents.get('96090')
    const row = { ...rowPayload(c), answer_spec: { value: '-8', tol: 0, type: 'number' } }
    expect(changedFields(row, c)).toEqual([])
    expect(changedFields({ ...row, answer_html: '-8' }, c)).toEqual(['answer_html'])
  })
})
