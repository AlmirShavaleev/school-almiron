/**
 * Присутствие в проверке ДЗ — чистая часть.
 *
 * Кто сейчас смотрит какую работу, приходит из Supabase Presence: канал на
 * курс `hw-review:<courseId>`, в payload — `{ profileId, name, attemptId }`.
 * Здесь только разбор состояния канала и подписи для интерфейса; сокеты и
 * подписки живут в `useReviewPresence`.
 *
 * Почему присутствие, а не блокировка в базе: строку-замок надо снимать, а
 * вкладку закрывают, роняют и теряют связь — и работа осталась бы запертой
 * навсегда, руками не расцепить. Presence снимает участника сам при обрыве
 * соединения (событие `leave`), поэтому зависших замков не бывает в принципе.
 * Плата за это — присутствие остаётся ПОДСКАЗКОЙ, а не мьютексом: при лаге
 * двое успевают войти одновременно. Поэтому интерфейс на нём только
 * предупреждает, а от порчи данных защищает база (см. `isAlreadyReviewedError`).
 */

/** Один участник канала: кто и в какой работе сейчас находится. */
export interface PresenceMeta {
  profileId: string
  name: string
  /** `null` — человек в списке очереди, но ни одну работу не открыл. */
  attemptId: string | null
}

/**
 * Разбирает `channel.presenceState()`. Значения приходят с провода
 * нетипизированными, поэтому каждое поле проверяем: одна кривая запись не
 * должна ронять экран проверки.
 */
export function parsePresenceState(state: unknown): PresenceMeta[] {
  if (!state || typeof state !== 'object') return []
  const result: PresenceMeta[] = []
  for (const metas of Object.values(state as Record<string, unknown>)) {
    if (!Array.isArray(metas)) continue
    for (const raw of metas) {
      if (!raw || typeof raw !== 'object') continue
      const meta = raw as Record<string, unknown>
      const profileId = typeof meta.profileId === 'string' ? meta.profileId : null
      if (!profileId) continue
      result.push({
        profileId,
        name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : 'Коллега',
        attemptId: typeof meta.attemptId === 'string' ? meta.attemptId : null,
      })
    }
  }
  return result
}

/**
 * Схлопывает участника до одной записи на профиль и выкидывает себя.
 *
 * Один и тот же человек с двумя вкладками даёт две записи, а «Смотрят: Аня и
 * Аня» — бессмыслица. Из нескольких вкладок оставляем ту, где работа открыта:
 * важно именно «Аня внутри работы», а не «Аня где-то в очереди».
 */
export function dedupeViewers(metas: PresenceMeta[], selfProfileId: string | null): PresenceMeta[] {
  const byProfile = new Map<string, PresenceMeta>()
  for (const meta of metas) {
    if (selfProfileId && meta.profileId === selfProfileId) continue
    const prev = byProfile.get(meta.profileId)
    if (!prev || (prev.attemptId === null && meta.attemptId !== null)) {
      byProfile.set(meta.profileId, meta)
    }
  }
  return Array.from(byProfile.values())
}

/** Кто сейчас внутри конкретной работы (себя тут уже нет). */
export function viewersOfAttempt(viewers: PresenceMeta[], attemptId: string): PresenceMeta[] {
  return viewers.filter(v => v.attemptId === attemptId)
}

/**
 * Подпись для бейджа. Имён больше двух не перечисляем — строка очереди узкая,
 * а точное число важнее списка.
 */
export function viewersLabel(viewers: PresenceMeta[]): string {
  const names = viewers.map(v => v.name)
  if (names.length === 0) return ''
  if (names.length === 1) return `Смотрит: ${names[0]}`
  if (names.length === 2) return `Смотрят: ${names[0]}, ${names[1]}`
  return `Смотрят: ${names[0]}, ${names[1]} и ещё ${names.length - 2}`
}

/** Топик канала. Формат жёстко связан с политикой RLS на `realtime.messages`. */
export function reviewChannelTopic(courseId: string): string {
  return `hw-review:${courseId}`
}
