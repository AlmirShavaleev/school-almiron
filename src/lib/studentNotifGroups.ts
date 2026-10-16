/**
 * «Настройки → Уведомления» у ученика (письмо ЛК_стиль_настройки_ученика.md,
 * 16.10). Только то, что реально уходит, — проверено по коду отправки
 * (очередь `notification_queue` → `process-notification-queue`,
 * `isTelegramPreferenceEnabled`, напоминания `student-reminders`).
 *
 * Не показываем ученику (колонки в базе остаются):
 *  · `lesson`, `lesson_changed` — живых занятий нет (`lessons` пуста), переносы
 *    никто не отправляет;
 *  · `badge` — уведомлений о достижениях нет;
 *  · `payment` — ни одна отправка его не читает: письма и сообщения о
 *    подписке уходят всегда (без них можно потерять доступ);
 *  · `email` — ничего не включает и не выключает: на почту приходят только
 *    письма о подписке, мимо этого флага.
 *
 * Всё ниже уходит только в Telegram; без привязки переключатели неактивны.
 */
export type StudentPrefKey =
  | 'homework' | 'checked' | 'overdue' | 'telegram_variant_assignments'
  | 'remind_hw_due_tomorrow' | 'remind_hw_overdue' | 'remind_no_photo'
  | 'remind_check_soon' | 'remind_streak' | 'remind_mock_tomorrow'

export interface PrefItem {
  key: StudentPrefKey
  label: string
  /** Одна строка пояснения, без технических названий. */
  sub: string
  /** Значение, если строки настроек ещё нет (как default у колонки). */
  def: boolean
}

export interface PrefGroup {
  id: 'homework' | 'mocks'
  title: string
  note?: string
  items: PrefItem[]
}

export const STUDENT_NOTIF_GROUPS: readonly PrefGroup[] = [
  {
    id: 'homework',
    title: 'Домашние задания',
    items: [
      { key: 'homework', label: 'Новое ДЗ и новый урок', sub: 'Преподаватель выдал задание или открылся следующий урок', def: true },
      { key: 'checked', label: 'ДЗ проверено', sub: 'Оценка и комментарий преподавателя, результат пробника', def: true },
      { key: 'remind_hw_due_tomorrow', label: 'Срок ДЗ завтра', sub: 'Накануне в 19:00, если ещё не сдано', def: true },
      { key: 'remind_hw_overdue', label: 'Срок ДЗ прошёл', sub: 'На следующий день в 17:00, если не сдано', def: true },
      { key: 'overdue', label: 'Напоминание от преподавателя', sub: 'Когда преподаватель напомнит о просроченном ДЗ', def: true },
      { key: 'remind_check_soon', label: 'Скоро проверочная', sub: 'За час до начала проверочной работы', def: true },
      { key: 'remind_no_photo', label: 'Нет фото в работе', sub: 'За 10 минут до конца, если работа открыта без фото', def: true },
      { key: 'remind_streak', label: 'Серия прервётся', sub: 'В 18:30, если серия от 3 дней, а сегодня ещё не решал', def: true },
    ],
  },
  {
    id: 'mocks',
    title: 'Пробники',
    note: '«Пробник через час» и «начался» приходят вместе с «Новое ДЗ и новый урок», результат — вместе с «ДЗ проверено».',
    items: [
      { key: 'remind_mock_tomorrow', label: 'Пробник завтра', sub: 'Накануне в 19:00', def: true },
      { key: 'telegram_variant_assignments', label: 'Новый вариант', sub: 'Преподаватель выдал вариант или пробник', def: true },
    ],
  },
]

export const STUDENT_PREF_KEYS: readonly StudentPrefKey[] = STUDENT_NOTIF_GROUPS.flatMap(g => g.items.map(i => i.key))

/** Строка `notification_prefs` → переключатели ученика (нет строки или null — значение по умолчанию). */
export function studentPrefsFrom(row: Record<string, unknown> | null | undefined): Record<StudentPrefKey, boolean> {
  const out = {} as Record<StudentPrefKey, boolean>
  for (const g of STUDENT_NOTIF_GROUPS) {
    for (const i of g.items) {
      const v = row?.[i.key]
      out[i.key] = typeof v === 'boolean' ? v : i.def
    }
  }
  return out
}
