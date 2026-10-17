/** Демо «Сдать ДЗ → открывается следующая тема»: чистая логика, проверяется тестом. */
export type LessonState = 'done' | 'open' | 'locked'

export const SECTION = 'Законы сохранения'
export const LESSONS = ['Импульс тела', 'Изменение импульса', 'Закон сохранения импульса', 'Работа силы', 'Мощность']

/** Сразу открыты первые две темы раздела. */
export function initialUnlock(): LessonState[] {
  return LESSONS.map((_, i) => (i < 2 ? 'open' : 'locked'))
}

/**
 * «Сдать ДЗ»: первая открытая тема закрыта, первая запертая открыта.
 * `unlocked` — открылась ли новая тема (тогда качается замок).
 */
export function submitHomework(state: LessonState[]): { next: LessonState[]; changed: number[]; unlocked: boolean } {
  const i = state.indexOf('open')
  if (i < 0) return { next: state, changed: [], unlocked: false }
  const next = [...state]
  next[i] = 'done'
  const changed = [i]
  const n = next.indexOf('locked')
  if (n >= 0) {
    next[n] = 'open'
    changed.push(n)
  }
  return { next, changed, unlocked: n >= 0 }
}
