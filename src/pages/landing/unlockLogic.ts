/** Демо «Как открываются уроки»: чистая логика, проверяется тестом. */
export type LessonState = 'done' | 'open' | 'locked'

export const SECTIONS = [
  { n: 'Механика', l: ['Кинематика', 'Динамика', 'Законы сохранения', 'Статика', 'Колебания'] },
  { n: 'МКТ и термодинамика', l: ['Основы МКТ', 'Газовые законы', 'Первый закон', 'Тепловые машины'] },
]

/** В каждом разделе сразу открыты первые два урока. */
export function initialUnlock(): LessonState[][] {
  return SECTIONS.map(s => s.l.map((_, i) => (i < 2 ? 'open' : 'locked')))
}

/** «Сдать ДЗ» в разделе: первый открытый урок закрыт, первый запертый открыт. */
export function submitHomework(state: LessonState[][], si: number): { next: LessonState[][]; changed: number[] } {
  const li = state[si].indexOf('open')
  if (li < 0) return { next: state, changed: [] }
  const col = [...state[si]]
  col[li] = 'done'
  const changed = [li]
  const nx = col.indexOf('locked')
  if (nx >= 0) {
    col[nx] = 'open'
    changed.push(nx)
  }
  return { next: state.map((c, i) => (i === si ? col : c)), changed }
}
