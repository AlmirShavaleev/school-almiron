import { supabase } from '@/lib/supabase'

/**
 * §262. Ответ, решение, план и критерии задач каталога — только с сервера.
 *
 * Строки `catalog_tasks` клиент читает БЕЗ этих четырёх полей (после
 * PENDING_262b база их ученику и не отдаст: права на колонки). Тексты берутся
 * у `catalog_task_texts` — одна definer-функция для всех: персоналу платформы
 * она отдаёт всё, ученику — только когда положено по правилу
 * `catalog_answer_reasons` (открыл ответ, решил верно, задача без проверки,
 * вариант сдан, разбор задачи урока открыт, тест темы завершён). Иначе поля
 * пустые и `allowed = false` — задача «закрыта»: карточка показывает кнопку,
 * а текст приходит только после `catalog_reveal_answers` (это раскрытие:
 * дальше задача в баллы и прогноз не идёт, как `catalog_reveal_answer` §256).
 *
 * Своей копии правила на клиенте нет — только разбор ответа базы.
 *
 * Схема без 262a (функции ещё нет) — прежнее прямое чтение колонок, чтобы
 * клиент не ломался, если его выложат раньше миграции. После 262b прямое
 * чтение запрещено базой, так что запасной путь ничего не открывает.
 */
export interface CatalogTaskTexts {
  task_id: string
  allowed: boolean
  /** staff | not_checkable | solved | revealed | variant | lesson | test; null — закрыто; legacy — схема до 262a. */
  reason: string | null
  answer_html: string | null
  solution_html: string | null
  solution_plan_html: string | null
  grade_criteria_html: string | null
  has_plan: boolean
  has_criteria: boolean
}

/** Поля задачи, которые приходят только отсюда. */
export const SECRET_TASK_FIELDS = ['answer_html', 'solution_html', 'solution_plan_html', 'grade_criteria_html'] as const

export interface TaskTextFields {
  id: string
  answer_html?: string | null
  solution_html?: string | null
  solution_plan_html?: string | null
  grade_criteria_html?: string | null
  answers_locked?: boolean
  has_plan?: boolean
  has_criteria?: boolean
}

/** Столько id база принимает за раз (как catalog_practice_state). */
export const TEXTS_CHUNK = 300
const LEGACY_IN_CHUNK = 50

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null }
interface DbLike {
  rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>>
  from?: (table: string) => {
    select: (cols: string) => { in: (col: string, vals: string[]) => PromiseLike<Res<unknown[]>> }
  }
}
const db = () => supabase as unknown as DbLike

/** Функции нет в схеме (миграция 262a ещё не применена). */
export function isMissingFunctionError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '42883') return true
  const m = err.message ?? ''
  return /could not find the function|function .* does not exist/i.test(m)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function normalizeTaskTexts(raw: unknown): CatalogTaskTexts | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.task_id)
  if (!id) return null
  const answer = str(r.answer_html)
  const solution = str(r.solution_html)
  const plan = str(r.solution_plan_html)
  const criteria = str(r.grade_criteria_html)
  return {
    task_id: id,
    allowed: r.allowed === true,
    reason: str(r.reason),
    answer_html: answer,
    solution_html: solution,
    solution_plan_html: plan,
    grade_criteria_html: criteria,
    has_plan: r.has_plan === true || !!plan,
    has_criteria: r.has_criteria === true || !!criteria,
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))]
}

async function legacyTexts(ids: string[]): Promise<Map<string, CatalogTaskTexts>> {
  const out = new Map<string, CatalogTaskTexts>()
  const c = db()
  if (typeof c.from !== 'function') return out
  for (const part of chunk(ids, LEGACY_IN_CHUNK)) {
    const { data, error } = await c.from('catalog_tasks')
      .select('id, answer_html, solution_html, solution_plan_html, grade_criteria_html')
      .in('id', part)
    if (error) throw new Error(error.message ?? 'Не удалось загрузить ответы')
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const t = normalizeTaskTexts({ ...row, task_id: row.id, allowed: true, reason: 'legacy' })
      if (t) out.set(t.task_id, t)
    }
  }
  return out
}

async function callTexts(fn: 'catalog_task_texts' | 'catalog_reveal_answers', ids: string[]): Promise<Map<string, CatalogTaskTexts> | 'missing'> {
  const out = new Map<string, CatalogTaskTexts>()
  const c = db()
  if (typeof c.rpc !== 'function') throw new Error('rpc недоступен')
  for (const part of chunk(ids, TEXTS_CHUNK)) {
    const { data, error } = await c.rpc<unknown[]>(fn, { p_task_ids: part })
    if (error) {
      if (isMissingFunctionError(error)) return 'missing'
      throw new Error(error.message ?? 'Не удалось загрузить ответы')
    }
    for (const raw of data ?? []) {
      const t = normalizeTaskTexts(raw)
      if (t) out.set(t.task_id, t)
    }
  }
  return out
}

/** Тексты по списку задач (без раскрытия). Персоналу — все, ученику — по правилу. */
export async function fetchCatalogTaskTexts(ids: readonly string[]): Promise<Map<string, CatalogTaskTexts>> {
  const list = uniqueIds(ids)
  if (list.length === 0) return new Map()
  const res = await callTexts('catalog_task_texts', list)
  return res === 'missing' ? legacyTexts(list) : res
}

/**
 * Открыть ответы (раскрытие пишется в базу — дальше задачи в баллы и прогноз
 * не идут) и получить тексты. Без 262a — прежний `catalog_reveal_answer` по
 * одной задаче и прямое чтение.
 */
export async function revealCatalogTaskTexts(ids: readonly string[]): Promise<Map<string, CatalogTaskTexts>> {
  const list = uniqueIds(ids)
  if (list.length === 0) return new Map()
  const res = await callTexts('catalog_reveal_answers', list)
  if (res !== 'missing') return res
  const c = db()
  if (typeof c.rpc !== 'function') throw new Error('rpc недоступен')
  for (const id of list) {
    const { error } = await c.rpc('catalog_reveal_answer', { p_task_id: id })
    if (error && !isMissingFunctionError(error)) throw new Error(error.message ?? 'Не удалось открыть ответ')
  }
  return legacyTexts(list)
}

/**
 * Подставить тексты в задачу. Нет строки (задача не видна) или не положено —
 * поля пустые, `answers_locked = true`. Флаги плана и критериев — от базы, чтобы
 * кнопки «План решения» / «Критерии оценки» были и у закрытой задачи.
 */
export function applyTaskTexts<T extends TaskTextFields>(task: T, texts: CatalogTaskTexts | undefined): T {
  if (!texts) {
    return {
      ...task,
      answer_html: null, solution_html: null, solution_plan_html: null, grade_criteria_html: null,
      answers_locked: true, has_plan: task.has_plan ?? false, has_criteria: task.has_criteria ?? false,
    }
  }
  return {
    ...task,
    answer_html: texts.answer_html,
    solution_html: texts.solution_html,
    solution_plan_html: texts.solution_plan_html,
    grade_criteria_html: texts.grade_criteria_html,
    answers_locked: !texts.allowed,
    has_plan: texts.has_plan,
    has_criteria: texts.has_criteria,
  }
}

/** Загрузить тексты для списка задач и подставить их одним проходом. */
export async function withTaskTexts<T extends TaskTextFields>(tasks: T[]): Promise<T[]> {
  if (tasks.length === 0) return tasks
  const texts = await fetchCatalogTaskTexts(tasks.map(t => t.id))
  return tasks.map(t => applyTaskTexts(t, texts.get(t.id)))
}
