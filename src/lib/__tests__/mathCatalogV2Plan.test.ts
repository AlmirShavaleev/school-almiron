import { describe, expect, it } from 'vitest'
import sample from './fixtures/math-catalog-v2-sample.json'
import {
  FIGURES_PREFIX, SUBJECT, buildContent, checkModeOf, figureStoragePath, formatCheckModes, isProofTask,
  kimOfFolder, planMathImport, validateTask,
// @ts-expect-error — скрипт на .mjs без типов, тестируем его чистые функции
} from '../../../scripts/math-catalog-v2-plan.mjs'

/**
 * Загрузчик переписанного каталога «Математика ЕГЭ» (письмо 14.10): 6 настоящих
 * задач из D:\Задачник\Каталог математика ЕГЭ — число с рисунком, доказательство
 * без ответа, текстовые ответы в части 1 и 2, таблица в решении №16.
 */
type Task = (typeof sample)[number] & { kim: number }
const tasks = sample as Task[]
const byId = (id: number) => tasks.find(t => Number(t.external_id) === id)!

const FIG: Record<string, string> = {}
for (const t of tasks) for (const f of [t.figure, t.solution_figure]) if (f) FIG[f] = `${FIGURES_PREFIX}/${f.replace(/\W/g, '')}.svg`
const contents = new Map(tasks.map(t => [String(t.external_id), buildContent(t, FIG)]))

describe('папки и рисунки', () => {
  it('КИМ01..КИМ19, чужие папки и КИМ20+ — нет', () => {
    expect(kimOfFolder('КИМ01')).toBe(1)
    expect(kimOfFolder('КИМ19')).toBe(19)
    expect(kimOfFolder('КИМ20')).toBeNull()
    expect(kimOfFolder('проверка')).toBeNull()
  })
  it('рисунок — в папке математики бакета, путь по содержимому', () => {
    const p = figureStoragePath('fig/a.svg', Buffer.from('<svg/>'))
    expect(p).toMatch(/^matematika-ege\/[0-9a-f]{32}\.svg$/)
    expect(figureStoragePath('fig/b.svg', Buffer.from('<svg/>'))).toBe(p)
  })
})

describe('строка базы', () => {
  it('число: Markdown, ответ для показа и проверки', () => {
    const c = contents.get('43')
    expect(SUBJECT).toBe('Математика')
    expect(c.content_format).toBe('md')
    expect(c.statement_html.startsWith('<!--md-->\n')).toBe(true)
    expect(c.statement_html).toContain('](fig:matematika-ege/')
    expect(c.answer_spec).toEqual({ type: 'number', value: '112', tol: 0 })
    expect(c.answer_html).toBe('112')
  })
  it('доказательство (пустой ответ): без ответа, не ошибка файла', () => {
    const t = byId(141177)
    expect(isProofTask(t)).toBe(true)
    expect(validateTask(t, 1, () => true)).toEqual([])
    const c = contents.get('141177')
    expect(c).toMatchObject({ answer_spec: null, answer_html: null, has_answer: false, has_solution: true })
  })
  it('таблица в решении №16 переходит как есть (рисует фронт)', () => {
    expect(contents.get('377').solution_html).toMatch(/\|:-:\|/)
  })
})

describe('режим проверки', () => {
  it('часть 2 и доказательство — самопроверка, число в части 1 — автопроверка, текст в части 1 — решит база', () => {
    expect(checkModeOf(2, { type: 'number' })).toBe('self')
    expect(checkModeOf(1, null)).toBe('self')
    expect(checkModeOf(1, { type: 'number' })).toBe('auto')
    expect(checkModeOf(null, { type: 'text', text: '2/7' })).toBe('db')
  })
})

describe('план', () => {
  // База: всё, кроме №385; 43 стоит в варианте; 2410 (№13) — часть 1 в базе.
  const rows = tasks.filter(t => Number(t.external_id) !== 385).map(t => ({
    id: `db-${t.external_id}`, external_id: Number(t.external_id), kim: t.kim,
    exam_part: Number(t.external_id) === 2410 ? 1 : t.kim >= 13 || Number(t.external_id) === 141177 ? 2 : 1,
    partial_type: null, is_published: true, replaced_by_task_id: null, content_format: 'html',
    statement_html: null, solution_html: null, answer_html: null, answer_spec: null, has_answer: true, has_solution: true, solution_plan_html: null,
  }))
  const plan = planMathImport({ tasks, contents, dbRows: rows, usedInVariants: new Set(['db-43']) })
  const action = (id: number) => plan.items.find((i: { external_id: string }) => i.external_id === String(id))?.action

  it('на месте / новой строкой / нет в базе', () => {
    expect(action(43)).toBe('fork')
    expect(action(141177)).toBe('update')
    expect(action(385)).toBe('missing')
    expect(plan.notInData).toEqual([])
  })
  it('режимы проверки по КИМ и задачи, которые решит база', () => {
    expect(plan.checkModes.total).toEqual({ auto: 1, self: 2, db: 2 })
    expect(plan.checkModes.decidedByDb.map((d: { external_id: string }) => d.external_id).sort()).toEqual(['2410', '35780'])
    expect(plan.checkModes.numberInPart2.map((d: { external_id: string }) => d.external_id)).toEqual(['377'])
    expect(formatCheckModes(plan.checkModes).at(-1)).toMatch(/итог\s+1\s+2\s+2/)
  })
  it('строка физики «поля проверки не будет» заменена, у доказательства — отдельная строка', () => {
    expect(plan.anomalies.some((a: string) => a.includes('поля проверки у ученика не будет'))).toBe(false)
    expect(plan.anomalies.some((a: string) => a.includes('2410 (КИМ 13): текстовый ответ'))).toBe(true)
    expect(plan.anomalies).toContain('1 задач на доказательство — без ответа, самопроверка по решению')
    expect(plan.proofProblems).toEqual([])
  })
  it('доказательство в варианте — проблема плана (новой строкой без ответа не завести)', () => {
    const p = planMathImport({ tasks, contents, dbRows: rows, usedInVariants: new Set(['db-141177']) })
    expect(p.proofProblems).toHaveLength(1)
    expect(p.proofProblems[0]).toContain('141177')
  })
})
