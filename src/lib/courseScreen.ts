/**
 * Страница курса ученика в стиле ЛК (письмо ЛК_стиль_страница_курса.md, 15.10;
 * макет QJwVY9L5NSenZSVSv8vP9z, версия 2 — плитки, без аккордеона и дорожки).
 * Чистые правила плиток разделов и уроков; данные — программа курса
 * (`useStudentCourseProgram`, с замками «по прохождению» и демо), прогресс
 * `student_home_courses()` и открытые ДЗ по разделам (`loadOpenByModule`) —
 * те же источники, что у «Моих курсов»: «всего» везде одно — уроки с ДЗ.
 */
import { isTopicOpen, topicClosedLabel, todayLocal, type TopicOpenState } from '@/lib/topicAvailability'
import type { HomeModule } from '@/lib/studentHomeCourses'
import { plural } from '@/lib/plural'

export interface ScreenTopic extends TopicOpenState {
  id: string
  title: string
  hw_id: string | null
  hw_status: 'not_started' | 'draft' | 'submitted' | 'returned' | 'accepted' | null
}

export interface ScreenModule {
  id: string
  title: string
  topics: ScreenTopic[]
}

/** ДЗ к сдаче: урок открыт, ДЗ есть и не сдано (не начато, черновик, вернули). */
const toDo = (t: ScreenTopic, today: string) =>
  !!t.hw_id && isTopicOpen(t, today) && (t.hw_status == null || t.hw_status === 'not_started' || t.hw_status === 'draft' || t.hw_status === 'returned')

export interface HwChips { toDo: number; review: number; returned: number }

/** «2 ДЗ сдать · 1 на проверке · 1 вернули» — словами вместо значков 🕓/↺. */
export function hwChips(modules: readonly ScreenModule[], today: string = todayLocal()): HwChips {
  const all = modules.flatMap(m => m.topics)
  return {
    toDo: all.filter(t => toDo(t, today)).length,
    review: all.filter(t => !!t.hw_id && t.hw_status === 'submitted').length,
    returned: all.filter(t => !!t.hw_id && t.hw_status === 'returned').length,
  }
}

export type TileState = 'done' | 'current' | 'open' | 'future'

export interface SectionTile {
  id: string
  /** Номер с 1 («Раздел 1»). */
  n: number
  title: string
  state: TileState
  pill: { kind: 'ok' | 'hw' | 'open' | 'lock'; text: string }
  subtitle: string
  done: number
  open: number
  total: number
}

/**
 * Плитки разделов. Пройдено/всего — `student_home_courses` по разделу (уроки с
 * ДЗ, сервер видит и закрытые); открыто — `loadOpenByModule`; «есть ДЗ к
 * сдаче» — открытые уроки программы с несданным ДЗ. Текущий раздел — первый,
 * где есть открытые непройденные уроки.
 */
export function sectionTiles(
  modules: readonly ScreenModule[],
  progress: readonly HomeModule[] | null,
  openByModule: ReadonlyMap<string, number> | null,
  mode: 'progress' | 'schedule',
  today: string = todayLocal(),
): SectionTile[] {
  const byId = new Map((progress ?? []).map(m => [m.moduleId, m]))
  const rows = modules.map((m, i) => {
    const p = byId.get(m.id)
    const total = p?.total ?? m.topics.filter(t => !!t.hw_id).length
    const done = Math.min(total, p?.done ?? m.topics.filter(t => t.hw_status === 'submitted' || t.hw_status === 'accepted').length)
    const openHw = openByModule ? openByModule.get(m.id) ?? 0 : m.topics.filter(t => !!t.hw_id && isTopicOpen(t, today)).length
    const open = Math.min(total, Math.max(done, openHw))
    return { m, n: i + 1, total, done, open, hw: m.topics.filter(t => toDo(t, today)).length }
  })
  const current = rows.findIndex(r => r.open > r.done || r.hw > 0)
  return rows.map((r, i) => {
    const complete = r.total > 0 && r.done >= r.total
    const state: TileState = complete ? 'done' : i === current ? 'current' : r.open > r.done ? 'open' : 'future'
    const prev = i > 0 ? rows[i - 1].m.title : null
    const firstDate = r.m.topics.map(t => t.available_from?.slice(0, 10)).filter((d): d is string => !!d && d > today).sort()[0]
    const pill: SectionTile['pill'] =
      complete ? { kind: 'ok', text: 'пройден' }
      : r.hw > 0 ? { kind: 'hw', text: `${r.hw} ДЗ сдать` }
      : r.open > r.done ? { kind: 'open', text: `${r.open - r.done} открыто` }
      : { kind: 'lock', text: 'впереди' }
    const subtitle =
      complete ? 'пройден'
      : state === 'current' ? (r.hw > 0 ? `идёт сейчас · ${r.hw} ДЗ сдать` : 'идёт сейчас')
      : r.open > r.done ? `открыто ${r.open - r.done} ${plural(r.open - r.done, 'урок', 'урока', 'уроков')}`
      : mode === 'schedule' && firstDate ? `откроется ${shortDate(firstDate)}`
      : prev ? `после «${prev}»` : 'впереди'
    return { id: r.m.id, n: r.n, title: r.m.title, state, pill, subtitle, done: r.done, open: r.open, total: r.total }
  })
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function shortDate(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS[m - 1]}`
}

export type LessonState = 'done' | 'review' | 'hw' | 'open' | 'nohw' | 'locked'

export interface LessonTile {
  state: LessonState
  /** Подпись пилюли: «пройдено», «сдать ДЗ», «на проверке», «без ДЗ», условие замка. */
  pill: string
}

/**
 * Плитка урока: пройдено (ДЗ принято) / на проверке / сдать ДЗ / открыто /
 * без ДЗ / замок с условием («Откроется после урока «…»», «Доступно по
 * подписке», «Откроется 27 октября»). У закрытого урока ДЗ ученику не видно
 * (RLS), поэтому «без ДЗ» — только у открытых.
 */
export function lessonTile(t: ScreenTopic, today: string = todayLocal()): LessonTile {
  if (t.hw_status === 'accepted') return { state: 'done', pill: 'пройдено' }
  if (t.hw_status === 'submitted') return { state: 'review', pill: 'на проверке' }
  if (!isTopicOpen(t, today)) return { state: 'locked', pill: topicClosedLabel(t, today) }
  if (!t.hw_id) return { state: 'nohw', pill: 'без ДЗ' }
  return toDo(t, today) ? { state: 'hw', pill: t.hw_status === 'returned' ? 'вернули · сдать ДЗ' : 'сдать ДЗ' } : { state: 'open', pill: 'открыто' }
}
