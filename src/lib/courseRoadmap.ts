/**
 * «Календарь тем» в программе курса — дорожка по разделам (письмо
 * ЛК_стиль_календарь_в_программу_курса.md, 15.10, вариант «А» макета
 * владельца). Чистые правила; данные — программа курса, которая уже на
 * странице (`useStudentCourseProgram` + замки «по прохождению» + демо).
 *
 * Статус темы:
 *   • «пройдено» — ДЗ сдано или принято (как `student_home_courses`);
 *   • «сдать ДЗ» — тема открыта, ДЗ опубликовано и не сдано;
 *   • «открыто» — тема открыта (ДЗ нет);
 *   • закрыта — с условием: «после сдачи «…»» / «с подпиской» (курс по
 *     прохождению, решает база) или дата открытия (курс по расписанию).
 * Кольцо раздела — счётчики §280 (`doneTopics / countedTopics`), те же, что
 * кольцо в шапке страницы курса: два кольца одной страницы не расходятся.
 *
 * Пройденные темы прячутся в число: в развёрнутом разделе — открытые темы и
 * не больше двух следующих закрытых, сколько бы тем ни было.
 */
import { isTopicOpen, topicClosedLabel, todayLocal, type TopicOpenState } from '@/lib/topicAvailability'
import type { CourseCounters } from '@/lib/studentCourseCounters'

export interface RoadmapTopicIn extends TopicOpenState {
  id: string
  title: string
  hw_id: string | null
  hw_status: 'not_started' | 'draft' | 'submitted' | 'returned' | 'accepted' | null
}

export interface RoadmapModuleIn {
  id: string
  title: string
  topics: RoadmapTopicIn[]
  counters: CourseCounters
}

export type RoadmapTopicState = 'done' | 'hw' | 'open' | 'locked'

export interface RoadmapTopic {
  id: string
  title: string
  state: RoadmapTopicState
  /** Закрытая тема — условие («Откроется после урока «…»», «Доступно по подписке», «Откроется 27 октября»). */
  note: string | null
}

export type RoadmapModuleState = 'done' | 'current' | 'open' | 'locked'

export interface RoadmapModule {
  id: string
  title: string
  state: RoadmapModuleState
  done: number
  total: number
  percent: number
  /** ДЗ к сдаче в разделе. */
  hwToDo: number
  /** Подпись под названием: «идёт сейчас · пройдено 2 из 6», «после «Кинематика»», «13 окт – 2 ноя». */
  meta: string
  /** Что показать в развёрнутом разделе. */
  visible: RoadmapTopic[]
  /** Закрытых тем за пределами показанных. */
  moreLocked: number
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const short = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]}` }

export function topicState(t: RoadmapTopicIn, today: string): RoadmapTopicState {
  if (t.hw_status === 'submitted' || t.hw_status === 'accepted') return 'done'
  if (!isTopicOpen(t, today)) return 'locked'
  return t.hw_id ? 'hw' : 'open'
}

/** Недели раздела курса по расписанию: от первой до последней даты открытия тем. */
function datesOf(topics: RoadmapTopicIn[]): { from: string; label: string } | null {
  const days = topics.map(t => t.available_from?.slice(0, 10)).filter((d): d is string => !!d).sort()
  if (days.length === 0) return null
  const a = days[0], b = days[days.length - 1]
  return { from: short(a), label: a === b ? short(a) : `${short(a)} – ${short(b)}` }
}

export function buildRoadmap(modules: RoadmapModuleIn[], today: string = todayLocal()): RoadmapModule[] {
  const rows = modules.map(m => {
    const topics = m.topics.map<RoadmapTopic>(t => {
      const state = topicState(t, today)
      return { id: t.id, title: t.title, state, note: state === 'locked' ? topicClosedLabel(t, today) : null }
    })
    const total = m.counters.countedTopics
    const done = Math.min(m.counters.doneTopics, total)
    return { m, topics, total, done, byProgress: m.topics.some(t => !!t.progress) }
  })

  // Текущий раздел — первый, где есть что сделать сейчас (ДЗ или открытая
  // непройденная тема); иначе первый незавершённый.
  let current = rows.findIndex(r => r.topics.some(t => t.state === 'hw' || t.state === 'open'))
  if (current === -1) current = rows.findIndex(r => r.total === 0 || r.done < r.total)

  return rows.map((r, i) => {
    const allLocked = r.topics.length > 0 && r.topics.every(t => t.state === 'locked')
    const complete = r.total > 0 && r.done >= r.total
    const state: RoadmapModuleState = i === current ? 'current' : complete ? 'done' : allLocked ? 'locked' : 'open'
    const active = r.topics.filter(t => t.state === 'hw' || t.state === 'open')
    const locked = r.topics.filter(t => t.state === 'locked')
    const nextLocked = locked.slice(0, 2)
    const dates = r.byProgress ? null : datesOf(r.m.topics)
    const prevTitle = i > 0 ? rows[i - 1].m.title : null
    const meta =
      state === 'done' ? 'пройден'
      : state === 'current' ? `идёт сейчас · пройдено ${r.done} из ${r.total}`
      : state === 'locked'
        ? (dates ? `откроется ${dates.from}` : prevTitle ? `после «${prevTitle}»` : 'откроется позже')
        : `пройдено ${r.done} из ${r.total}${dates ? ` · ${dates.label}` : ''}`
    return {
      id: r.m.id,
      title: r.m.title,
      state,
      done: r.done,
      total: r.total,
      percent: r.total > 0 ? Math.floor((r.done / r.total) * 100) : 0,
      hwToDo: r.topics.filter(t => t.state === 'hw').length,
      meta,
      visible: [...active, ...nextLocked],
      moreLocked: locked.length - nextLocked.length,
    }
  })
}
