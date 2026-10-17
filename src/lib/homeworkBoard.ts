/**
 * Раздел «Домашние задания» ученика (письмо ЛК_стиль_раздел_ДЗ_открытые_уроки.md,
 * 15.10): ровно столько карточек, сколько ДЗ в открытых уроках, ВКЛЮЧАЯ ДЗ с
 * автопроверкой. Чистые правила; сеть — в useMyTopicHomework.
 *
 * ДЗ с автопроверкой (`topic_homework.autocheck`, §266): задачи урока
 * (`topic_autocheck_tasks`) ученик решает сам. Задача закрыта, если решена
 * верно или потрачены 3 попытки — то же правило, что у открытия уроков в базе
 * (`_progress_state.autocheck_left`, §288). Статус такого ДЗ: «сдать», пока
 * осталась хоть одна задача; «принято», когда закрыты все.
 */
import type { TopicJournalHomework } from '@/lib/topicJournal'

export interface AutocheckProgress {
  total: number
  left: number
}

/** Остаток задач автопроверки по урокам: задачи и мои ответы → {total, left}. */
export function autocheckLeft(
  tasks: ReadonlyArray<{ id: string; topic_id: string }>,
  answers: ReadonlyArray<{ task_id: string; is_correct: boolean }>,
): Map<string, AutocheckProgress> {
  const byTask = new Map<string, { correct: boolean; n: number }>()
  for (const a of answers) {
    const cur = byTask.get(a.task_id) ?? { correct: false, n: 0 }
    byTask.set(a.task_id, { correct: cur.correct || a.is_correct, n: cur.n + 1 })
  }
  const out = new Map<string, AutocheckProgress>()
  for (const t of tasks) {
    const p = out.get(t.topic_id) ?? { total: 0, left: 0 }
    const a = byTask.get(t.id)
    const closed = !!a && (a.correct || a.n >= 3)
    out.set(t.topic_id, { total: p.total + 1, left: p.left + (closed ? 0 : 1) })
  }
  return out
}

export interface BoardRow extends TopicJournalHomework {
  /** ДЗ с автопроверкой (иначе — «2 часть»: проверяет преподаватель). */
  autocheck: boolean
  /** Автопроверка: сколько задач осталось / всего; null — не узнали. */
  left: number | null
  total: number | null
}

/**
 * Строки журнала → строки раздела. У ДЗ с автопроверкой статус из журнала
 * (попытки сдачи) заменяется прогрессом задач: «сдать» при left > 0, «принято»
 * при left = 0. Если задачи не прочитались — статус журнала как есть.
 */
export function withAutocheck(
  rows: readonly TopicJournalHomework[],
  autocheckHomework: ReadonlySet<string>,
  progress: ReadonlyMap<string, AutocheckProgress>,
): BoardRow[] {
  return rows.map(r => {
    if (!autocheckHomework.has(r.homework_id)) return { ...r, autocheck: false, left: null, total: null }
    const p = progress.get(r.topic_id)
    if (!p || p.total === 0) return { ...r, autocheck: true, left: null, total: null }
    const status: TopicJournalHomework['status'] = p.left === 0 ? 'accepted' : 'not_started'
    return { ...r, status, autocheck: true, left: p.left, total: p.total }
  })
}
