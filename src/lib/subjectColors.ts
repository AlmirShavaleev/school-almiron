/**
 * Цвет предмета — одна палитра на всё приложение.
 *
 * Значения `from`/`to`/`icon` перенесены как есть из `MyCoursesPage`, где они
 * жили локально: как только цвет предмета понадобился второму экрану (метка
 * курса в списке ДЗ), копия перестала быть безобидной — курс, покрашенный на
 * одной странице в фиолетовый, а на другой в синий, различать глазами нельзя.
 *
 * `dot`/`bar` — тот же оттенок, что и `from`, только сплошной заливкой и
 * рамкой: точка и полоса слева не бывают градиентом. Классы записаны
 * литералами, потому что Tailwind собирает CSS по тексту исходника и
 * склеенное из кусков имя (`bg-${hue}-500`) в сборку не попадёт.
 */

export interface SubjectColor {
  /** Начало градиента карточки курса. */
  from: string
  /** Конец градиента карточки курса. */
  to:   string
  /** Сплошная заливка того же оттенка — точка рядом с названием курса. */
  dot:  string
  /** Левая рамка того же оттенка — полоса на карточке задания. */
  bar:  string
  icon: string
}

const SUBJECT_COLORS: Record<string, SubjectColor> = {
  math:        { from: 'from-blue-500',    to: 'to-indigo-600', dot: 'bg-blue-500',    bar: 'border-l-blue-500',    icon: '📐' },
  russian:     { from: 'from-rose-500',    to: 'to-pink-600',   dot: 'bg-rose-500',    bar: 'border-l-rose-500',    icon: '📝' },
  physics:     { from: 'from-violet-500',  to: 'to-purple-600', dot: 'bg-violet-500',  bar: 'border-l-violet-500',  icon: '⚡' },
  chemistry:   { from: 'from-emerald-500', to: 'to-teal-600',   dot: 'bg-emerald-500', bar: 'border-l-emerald-500', icon: '🧪' },
  biology:     { from: 'from-green-500',   to: 'to-lime-600',   dot: 'bg-green-500',   bar: 'border-l-green-500',   icon: '🌿' },
  history:     { from: 'from-amber-500',   to: 'to-orange-600', dot: 'bg-amber-500',   bar: 'border-l-amber-500',   icon: '📜' },
  geography:   { from: 'from-cyan-500',    to: 'to-blue-600',   dot: 'bg-cyan-500',    bar: 'border-l-cyan-500',    icon: '🌍' },
  english:     { from: 'from-sky-500',     to: 'to-blue-500',   dot: 'bg-sky-500',     bar: 'border-l-sky-500',     icon: '🇬🇧' },
  social:      { from: 'from-orange-500',  to: 'to-amber-600',  dot: 'bg-orange-500',  bar: 'border-l-orange-500',  icon: '🏛️' },
  informatics: { from: 'from-gray-600',    to: 'to-slate-700',  dot: 'bg-gray-600',    bar: 'border-l-gray-600',    icon: '💻' },
}

const FALLBACK: SubjectColor = {
  from: 'from-primary-500', to: 'to-primary-700',
  dot: 'bg-primary-500', bar: 'border-l-primary-500', icon: '📚',
}

/**
 * Цвет по предмету курса. Предмет неизвестен или пуст — общий фирменный цвет:
 * курс без предмета всё равно должен отличаться от соседнего рамкой, а не
 * пропадать в белом.
 */
export function getSubjectColor(subject: string | null | undefined): SubjectColor {
  if (!subject) return FALLBACK
  return SUBJECT_COLORS[subject] ?? FALLBACK
}
