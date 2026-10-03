/**
 * §263. «Проверочная вживую» — экран учителя у работы по времени (kind
 * check/control), пока идёт окно и после него (итог).
 *
 * Чистые помощники без сети: разбор ответа `timed_work_live`, статус ученика,
 * счётчики, фильтры, подписи. База отдаёт сырые факты (попытка, фото, отметка
 * открытия, уходы, действующее окно ученика); статус считается ЗДЕСЬ — одним
 * правилом и для «идёт», и для «итог», чтобы монитор и итог не разошлись.
 *
 * «Открыл условие = начал» (решение §263): ученик с отметкой открытия (или с
 * начатой попыткой) — «пишет». Время — по серверу (`server_now`).
 */
import { plural } from './plural'
import { formatMoscowTime } from './timedWork'

export type LiveStudentStatus =
  | 'submitted'   // сдал сам
  | 'auto'        // ушло автоматически (в момент закрытия окна)
  | 'photos'      // загрузил фото, не сдал (окно идёт)
  | 'writing'     // открыл условие, фото нет — в конце работа не уйдёт
  | 'not_opened'  // не открывал
  | 'sending'     // окно закрылось, фото есть — сервер вот-вот сдаст сам
  | 'missed'      // окно закрылось, сдавать нечего
  | 'waiting'     // личное время ещё впереди («Открыть заново»)

export interface LiveStudentRow {
  studentId: string
  name: string
  openedAt: string | null
  attemptStatus: 'draft' | 'submitted' | 'accepted' | 'returned_for_revision' | null
  submittedAt: string | null
  autoSubmitted: boolean
  photos: number
  lastPhotoAt: string | null
  awayCount: number
  awaySeconds: number
  windowOpensAt: string | null
  windowClosesAt: string | null
  personal: boolean
}

export interface LiveWork {
  homeworkId: string
  topicId: string
  courseId: string | null
  title: string
  kind: 'check' | 'control'
  groupName: string | null
  opensAt: string | null
  closesAt: string | null
  serverNow: string
  students: LiveStudentRow[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const ATTEMPT = ['draft', 'submitted', 'accepted', 'returned_for_revision'] as const

/** Ответ `timed_work_live` → данные экрана. Мусор — null (экран скажет «не загрузилось»). */
export function parseLiveWork(raw: unknown): LiveWork | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const homeworkId = str(r.homework_id)
  const topicId = str(r.topic_id)
  if (!homeworkId || !topicId) return null
  const students = (Array.isArray(r.students) ? r.students : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !!str((s as Record<string, unknown>).student_id))
    .map((s): LiveStudentRow => ({
      studentId: s.student_id as string,
      name: str(s.full_name) ?? 'Ученик',
      openedAt: str(s.opened_at),
      attemptStatus: (ATTEMPT as readonly string[]).includes(s.attempt_status as string)
        ? s.attempt_status as LiveStudentRow['attemptStatus'] : null,
      submittedAt: str(s.submitted_at),
      autoSubmitted: s.auto_submitted === true,
      photos: num(s.photos),
      lastPhotoAt: str(s.last_photo_at),
      awayCount: num(s.away_count),
      awaySeconds: num(s.away_seconds),
      windowOpensAt: str(s.window_opens_at),
      windowClosesAt: str(s.window_closes_at),
      personal: s.personal === true,
    }))
  return {
    homeworkId,
    topicId,
    courseId: str(r.course_id),
    title: str(r.title) ?? 'Работа',
    kind: r.kind === 'check' ? 'check' : 'control',
    groupName: str(r.group_name),
    opensAt: str(r.opens_at),
    closesAt: str(r.closes_at),
    serverNow: str(r.server_now) ?? new Date().toISOString(),
    students,
  }
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN)

/** Открыл условие: отметка открытия или начатая попытка (первое фото начинает её само, §240). */
export function hasOpened(s: Pick<LiveStudentRow, 'openedAt' | 'attemptStatus'>): boolean {
  return !!s.openedAt || s.attemptStatus !== null
}

/** Статус ученика сейчас (по серверному времени). Окно — ЕГО действующее (личное, если есть). */
export function studentStatus(s: LiveStudentRow, nowMs: number): LiveStudentStatus {
  if (s.attemptStatus && s.attemptStatus !== 'draft') return s.autoSubmitted ? 'auto' : 'submitted'
  const opens = ms(s.windowOpensAt)
  const closes = ms(s.windowClosesAt)
  if (Number.isFinite(opens) && nowMs < opens) return 'waiting'
  const closed = Number.isFinite(closes) && nowMs >= closes
  if (closed) return s.attemptStatus === 'draft' && s.photos > 0 ? 'sending' : 'missed'
  if (s.attemptStatus === 'draft' && s.photos > 0) return 'photos'
  if (hasOpened(s)) return 'writing'
  return 'not_opened'
}

export type WorkPhase = 'unscheduled' | 'before' | 'live' | 'after'

/**
 * Фаза работы для шапки: идёт, пока идёт общее окно ИЛИ чьё-то личное
 * («Открыть заново» после конца — экран снова «вживую» для этого ученика).
 */
export function workPhase(w: Pick<LiveWork, 'opensAt' | 'closesAt' | 'students'>, nowMs: number): WorkPhase {
  const opens = ms(w.opensAt)
  const closes = ms(w.closesAt)
  const personalLive = w.students.some(s => s.personal
    && ms(s.windowOpensAt) <= nowMs && nowMs < ms(s.windowClosesAt))
  if (!Number.isFinite(opens) || !Number.isFinite(closes)) return personalLive ? 'live' : 'unscheduled'
  if (nowMs < opens) return personalLive ? 'live' : 'before'
  if (nowMs < closes || personalLive) return 'live'
  return 'after'
}

export interface LiveCounters {
  total: number
  /** Открыли условие (пишут, с фото, сдали) — «пишут · открыли условие». */
  opened: number
  /** Пишут без фото — в конце работа не уйдёт. */
  noPhoto: number
  /** Загрузили фото, не сдали. */
  photos: number
  /** Сдали (сами и автоматически). */
  submitted: number
  notOpened: number
  /** Итог: сдал сам / ушло автоматически (и вот-вот уйдёт) / не писал. */
  self: number
  auto: number
  missed: number
  /** Уходили со страницы хотя бы раз. */
  away: number
  waiting: number
}

export function liveCounters(rows: readonly LiveStudentRow[], nowMs: number): LiveCounters {
  const c: LiveCounters = { total: rows.length, opened: 0, noPhoto: 0, photos: 0, submitted: 0, notOpened: 0, self: 0, auto: 0, missed: 0, away: 0, waiting: 0 }
  for (const s of rows) {
    const st = studentStatus(s, nowMs)
    if (s.awayCount > 0) c.away += 1
    switch (st) {
      case 'submitted': c.submitted += 1; c.opened += 1; c.self += 1; break
      case 'auto': c.submitted += 1; c.opened += 1; c.auto += 1; break
      case 'sending': c.photos += 1; c.opened += 1; c.auto += 1; break
      case 'photos': c.photos += 1; c.opened += 1; break
      case 'writing': c.noPhoto += 1; c.opened += 1; break
      case 'not_opened': c.notOpened += 1; break
      case 'missed': c.missed += 1; break
      case 'waiting': c.waiting += 1; break
    }
  }
  return c
}

export type LiveFilter = 'all' | 'no_photo' | 'not_opened' | 'away'

export function matchesFilter(s: LiveStudentRow, filter: LiveFilter, nowMs: number): boolean {
  switch (filter) {
    case 'all': return true
    case 'no_photo': {
      // После конца — те, кто открыл условие, но фото так и не загрузил.
      const st = studentStatus(s, nowMs)
      return st === 'writing' || (st === 'missed' && hasOpened(s))
    }
    case 'not_opened': {
      const st = studentStatus(s, nowMs)
      return st === 'not_opened' || (st === 'missed' && !hasOpened(s))
    }
    case 'away': return s.awayCount > 0
  }
}

export function filterCounts(rows: readonly LiveStudentRow[], nowMs: number): Record<LiveFilter, number> {
  const out: Record<LiveFilter, number> = { all: rows.length, no_photo: 0, not_opened: 0, away: 0 }
  for (const s of rows) {
    if (matchesFilter(s, 'no_photo', nowMs)) out.no_photo += 1
    if (matchesFilter(s, 'not_opened', nowMs)) out.not_opened += 1
    if (matchesFilter(s, 'away', nowMs)) out.away += 1
  }
  return out
}

/** Порядок строк — как в макете: сдали → с фото → пишут без фото → не открывали; внутри — по имени. */
const ORDER: Record<LiveStudentStatus, number> = {
  submitted: 0, auto: 1, sending: 2, photos: 3, writing: 4, waiting: 5, not_opened: 6, missed: 7,
}

export function liveRows(rows: readonly LiveStudentRow[], filter: LiveFilter, nowMs: number): LiveStudentRow[] {
  return rows
    .filter(s => matchesFilter(s, filter, nowMs))
    .sort((a, b) => ORDER[studentStatus(a, nowMs)] - ORDER[studentStatus(b, nowMs)] || a.name.localeCompare(b.name, 'ru'))
}

/** Подпись статуса в строке: «сдал 09:21», «ушло автоматически 09:30», «пишет, фото нет». */
export function statusLabel(s: LiveStudentRow, nowMs: number): string {
  const st = studentStatus(s, nowMs)
  switch (st) {
    case 'submitted': return `сдал ${formatMoscowTime(s.submittedAt)}`.trim()
    case 'auto': return `ушло автоматически ${formatMoscowTime(s.submittedAt)}`.trim()
    case 'sending': return 'сдаётся автоматически'
    case 'photos': return 'фото есть'
    case 'writing': return 'пишет, фото нет'
    case 'not_opened': return 'не открывал'
    case 'missed': return hasOpened(s) ? 'открыл, не сдал' : 'не писал'
    case 'waiting': return `личное время с ${formatMoscowTime(s.windowOpensAt)}`
  }
}

/** «Открыть заново» (личное окно §240): у тех, кто не открывал и кто не сдал после конца. Сданную сервер не откроет. */
export function canReopen(s: LiveStudentRow, nowMs: number): boolean {
  const st = studentStatus(s, nowMs)
  return st === 'not_opened' || st === 'missed' || st === 'waiting'
}

/** «2 раза · 1 мин 10 с», «5 раз · 4 мин», «—». */
export function awayLabel(count: number, seconds: number): string {
  if (count <= 0) return '—'
  return `${count} ${plural(count, 'раз', 'раза', 'раз')} · ${durationShort(seconds)}`
}

export function durationShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m} мин ${rest} с` : `${m} мин`
}

/** Опрос монитора: раз в 15 с, пока идёт работа и вкладка видна; после конца — пока кто-то «сдаётся». */
export const LIVE_POLL_MS = 15_000
export function shouldPoll(phase: WorkPhase, counters: Pick<LiveCounters, 'photos'>, hidden: boolean): boolean {
  if (hidden) return false
  if (phase === 'live' || phase === 'before') return true
  // После конца черновики с фото сервер сдаёт раз в минуту — дождаться «ушло автоматически».
  return phase === 'after' && counters.photos > 0
}

// ── Главная учителя: идущие сейчас работы («Следить») ────────────────────────

export interface LiveWorkBrief {
  homeworkId: string
  topicId: string
  title: string
  kind: 'check' | 'control'
  groupName: string | null
  opensAt: string | null
  closesAt: string | null
  /** Сколько личных окон («Открыть заново») идёт сейчас. */
  personalLive: number
}

/** Ответ `my_live_timed_works()` → список. Не массив — пусто. */
export function parseLiveWorksList(raw: unknown): LiveWorkBrief[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !!str((x as Record<string, unknown>).homework_id))
    .map(x => ({
      homeworkId: x.homework_id as string,
      topicId: str(x.topic_id) ?? '',
      title: str(x.title) ?? 'Работа',
      kind: x.kind === 'check' ? 'check' : 'control',
      groupName: str(x.group_name),
      opensAt: str(x.opens_at),
      closesAt: str(x.closes_at),
      personalLive: num(x.personal_live),
    }))
}

/** «идёт до 09:30» / «личное время у 2» — подпись строки на главной. */
export function liveBriefNote(w: LiveWorkBrief, nowMs: number): string {
  const generalLive = !!w.opensAt && !!w.closesAt && Date.parse(w.opensAt) <= nowMs && nowMs < Date.parse(w.closesAt)
  if (generalLive) return `идёт до ${formatMoscowTime(w.closesAt)}`
  return w.personalLive > 0 ? `личное время у ${w.personalLive}` : 'идёт'
}

// ── Пробник: уходы со страницы для монитора §224 ────────────────────────────

/** Ответ `mock_exam_away` → { student_id: { count, seconds } }. */
export function parseMockAway(raw: unknown): Record<string, { count: number; seconds: number }> {
  const out: Record<string, { count: number; seconds: number }> = {}
  if (!Array.isArray(raw)) return out
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const id = str(r.student_id)
    if (!id) continue
    out[id] = { count: num(r.away_count), seconds: num(r.away_seconds) }
  }
  return out
}
