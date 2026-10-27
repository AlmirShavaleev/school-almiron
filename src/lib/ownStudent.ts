import { supabase } from '@/lib/supabase'

/**
 * Своя строка `students` (её id) — один запрос на профиль за сессию
 * (письмо ЛК_СРОЧНО_шторм_запросов_программа_курса.md, 27.10: у ученика
 * `GET /rest/v1/students` уходил 14–38 раз в минуту — каждый хук искал свою
 * строку сам: дашборд, ДЗ, курс, урок, уроки, пробники, todo…).
 *
 * Связь «профиль → students.id» не меняется за сессию, поэтому ответ живёт,
 * пока жива вкладка; другой профиль — другой ключ. Ошибка не кэшируется:
 * следующий вызов спросит снова. Персонал без строки — законный ответ null.
 *
 * Форма ответа — как у supabase `{ data }`, чтобы прежние вызовы
 * `const { data: student } = await …` менялись одной строкой.
 */
const cache = new Map<string, Promise<{ data: { id: string } | null }>>()

export function ownStudentRow(profileId: string): Promise<{ data: { id: string } | null }> {
  const hit = cache.get(profileId)
  if (hit) return hit
  const p = Promise.resolve(
    supabase.from('students').select('id').eq('profile_id', profileId).maybeSingle(),
  ).then(({ data, error }) => {
    if (error) { cache.delete(profileId); return { data: null } }
    return { data: data ? { id: (data as { id: string }).id } : null }
  }, () => {
    cache.delete(profileId)
    return { data: null }
  })
  cache.set(profileId, p)
  return p
}

/** `students.id` профиля или null. */
export async function ownStudentId(profileId: string): Promise<string | null> {
  return (await ownStudentRow(profileId)).data?.id ?? null
}

/** Выход из аккаунта и тесты: забыть ответы. */
export function resetOwnStudentCache(): void {
  cache.clear()
}

// Сброс между тестами (src/test/setup.ts) — через глобальный крючок: импорт
// модуля в setup потянул бы настоящий supabase раньше моков теста.
;(globalThis as { __resetOwnStudentCache?: () => void }).__resetOwnStudentCache = resetOwnStudentCache
