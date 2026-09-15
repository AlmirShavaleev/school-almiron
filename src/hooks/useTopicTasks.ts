import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { PREVIEW_NOOP_MESSAGE, usePreviewMode } from '@/store/staffModeStore'
import { toast } from '@/store/toastStore'
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
 * Предпросмотр глазами ученика (§178): `topic_tasks_for_student` считает от
 * выдачи ученика, у персонала её нет — вместо неё список задач берётся из
 * `topic_tasks_for_staff` (она у персонала есть) и приводится к форме
 * `TopicTaskRow` с `closed_by = null`, `attempts_count = 0`,
 * `solution_shown_at = null`; картинки условий — из `catalog_task_assets`,
 * которые персонал читает как в каталоге. Ответ, разбор и «Разобрал» в
 * предпросмотре — noop с тостом: ни одна RPC записи не вызывается.
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

export function useTopicTasks(topicId: string | undefined) {
  const preview = usePreviewMode()
  const [rows, setRows]       = useState<TopicTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busyItem, setBusy]   = useState<string | null>(null)

  /**
   * `silent` — перечитать строки, не показывая «Загрузка задач…». После
   * ответа/разбора/«Разобрал» экран должен остаться на месте: спиннер вместо
   * ленты размонтирует карточку, и всё её локальное состояние (введённый
   * ответ, подсветка «неверно») пропадает — ученик не видел, что ответил
   * мимо (§176). Первая загрузка и смена темы — с индикатором, как раньше.
   */
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!topicId) { setLoading(false); return }
    if (!opts.silent) setLoading(true)
    setError(null)
    try {
      if (preview) {
        setRows(await loadPreviewRows(topicId))
      } else {
        const { data, error: err } = await db.rpc('topic_tasks_for_student', { p_topic_id: topicId })
        if (err) throw new Error(err.message)
        setRows((data ?? []).map(normalizeRow))
      }
    } catch (e) {
      // Сорвавшийся запрос не должен оставлять вкладку в вечной загрузке:
      // ученик увидит ошибку и сможет обновить страницу.
      setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [topicId, preview])

  useEffect(() => { void load() }, [load])

  /** Ответ с мгновенным вердиктом. Возвращает, верно ли, — для подсветки. */
  const answer = useCallback(async (itemId: string, raw: string): Promise<boolean | null> => {
    if (!topicId) return null
    if (preview) { toast.info(PREVIEW_NOOP_MESSAGE); return null }
    setBusy(itemId)
    setError(null)
    try {
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
  }, [topicId, preview, load])

  const reveal = useCallback(async (itemId: string): Promise<RevealedSolution | null> => {
    if (!topicId) return null
    if (preview) { toast.info(PREVIEW_NOOP_MESSAGE); return null }
    setBusy(itemId)
    setError(null)
    try {
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
  }, [topicId, preview, load])

  const closeSelf = useCallback(async (itemId: string) => {
    if (!topicId) return
    if (preview) { toast.info(PREVIEW_NOOP_MESSAGE); return }
    setBusy(itemId)
    setError(null)
    try {
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
  }, [topicId, preview, load])

  const total  = rows.length
  const solved = useMemo(() => rows.filter(r => r.closed_by !== null).length, [rows])

  const reload = useCallback(() => load(), [load])

  return { rows, total, solved, loading, error, busyItem, answer, reveal, closeSelf, reload, preview }
}

/**
 * Строки для предпросмотра (§178): состав набора от `topic_tasks_for_staff`
 * (порядок, условие, автопроверяемость, баллы) + картинки условий из
 * `catalog_task_assets`, как их читает каталог. Личное состояние — пустое,
 * как у ученика, который урок ещё не открывал.
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
    answer_raw: null,
    is_correct: null,
    attempts_count: 0,
    closed_by: null,
    solution_shown_at: null,
    solution_html: null,
    answer_html: null,
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
  return message
}
