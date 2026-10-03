/**
 * §264. Напоминания ученикам в Telegram — вход для клиента (настройки учителя на курс и ученика у себя).
 *
 * Список видов, подписи «когда / кому», значения по умолчанию и имена колонок живут в одном месте —
 * `supabase/functions/_shared/student-reminders.ts`: его же читают edge-функция и очередь. Второй копии списка на
 * клиенте нет — иначе экран настроек и рассылка разъехались бы.
 */
import {
  REMINDER_KINDS,
  studentReminderText,
  type ReminderKind,
  type ReminderKindInfo,
} from '../../supabase/functions/_shared/student-reminders.ts'

export type { ReminderKind, ReminderKindInfo }
/** Текст сообщения — тот же, что соберёт очередь (для примеров в настройках). */
export { studentReminderText }
export const REMINDER_KIND_OPTIONS: readonly ReminderKindInfo[] = REMINDER_KINDS

export type ReminderSwitches = Record<ReminderKind, boolean>

/** Строка `course_reminder_settings` (или её отсутствие) → включено/выключено по видам; нет строки — по умолчанию. */
export function courseReminderSwitches(row: Record<string, unknown> | null | undefined): ReminderSwitches {
  const out = {} as ReminderSwitches
  for (const k of REMINDER_KINDS) {
    const v = row?.[k.courseColumn]
    out[k.kind] = typeof v === 'boolean' ? v : k.defaultOn
  }
  return out
}

/** Строка для upsert в `course_reminder_settings`. */
export function courseReminderRow(courseId: string, s: ReminderSwitches): Record<string, unknown> {
  const row: Record<string, unknown> = { course_id: courseId, updated_at: new Date().toISOString() }
  for (const k of REMINDER_KINDS) row[k.courseColumn] = s[k.kind]
  return row
}

/** Выключатели ученика (`notification_prefs.remind_*`); нет значения — включено. */
export function studentReminderSwitches(prefs: Record<string, unknown> | null | undefined): ReminderSwitches {
  const out = {} as ReminderSwitches
  for (const k of REMINDER_KINDS) out[k.kind] = prefs?.[k.prefColumn] !== false
  return out
}

/** Поля для upsert своей строки `notification_prefs`. */
export function studentReminderPatch(s: ReminderSwitches): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of REMINDER_KINDS) out[k.prefColumn] = s[k.kind]
  return out
}
