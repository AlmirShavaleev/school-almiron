/**
 * §219. Уведомление ученику о результате пробника — по кнопке, а не при
 * сохранении таблицы.
 *
 * Правило «одному итогу — одно уведомление» живёт в базе
 * (`notify_mock_exam_results` сравнивает итог с `notified_*` и второй раз
 * тот же итог не шлёт). Здесь — зеркало этого правила для экрана: чтобы
 * кнопка была недоступна там, где база всё равно никого не разбудит, и
 * счётчик в «Отправить N ученикам?» совпадал с тем, что уйдёт.
 * Менять вместе с функцией в PENDING_219.sql.
 */

export interface MockExamResultNotifyRow {
  student_id: string
  score: number | null
  part1_score: number | null
  part2_score: number | null
  notified_at: string | null
  notified_score: number | null
  notified_part1_score: number | null
  notified_part2_score: number | null
}

export type NotifyState =
  /** Итога нет — отправлять нечего. */
  | { kind: 'none' }
  /** Итог есть, не отправлялся. */
  | { kind: 'ready' }
  /** Отправлен ровно этот итог. */
  | { kind: 'sent'; at: string }
  /** Отправлялся, но итог с тех пор изменился. */
  | { kind: 'changed'; at: string }

export function notifyState(r: MockExamResultNotifyRow | null | undefined): NotifyState {
  if (!r || r.score == null) return { kind: 'none' }
  if (!r.notified_at) return { kind: 'ready' }
  const same = r.notified_score === r.score
    && r.notified_part1_score === r.part1_score
    && r.notified_part2_score === r.part2_score
  return same ? { kind: 'sent', at: r.notified_at } : { kind: 'changed', at: r.notified_at }
}

/** Можно ли нажать «Уведомить» по этому состоянию. */
export function canNotify(s: NotifyState): boolean {
  return s.kind === 'ready' || s.kind === 'changed'
}

/**
 * Кому уйдёт «Уведомить всех»: ученики группы (в порядке экрана), у кого
 * итог есть и этот итог им ещё не отправлен. Ученик без профиля не
 * получит ничего — его не считаем.
 */
export function pendingRecipients(
  roster: { id: string; profileId: string | null }[],
  results: Record<string, MockExamResultNotifyRow | undefined>,
): string[] {
  return roster
    .filter(s => s.profileId && canNotify(notifyState(results[s.id])))
    .map(s => s.id)
}

/** «25.09, 20:40» — по Москве: школа работает по московскому времени. */
export function formatSentAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })
  const time = d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time}`
}

/** Ответ `notify_mock_exam_results`. */
export interface NotifySummary {
  sent: number
  telegram: number
  already: number
  no_result: number
  no_profile: number
  rows: { student_id: string; notified_at: string }[]
}
