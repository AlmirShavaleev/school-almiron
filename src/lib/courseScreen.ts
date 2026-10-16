/**
 * Страница курса ученика в стиле ЛК (письмо ЛК_стиль_страница_курса.md, 15.10;
 * макет QJwVY9L5NSenZSVSv8vP9z, версия 2 — плитки, без аккордеона и дорожки).
 * Чистые правила плиток разделов и уроков; данные — программа курса
 * (`useStudentCourseProgram`, с замками «по прохождению» и демо), прогресс
 * `student_home_courses()` и открытые ДЗ по разделам (`loadOpenByModule`) —
 * те же источники, что у «Моих курсов»: «всего» везде одно — уроки с ДЗ.
 */
import { isTopicOpen, todayLocal, willOpenByDate, type TopicOpenState } from '@/lib/topicAvailability'
import type { HomeModule } from '@/lib/studentHomeCourses'
import { plural } from '@/lib/plural'

export interface ScreenTopic extends TopicOpenState {
  id: string
  title: string
  hw_id: string | null
  hw_status: 'not_started' | 'draft' | 'submitted' | 'returned' | 'accepted' | null
  /** Срок ДЗ — для пометки «просрочено» на плитке урока. */
  hw_due_at?: string | null
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
      : mode === 'schedule' && firstDate ? `откроется ${openDate(firstDate, today).short}`
      : prev ? `после «${prev}»` : 'впереди'
    return { id: r.m.id, n: r.n, title: r.m.title, state, pill, subtitle, done: r.done, open: r.open, total: r.total }
  })
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'нояб', 'дек']
const MONTHS_LONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const WD_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу']

function parts(d: string) {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return { m, dd, wd: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() }
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000)


/**
 * Дата открытия урока (письмо ЛК_стиль_открытие_урока_в_плитке.md, 16.10):
 * коротко «пн 19 окт» / «завтра», полностью — «в понедельник, 19 октября».
 */
export function openDate(day: string, today: string = todayLocal()): { short: string; long: string } {
  const { m, dd, wd } = parts(day)
  if (dayDiff(today, day) === 1) return { short: 'завтра', long: `завтра, ${dd} ${MONTHS_LONG[m - 1]}` }
  return { short: `${WD_SHORT[wd]} ${dd} ${MONTHS[m - 1]}`, long: `в ${WD_ACC[wd]}, ${dd} ${MONTHS_LONG[m - 1]}` }
}

export interface LockLine {
  /** Строка внизу плитки: «🔒 откроется пн 19 окт», «🔒 после урока 7», «🔒 закрыт». */
  short: string
  /** Подсказка по нажатию на закрытую плитку — то же условие словами. */
  tip: string
}

/**
 * Условие открытия закрытого урока — одна логика и один текст для плитки,
 * подсказки и модалки «Урок пройден».
 *
 *  · демо подписки — «🔒 с подпиской»;
 *  · «по прохождению» — «🔒 после урока 7» (номер в разделе); урок из другого
 *    раздела — «🔒 после «Название»»; нет предыдущего, но есть дата — дата;
 *  · «по датам» — «🔒 откроется пн 19 окт» / «🔒 откроется завтра» (только
 *    если дата сама откроет урок);
 *  · закрыт вручную без даты — «🔒 закрыт».
 */
export function lockLine(
  t: TopicOpenState,
  today: string = todayLocal(),
  lessonNo?: ReadonlyMap<string, number>,
  demoNote?: string,
): LockLine {
  const p = t.progress
  if (p && demoNote && p.note === demoNote) return { short: '🔒 с подпиской', tip: 'Урок откроется с подпиской' }
  if (p) {
    if (p.afterTopicId) {
      const n = lessonNo?.get(p.afterTopicId)
      if (n) return { short: `🔒 после урока ${n}`, tip: `Откроется, когда пройдёшь урок ${n}${p.afterTitle ? ` «${p.afterTitle}»` : ''}` }
      if (p.afterTitle) return { short: `🔒 после «${p.afterTitle}»`, tip: `Откроется, когда пройдёшь урок «${p.afterTitle}»` }
    }
    const d = p.opensOn && p.opensOn.slice(0, 10) > today ? openDate(p.opensOn, today) : null
    if (d) return { short: `🔒 откроется ${d.short}`, tip: `Урок откроется ${d.long}` }
    return { short: '🔒 закрыт', tip: 'Урок пока закрыт' }
  }
  const day = willOpenByDate(t, today)
  if (day) {
    const d = openDate(day, today)
    return { short: `🔒 откроется ${d.short}`, tip: `Урок откроется ${d.long}` }
  }
  return { short: '🔒 закрыт', tip: 'Урок пока закрыт' }
}

export type LessonState = 'done' | 'review' | 'hw' | 'open' | 'nohw' | 'locked'

export interface LessonTile {
  state: LessonState
  /** Строка внизу плитки: «✓ пройдено», «сдать ДЗ», «ДЗ на проверке», «открыт · без ДЗ», условие замка. */
  pill: string
  /** У закрытого — подсказка по нажатию. */
  tip?: string
  /** Срок сдачи прошёл, ДЗ не сдано. */
  overdue?: boolean
}

/**
 * Плитка урока (вариант Б, письмо 16.10): строка внизу — статус открытого
 * урока или условие открытия закрытого. У закрытого урока ДЗ ученику не видно
 * (RLS), поэтому «без ДЗ» — только у открытых.
 */
export function lessonTile(
  t: ScreenTopic,
  today: string = todayLocal(),
  now: number = Date.now(),
  /** Номер урока в разделе по id — для «после урока 7». */
  lessonNo?: ReadonlyMap<string, number>,
  demoNote?: string,
): LessonTile {
  if (t.hw_status === 'accepted') return { state: 'done', pill: '✓ пройдено' }
  if (t.hw_status === 'submitted') return { state: 'review', pill: 'ДЗ на проверке' }
  if (!isTopicOpen(t, today)) {
    const l = lockLine(t, today, lessonNo, demoNote)
    return { state: 'locked', pill: l.short, tip: l.tip }
  }
  if (!t.hw_id) return { state: 'nohw', pill: 'открыт · без ДЗ' }
  if (!toDo(t, today)) return { state: 'open', pill: 'открыт' }
  const overdue = !!t.hw_due_at && Date.parse(t.hw_due_at) < now
  const pill = t.hw_status === 'returned' ? 'вернули · сдать ДЗ' : 'сдать ДЗ'
  return overdue ? { state: 'hw', pill: `${pill} · просрочено`, overdue } : { state: 'hw', pill }
}

/**
 * Шапка раздела (письмо 16.10): «открыто 5 из 29 · следующие 5 — пн 19 окт».
 * Вторая часть — только если у закрытых уроков раздела есть будущие даты.
 */
export function sectionOpenLine(topics: readonly ScreenTopic[], today: string = todayLocal()): string {
  const open = topics.filter(t => isTopicOpen(t, today)).length
  const dates = topics
    .filter(t => !isTopicOpen(t, today))
    .map(t => (t.progress ? (t.progress.opensOn && t.progress.opensOn.slice(0, 10) > today ? t.progress.opensOn.slice(0, 10) : null) : willOpenByDate(t, today)))
    .filter((d): d is string => !!d)
    .sort()
  const head = `открыто ${open} из ${topics.length}`
  if (dates.length === 0) return head
  const next = dates[0]
  const k = dates.filter(d => d === next).length
  return `${head} · следующие ${k} — ${openDate(next, today).short}`
}
