import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { usePreviewMode } from '@/store/staffModeStore'
import type { CatalogTaskAsset } from '@/hooks/useCatalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Задачи к уроку (§162).
 *
 * Тренировка, а не контрольная: вердикт приходит на каждую задачу сразу,
 * попыток сколько угодно, ничего не надо «начинать» и «завершать».
 *
 * Проверка ответа целиком на сервере — `answer_topic_task` спрашивает те же
 * `normalize_variant_answer` (§63) и `variant_answer_verdict` (§66), что и
 * весь остальной проект. Здесь её нет и быть не должно: вторая копия правила
 * уже стоила нам разбора «;» и «да/нет».
 *
 * Предпросмотр глазами ученика (§178, §179): `topic_tasks_for_student` считает
 * от выдачи ученика, у персонала её нет — вместо неё состав берётся из
 * `topic_tasks_for_staff` (она у персонала есть), картинки условий — из
 * `catalog_task_assets`, как их читает каталог. Личное состояние по задаче
 * (попытки, вердикт, разбор, «Разобрал») живёт в памяти хука и только там:
 * обновление страницы или уход с темы его стирают — так просил владелец
 * («не запоминать никак»). Вердикт считает база той же формулой, что у
 * ученика, но чистой RPC `preview_task_verdict` — ни одна RPC записи
 * (`answer_topic_task`, `reveal_topic_task_solution`, `close_topic_task_self`)
 * в предпросмотре не вызывается; разбор берётся прямо из `catalog_tasks`.
 */

export interface TopicTaskRow {
  student_assignment_id: string
  item_id: string
  item_position: number
  task_id: string
  statement_html: string
  assets: CatalogTaskAsset[]
  max_points: number | null
  /** Есть короткий ответ — значит, вердикт. Иначе задача закрывается разбором. */
  auto_checkable: boolean
  answer_raw: string | null
  is_correct: boolean | null
  attempts_count: number
  /** null — задача ещё открыта; 'auto' — решена; 'self' — разобрана. */
  closed_by: 'auto' | 'self' | null
  solution_shown_at: string | null
  /** Приходит только после явного «Посмотреть решение». */
  solution_html: string | null
  answer_html: string | null
}

export interface RevealedSolution {
  solution_html: string | null
  solution_plan_html: string | null
  answer_html: string | null
}

/** Личное состояние одной задачи в предпросмотре — то, что у ученика хранит `test_variant_answers`. */
type PreviewTaskState = Pick<TopicTaskRow,
  'answer_raw' | 'is_correct' | 'attempts_count' | 'closed_by' | 'solution_shown_at' | 'solution_html' | 'answer_html'>

/**
 * Состояние предпросмотра привязано к теме: при смене темы оно стирается в
 * `load`, а ключ по теме нужен от гонки — вердикт, пришедший уже после ухода
 * с темы, ляжет под старый ключ и в строки новой темы не попадёт.
 */
interface PreviewState {
  topicId: string
  items: Record<string, PreviewTaskState>
}

const EMPTY_PREVIEW_STATE: PreviewTaskState = {
  answer_raw: null, is_correct: null, attempts_count: 0, closed_by: null,
  solution_shown_at: null, solution_html: null, answer_html: null,
}

export function useTopicTasks(topicId: string | undefined) {
  const preview = usePreviewMode()
  const [baseRows, setBaseRows] = useState<TopicTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busyItem, setBusy]   = useState<string | null>(null)
  const [local, setLocal]     = useState<PreviewState | null>(null)

  /**
   * `silent` — перечитать строки, не показывая «Загрузка задач…». После
   * ответа/разбора/«Разобрал» экран должен остаться на месте: спиннер вместо
   * ленты размонтирует карточку, и всё её локальное состояние (введённый
   * ответ, подсветка «неверно») пропадает — ученик не видел, что ответил
   * мимо (§176). Первая загрузка и смена темы — с индикатором, как раньше.
   */
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!topicId) { setLoading(false); return }
    if (!opts.silent) {
      setLoading(true)
      // Смена темы (и любая полная перезагрузка) — память предпросмотра
      // стирается: возврат на тему начинает с чистого листа, как просил
      // владелец («не запоминать никак»).
      setLocal(null)
    }
    setError(null)
    try {
      if (preview) {
        setBaseRows(await loadPreviewRows(topicId))
      } else {
        const { data, error: err } = await db.rpc('topic_tasks_for_student', { p_topic_id: topicId })
        if (err) throw new Error(err.message)
        setBaseRows((data ?? []).map(normalizeRow))
      }
    } catch (e) {
      // Сорвавшийся запрос не должен оставлять вкладку в вечной загрузке:
      // ученик увидит ошибку и сможет обновить страницу.
      setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи')
      setBaseRows([])
    } finally {
      setLoading(false)
    }
  }, [topicId, preview])

  useEffect(() => { void load() }, [load])

  // Строки наружу: у ученика — как пришли от сервера; в предпросмотре —
  // staff-состав, поверх которого лежит память вкладки по этой теме.
  const rows = useMemo<TopicTaskRow[]>(() => {
    if (!preview || !local || local.topicId !== topicId) return baseRows
    return baseRows.map(r => local.items[r.item_id] ? { ...r, ...local.items[r.item_id] } : r)
  }, [baseRows, preview, local, topicId])

  const patchLocal = useCallback((itemId: string, patch: (prev: PreviewTaskState) => PreviewTaskState) => {
    if (!topicId) return
    setLocal(prev => {
      const items = prev && prev.topicId === topicId ? prev.items : {}
      return { topicId, items: { ...items, [itemId]: patch(items[itemId] ?? EMPTY_PREVIEW_STATE) } }
    })
  }, [topicId])

  /** Ответ с мгновенным вердиктом. Возвращает, верно ли, — для подсветки. */
  const answer = useCallback(async (itemId: string, raw: string): Promise<boolean | null> => {
    if (!topicId) return null
    setBusy(itemId)
    setError(null)
    try {
      if (preview) {
        // Те же отказы, что у `answer_topic_task` (§162/§176), — иначе владелец
        // увидел бы в предпросмотре то, чего ученику сервер не позволит.
        const row = rows.find(r => r.item_id === itemId)
        if (!row) throw new Error(humanizeTaskError('ACCESS_DENIED'))
        if (!row.auto_checkable) throw new Error(humanizeTaskError('NOT_AUTO_CHECKABLE'))
        if (row.closed_by) throw new Error(humanizeTaskError('ALREADY_SOLVED'))
        if (row.solution_shown_at) throw new Error(humanizeTaskError('SOLUTION_SHOWN'))
        const { data, error: err } = await db.rpc('preview_task_verdict', {
          p_task_id: row.task_id, p_answer_raw: raw,
        })
        if (err) throw new Error(humanizeTaskError(err.message))
        // null — база не считает задачу автопроверяемой; со staff-строкой это
        // расходится, и честнее сказать об этом, чем показать «Неверно».
        if (data !== true && data !== false) throw new Error(humanizeTaskError('NOT_AUTO_CHECKABLE'))
        const ok = data === true
        patchLocal(itemId, prev => ({
          ...prev, answer_raw: raw, is_correct: ok, attempts_count: prev.attempts_count + 1,
          closed_by: ok ? 'auto' : prev.closed_by,
        }))
        return ok
      }
      const { data, error: err } = await db.rpc('answer_topic_task', {
        p_topic_id: topicId, p_item_id: itemId, p_answer_raw: raw,
      })
      if (err) throw new Error(humanizeTaskError(err.message))
      await load({ silent: true })
      return Boolean(data?.is_correct)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить ответ')
      return null
    } finally {
      setBusy(null)
    }
  }, [topicId, preview, rows, patchLocal, load])

  const reveal = useCallback(async (itemId: string): Promise<RevealedSolution | null> => {
    if (!topicId) return null
    setBusy(itemId)
    setError(null)
    try {
      if (preview) {
        const row = rows.find(r => r.item_id === itemId)
        if (!row) throw new Error(humanizeTaskError('ACCESS_DENIED'))
        // Разбор задачи с коротким ответом — после первой попытки (§176).
        if (row.auto_checkable && !row.is_correct && row.attempts_count < 1) throw new Error(humanizeTaskError('NOT_ATTEMPTED_YET'))
        // Ответ и разбор — из каталога, персонал читает его целиком.
        const { data, error: err } = await db
          .from('catalog_tasks')
          .select('answer_html, solution_html, solution_plan_html')
          .eq('id', row.task_id)
          .maybeSingle()
        if (err) throw new Error(err.message)
        if (!data) throw new Error('Разбор недоступен: задача не найдена в каталоге')
        const revealed: RevealedSolution = {
          solution_html: data.solution_html ?? null,
          solution_plan_html: data.solution_plan_html ?? null,
          answer_html: data.answer_html ?? null,
        }
        patchLocal(itemId, prev => ({
          ...prev,
          solution_shown_at: prev.solution_shown_at ?? new Date().toISOString(),
          solution_html: revealed.solution_html,
          answer_html: revealed.answer_html,
        }))
        return revealed
      }
      const { data, error: err } = await db.rpc('reveal_topic_task_solution', {
        p_topic_id: topicId, p_item_id: itemId,
      })
      if (err) throw new Error(humanizeTaskError(err.message))
      await load({ silent: true })
      return data as RevealedSolution
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть разбор')
      return null
    } finally {
      setBusy(null)
    }
  }, [topicId, preview, rows, patchLocal, load])

  const closeSelf = useCallback(async (itemId: string) => {
    if (!topicId) return
    setBusy(itemId)
    setError(null)
    try {
      if (preview) {
        const row = rows.find(r => r.item_id === itemId)
        if (!row) throw new Error(humanizeTaskError('ACCESS_DENIED'))
        if (row.closed_by) throw new Error(humanizeTaskError('ALREADY_SOLVED'))
        if (!row.solution_shown_at) throw new Error(humanizeTaskError('SOLUTION_NOT_SHOWN'))
        patchLocal(itemId, prev => ({ ...prev, closed_by: 'self' }))
        return
      }
      const { error: err } = await db.rpc('close_topic_task_self', {
        p_topic_id: topicId, p_item_id: itemId,
      })
      if (err) throw new Error(humanizeTaskError(err.message))
      await load({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отметить задачу')
    } finally {
      setBusy(null)
    }
  }, [topicId, preview, rows, patchLocal, load])

  const total  = rows.length
  const solved = useMemo(() => rows.filter(r => r.closed_by !== null).length, [rows])

  const reload = useCallback(() => load(), [load])

  return { rows, total, solved, loading, error, busyItem, answer, reveal, closeSelf, reload, preview }
}

/**
 * Строки для предпросмотра (§178): состав набора от `topic_tasks_for_staff`
 * (порядок, условие, автопроверяемость, баллы) + картинки условий из
 * `catalog_task_assets`, как их читает каталог. Личное состояние — пустое,
 * как у ученика, который урок ещё не открывал; память вкладки (§179) ложится
 * поверх уже в хуке.
 */
async function loadPreviewRows(topicId: string): Promise<TopicTaskRow[]> {
  const { data, error: err } = await db.rpc('topic_tasks_for_staff', { p_topic_id: topicId })
  if (err) throw new Error(err.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffRows: any[] = data ?? []
  if (staffRows.length === 0) return []

  const taskIds = Array.from(new Set(staffRows.map(r => r.task_id as string)))
  const { data: assetRows, error: assetsErr } = await db
    .from('catalog_task_assets')
    .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
    .in('task_id', taskIds)
    .order('position')
  if (assetsErr) throw new Error(assetsErr.message)
  const assetsByTask = new Map<string, CatalogTaskAsset[]>()
  for (const a of (assetRows ?? []) as Array<CatalogTaskAsset & { task_id: string }>) {
    const list = assetsByTask.get(a.task_id) ?? []
    list.push(a)
    assetsByTask.set(a.task_id, list)
  }

  return staffRows.map(r => ({
    student_assignment_id: '',
    item_id: r.item_id,
    item_position: r.item_position,
    task_id: r.task_id,
    statement_html: r.statement_html,
    assets: assetsByTask.get(r.task_id) ?? [],
    max_points: r.max_points ?? null,
    auto_checkable: !!r.auto_checkable,
    ...EMPTY_PREVIEW_STATE,
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRow(row: any): TopicTaskRow {
  return {
    ...row,
    assets: Array.isArray(row.assets) ? row.assets : [],
    attempts_count: row.attempts_count ?? 0,
  }
}

export function humanizeTaskError(message: string): string {
  if (message.includes('ALREADY_SOLVED'))      return 'Задача уже решена.'
  if (message.includes('NOT_AUTO_CHECKABLE'))  return 'У этой задачи нет короткого ответа — откройте решение и отметьте сами.'
  if (message.includes('AUTO_CHECKABLE'))      return 'Эту задачу закрывает верный ответ, а не отметка.'
  // Разбор задачи с коротким ответом — после первой попытки (§176); код
  // NOT_SOLVED_YET остаётся от версии §162 на случай базы до миграции.
  if (message.includes('NOT_ATTEMPTED_YET'))   return 'Сначала попробуй ответить — решение откроется после первой попытки'
  if (message.includes('NOT_SOLVED_YET'))      return 'Сначала попробуй ответить — решение откроется после первой попытки'
  if (message.includes('SOLUTION_NOT_SHOWN'))  return 'Сначала откройте решение.'
  if (message.includes('SOLUTION_SHOWN'))      return 'Решение уже открыто — отметь задачу как разобранную'
  if (message.includes('ACCESS_DENIED'))       return 'Задача недоступна.'
  // Вердикт предпросмотра (§179) — только персоналу платформы.
  if (message.includes('STAFF_ONLY'))          return 'Проверка в предпросмотре доступна только персоналу школы.'
  return message
}
