import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * §262. Тексты ответа и разбора задач каталога — только с сервера. Подменён
 * только транспорт supabase (rpc / from); разбор ответа, пачки, запасной путь
 * без миграции и подстановка в задачу — настоящие.
 */
const net = vi.hoisted(() => ({
  calls: [] as Array<[string, Record<string, unknown> | undefined]>,
  selects: [] as Array<{ table: string; cols: string; ids: string[] }>,
  missing: false,
  textsError: null as string | null,
  rows: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      net.calls.push([fn, args])
      if ((fn === 'catalog_task_texts' || fn === 'catalog_reveal_answers') && net.missing) {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}(p_task_ids) in the schema cache` } })
      }
      if (fn === 'catalog_task_texts') {
        if (net.textsError) return Promise.resolve({ data: null, error: { message: net.textsError } })
        return Promise.resolve({ data: (args!.p_task_ids as string[]).map(id => net.rows[id] ?? {
          task_id: id, allowed: false, reason: null, answer_html: null, solution_html: null,
          solution_plan_html: null, grade_criteria_html: null, has_plan: id.endsWith('p'), has_criteria: false,
        }), error: null })
      }
      if (fn === 'catalog_reveal_answers') {
        return Promise.resolve({ data: (args!.p_task_ids as string[]).map(id => ({
          task_id: id, allowed: true, reason: 'revealed', answer_html: `<p>ответ ${id}</p>`, solution_html: `<p>решение ${id}</p>`,
          solution_plan_html: null, grade_criteria_html: null, has_plan: false, has_criteria: false,
        })), error: null })
      }
      if (fn === 'catalog_reveal_answer') return Promise.resolve({ data: { answer_html: '<p>старый путь</p>' }, error: null })
      return Promise.resolve({ data: null, error: { message: 'нет функции' } })
    },
    from: (table: string) => ({
      select: (cols: string) => ({
        in: (_col: string, ids: string[]) => {
          net.selects.push({ table, cols, ids })
          return Promise.resolve({ data: ids.map(id => ({ id, answer_html: `<p>прямо ${id}</p>`, solution_html: null, solution_plan_html: '<p>план</p>', grade_criteria_html: null })), error: null })
        },
      }),
    }),
  },
}))

import { applyTaskTexts, fetchCatalogTaskTexts, isMissingFunctionError, revealCatalogTaskTexts, withTaskTexts } from '@/lib/catalogTaskTexts'

beforeEach(() => {
  net.calls = []
  net.selects = []
  net.missing = false
  net.textsError = null
  net.rows = {}
})

describe('catalogTaskTexts (§262)', () => {
  it('тексты — одной функцией сервера, пачками по 300 без повторов; напрямую catalog_tasks не читается', async () => {
    const ids = Array.from({ length: 301 }, (_, i) => `t${i}`)
    const map = await fetchCatalogTaskTexts([...ids, 't0', ''])
    const rpcs = net.calls.filter(([f]) => f === 'catalog_task_texts')
    expect(rpcs.map(([, a]) => (a!.p_task_ids as string[]).length)).toEqual([300, 1])
    expect(map.size).toBe(301)
    expect(net.selects).toEqual([])
  })

  it('пустой список — без запросов', async () => {
    expect((await fetchCatalogTaskTexts([])).size).toBe(0)
    expect(net.calls).toEqual([])
  })

  it('закрытая задача: поля пустые, answers_locked; флаг плана сохраняется для кнопки', async () => {
    net.rows.open = { task_id: 'open', allowed: true, reason: 'solved', answer_html: '<p>7</p>', solution_html: '<p>x = 7</p>', solution_plan_html: null, grade_criteria_html: '<p>1 балл</p>', has_plan: false, has_criteria: true }
    const tasks = await withTaskTexts([
      { id: 'open', answer_html: 'устаревшее' },
      { id: 'lockp', answer_html: 'утечка из кэша', solution_html: 'утечка' },
    ])
    expect(tasks[0]).toMatchObject({ answer_html: '<p>7</p>', solution_html: '<p>x = 7</p>', grade_criteria_html: '<p>1 балл</p>', answers_locked: false, has_criteria: true })
    expect(tasks[1]).toMatchObject({ answer_html: null, solution_html: null, solution_plan_html: null, answers_locked: true, has_plan: true })
  })

  it('задачи нет в ответе базы (не видна) — закрыта, текстов нет', () => {
    expect(applyTaskTexts({ id: 'x', answer_html: '<p>1</p>' }, undefined)).toMatchObject({ answer_html: null, answers_locked: true })
  })

  it('ошибка базы — бросается, а не «молча пусто»', async () => {
    net.textsError = 'permission denied'
    await expect(fetchCatalogTaskTexts(['a'])).rejects.toThrow('permission denied')
  })

  it('раскрытие — catalog_reveal_answers пачкой, тексты по правилу (revealed)', async () => {
    const map = await revealCatalogTaskTexts(['a', 'b'])
    expect(net.calls).toEqual([['catalog_reveal_answers', { p_task_ids: ['a', 'b'] }]])
    expect(map.get('b')).toMatchObject({ allowed: true, reason: 'revealed', answer_html: '<p>ответ b</p>', solution_html: '<p>решение b</p>' })
  })

  it('схема без 262a: прежнее прямое чтение колонок и прежнее раскрытие по одной', async () => {
    net.missing = true
    const map = await fetchCatalogTaskTexts(['a'])
    expect(net.selects).toEqual([{ table: 'catalog_tasks', cols: 'id, answer_html, solution_html, solution_plan_html, grade_criteria_html', ids: ['a'] }])
    expect(map.get('a')).toMatchObject({ allowed: true, reason: 'legacy', answer_html: '<p>прямо a</p>', has_plan: true })

    net.calls = []
    await revealCatalogTaskTexts(['a', 'b'])
    expect(net.calls.map(([f, a]) => [f, a])).toEqual([
      ['catalog_reveal_answers', { p_task_ids: ['a', 'b'] }],
      ['catalog_reveal_answer', { p_task_id: 'a' }],
      ['catalog_reveal_answer', { p_task_id: 'b' }],
    ])
  })

  it('«функции нет» узнаётся по коду PostgREST и по тексту Postgres', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingFunctionError({ message: 'function public.catalog_task_texts(uuid[]) does not exist' })).toBe(true)
    expect(isMissingFunctionError({ message: 'permission denied for table catalog_tasks' })).toBe(false)
    expect(isMissingFunctionError(null)).toBe(false)
  })
})
