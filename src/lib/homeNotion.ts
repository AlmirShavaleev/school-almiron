/**
 * Главная ученика «как в Notion» (письмо ЛК_стиль_главная_как_notion.md, 16.10):
 * обложки, фраза дня под часами, мини-календарь месяца. Чистые правила — их
 * проверяет vitest; сеть и хранилище — в компонентах.
 */
import type { ActivityDay } from '@/lib/studentActivity'
import { plural } from '@/lib/plural'
import { lessonTile, type LessonTile } from '@/lib/courseScreen'

// ── Обложки ─────────────────────────────────────────────────────────────────

export interface HomeCover {
  id: string
  label: string
  /** Сцена лендинга (public/brand/scenes) или null — градиент со стикерами. */
  image: string | null
  /** Позиция фото по вертикали. */
  focus?: string
  /** CSS-фон для градиентных обложек. */
  background?: string
  stickers?: Array<{ name: 'rocket' | 'target' | 'book' | 'calendar25' | 'clock' | 'play' | 'check'; size: number; right?: string; left?: string; top: string }>
}

/** Набор обложек: две сцены лендинга и три градиента бренда с 3D-стикерами. */
export const HOME_COVERS: readonly HomeCover[] = [
  {
    id: 'orbit', label: 'Орбита', image: null,
    background: 'linear-gradient(120deg, #1d3fb8 0%, #2457e6 45%, #6f95ff 100%)',
    stickers: [{ name: 'rocket', size: 120, right: '6%', top: '8%' }, { name: 'target', size: 84, right: '24%', top: '38%' }],
  },
  { id: 'sunset', label: 'Закат', image: '/brand/scenes/sunset.webp', focus: '50% 40%' },
  {
    id: 'warm', label: 'Тёплая', image: null,
    background: 'linear-gradient(120deg, #f4a259 0%, #ef8a3a 50%, #f7c48a 100%)',
    stickers: [{ name: 'book', size: 108, right: '7%', top: '12%' }, { name: 'calendar25', size: 80, right: '26%', top: '40%' }],
  },
  { id: 'desk', label: 'Стол', image: '/brand/scenes/desk.webp', focus: '50% 22%' },
  {
    id: 'night', label: 'Ночь', image: null,
    background: 'radial-gradient(120% 140% at 85% 10%, #3b4c9b 0%, #1a2150 45%, #0f1330 100%)',
    stickers: [{ name: 'clock', size: 96, right: '8%', top: '14%' }, { name: 'play', size: 72, right: '25%', top: '44%' }],
  },
]

export const DEFAULT_COVER = HOME_COVERS[0].id

const COVER_KEY = (profileId: string) => `almiron:home-cover:${profileId}`

/** Выбор обложки — только в браузере (без базы), сбой хранилища — обложка по умолчанию. */
export function readCover(profileId: string | null | undefined): string {
  if (!profileId) return DEFAULT_COVER
  try {
    const v = localStorage.getItem(COVER_KEY(profileId))
    return v && HOME_COVERS.some(c => c.id === v) ? v : DEFAULT_COVER
  } catch {
    return DEFAULT_COVER
  }
}

export function saveCover(profileId: string | null | undefined, id: string): void {
  if (!profileId) return
  try { localStorage.setItem(COVER_KEY(profileId), id) } catch { /* приватное окно — без запоминания */ }
}

export function coverById(id: string): HomeCover {
  return HOME_COVERS.find(c => c.id === id) ?? HOME_COVERS[0]
}

// ── Фраза дня ───────────────────────────────────────────────────────────────

export const DAY_PHRASES: readonly string[] = [
  'Каждый день по одной теме — и к маю всё сложится.',
  'Не жди настроения: начни с одной задачи.',
  'Ошибка в ДЗ — это подсказка, где расти.',
  'Двадцать минут сегодня лучше трёх часов когда-нибудь.',
  'Разобранная задача остаётся с тобой до экзамена.',
  'Сложно — значит, ты на правильной теме.',
  'Повторение — не скучно, это фундамент.',
  'Маленький шаг каждый день — большой балл в июне.',
  'Спроси, если непонятно: вопрос экономит неделю.',
  'Сначала понять, потом запомнить.',
  'Ты уже дальше, чем был в сентябре.',
  'Отдых — тоже часть плана. Главное — вернуться.',
  'Один пробник честно — лучше пяти «на глаз».',
]

/** Фраза меняется раз в день (по московскому дню YYYY-MM-DD), одна на весь день. */
export function phraseOfDay(today: string): string {
  const [y, m, d] = today.slice(0, 10).split('-').map(Number)
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
  return DAY_PHRASES[((n % DAY_PHRASES.length) + DAY_PHRASES.length) % DAY_PHRASES.length]
}

// ── Мини-календарь ───────────────────────────────────────────────────────────

export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export interface MonthCell { day: string; n: number; info: ActivityDay | null }

export interface MonthGrid {
  /** «Октябрь 2026». */
  title: string
  /** Недели пн–вс; null — клетка вне месяца. */
  weeks: Array<Array<MonthCell | null>>
  /** Дней месяца с занятиями (уровень > 0). */
  activeDays: number
}

/** Месяц `offset` назад от `today` (0 — текущий). Данные — дни из student_home_activity. */
export function monthGrid(today: string, offset: number, days: ReadonlyMap<string, ActivityDay>): MonthGrid {
  const [ty, tm] = today.slice(0, 10).split('-').map(Number)
  const first = new Date(Date.UTC(ty, tm - 1 - offset, 1))
  const y = first.getUTCFullYear(), m = first.getUTCMonth()
  const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7
  const cells: Array<MonthCell | null> = Array.from({ length: lead }, () => null)
  let activeDays = 0
  for (let n = 1; n <= len; n++) {
    const day = `${y}-${String(m + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
    const info = days.get(day) ?? (day > today ? { day, level: 0, solved: 0, future: true, today: false } as ActivityDay : null)
    if (info && !info.future && info.level > 0) activeDays++
    cells.push({ day, n, info })
  }
  while (cells.length % 7) cells.push(null)
  const weeks: Array<Array<MonthCell | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return { title: `${MONTH_NAMES[m]} ${y}`, weeks, activeDays }
}

/** Сколько месяцев назад можно листать (до 3) — пока в данных есть дни. */
export const MONTHS_BACK = 3

/** Дней истории для календаря: от 1-го числа месяца `MONTHS_BACK` назад до сегодня. */
export function activityDaysFor(today: string): number {
  const [y, m, d] = today.slice(0, 10).split('-').map(Number)
  const from = Date.UTC(y, m - 1 - MONTHS_BACK, 1)
  return Math.round((Date.UTC(y, m - 1, d) - from) / 86_400_000) + 1
}

// ── Строка свойств и «Продолжить» ────────────────────────────────────────────

/** «4 дня подряд» — серия в строке свойств. */
export function streakValue(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`
}

export interface HomeContinueCard { id: string; no: number; title: string; module: string; tile: LessonTile }

/**
 * Три урока, начиная со следующего: тот, к которому ведёт «Продолжить», и два
 * за ним в его разделе (если раздел кончился — из следующего). Статус и замок
 * — то же правило `lessonTile`, что у плиток на странице курса.
 */
export function continueCards(
  modules: ReadonlyArray<{ title: string; topics: ReadonlyArray<Parameters<typeof lessonTile>[0]> }>,
  nextTopicId: string,
  demoNote?: string,
  today?: string,
  now?: number,
): HomeContinueCard[] {
  const flat = modules.flatMap(m => {
    const no = new Map(m.topics.map((t, i) => [t.id, i + 1]))
    return m.topics.map(t => ({ t, module: m.title, no }))
  })
  const start = flat.findIndex(x => x.t.id === nextTopicId)
  if (start < 0) return []
  return flat.slice(start, start + 3).map(x => ({
    id: x.t.id, no: x.no.get(x.t.id) ?? 0, title: x.t.title, module: x.module,
    tile: lessonTile(x.t, today, now, x.no, demoNote),
  }))
}

