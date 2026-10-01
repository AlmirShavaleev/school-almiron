/**
 * §241. Раздел курса «Контрольные, самостоятельные и пробники» — чистая логика
 * без сети.
 *
 * Раздел собирается сам: все темы курса с `kind` check/control (из любых
 * модулей программы) и все пробники группы. Внутри — по ТИПАМ, не по времени:
 * «Пробники», «Контрольные», «Проверочные и самостоятельные» (`check` =
 * проверочная; отдельного типа «Самостоятельная» нет). Внутри блока — по
 * дате, новые сверху.
 *
 * Что показывать ученику, решает база (`my_course_assessments`, PENDING_241):
 * оценка и отметки по заданиям — только после вердикта, итог пробника —
 * только после конца окна и отправки, сравнение с группой — только если
 * результат есть ещё хотя бы у троих других (§223). Здесь — только то, как это
 * сказать словами. «0 %» не пишем: база отдаёт `better_pct = null`, а здесь
 * ноль на всякий случай тоже не показывается.
 *
 * Время — по часам базы (`server_now`), даты и часы — по Москве, как везде.
 */
import { lessonStatus, type MockLessonListRow, type MockLessonStatus } from './mockExamLesson'
import { formatSpan } from './mockExamLive'
import { plural } from './plural'
import type { ReviewTaskVerdict } from './homeworkReviewTasks'

// ─── Данные ученика ─────────────────────────────────────────────────────────

export type WorkKind = 'check' | 'control'
export type WorkAttemptStatus = 'none' | 'draft' | 'submitted' | 'auto_submitted' | 'reviewed'

/** Сравнение с группой. Приходит, только если правило троих выполнено. */
export interface GroupStats {
  avg: number | null
  /** Сколько результатов в среднем (с учётом своего). */
  count: number | null
  /** Работы по времени: сколько сдали и сколько в группе. */
  submitted?: number | null
  in_group?: number | null
  better_pct: number | null
  best: boolean
}

export interface AssessmentTaskMark {
  no: string
  verdict: ReviewTaskVerdict
}

/** Работа по времени курса (тема kind check/control). */
export interface AssessmentWork {
  topic_id: string
  homework_id: string | null
  kind: WorkKind
  title: string
  module_id: string | null
  module_title: string | null
  topic_open: boolean
  available_from: string | null
  grade_scale: 'five' | 'hundred' | null
  /** Действующее окно ученика (личное, если есть). */
  opens_at: string | null
  closes_at: string | null
  personal: boolean
  status: WorkAttemptStatus
  submitted_at: string | null
  reviewed_at: string | null
  /** Только после вердикта. */
  score: number | null
  tasks: AssessmentTaskMark[] | null
  group: GroupStats | null
}

/** Пробник группы: строка `my_mock_exams` плюс первичный, прошлый балл и группа. */
export interface AssessmentMock extends MockLessonListRow {
  primary_score?: number | null
  primary_max?: number | null
  part1_score?: number | null
  part2_score?: number | null
  prev_score?: number | null
  group?: GroupStats | null
}

export interface MyAssessments {
  serverNow: string
  works: AssessmentWork[]
  mocks: AssessmentMock[]
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}

function parseGroup(raw: unknown): GroupStats | null {
  const g = obj(raw)
  if (!g) return null
  const pct = num(g.better_pct)
  return {
    avg: num(g.avg),
    count: num(g.count),
    submitted: num(g.submitted),
    in_group: num(g.in_group),
    better_pct: pct != null && pct > 0 ? pct : null,
    best: g.best === true,
  }
}

const WORK_STATUSES: readonly WorkAttemptStatus[] = ['none', 'draft', 'submitted', 'auto_submitted', 'reviewed']
const VERDICTS: readonly ReviewTaskVerdict[] = ['correct', 'wrong', 'partial', 'unchecked', 'unsolved']

/** Ответ `my_course_assessments` → типы. Мусор — null (раздела нет). */
export function parseMyAssessments(raw: unknown): MyAssessments | null {
  const r = obj(raw)
  if (!r) return null
  const works: AssessmentWork[] = []
  for (const x of Array.isArray(r.works) ? r.works : []) {
    const w = obj(x)
    if (!w || !str(w.topic_id)) continue
    const kind: WorkKind = w.kind === 'check' ? 'check' : 'control'
    const status = WORK_STATUSES.includes(w.status as WorkAttemptStatus) ? w.status as WorkAttemptStatus : 'none'
    const tasks = Array.isArray(w.tasks)
      ? w.tasks.map(obj).filter((t): t is Record<string, unknown> => !!t && typeof t.no === 'string')
        .map(t => ({ no: t.no as string, verdict: VERDICTS.includes(t.verdict as ReviewTaskVerdict) ? t.verdict as ReviewTaskVerdict : 'unchecked' as const }))
      : null
    works.push({
      topic_id: w.topic_id as string,
      homework_id: str(w.homework_id),
      kind,
      title: str(w.title) ?? 'Без названия',
      module_id: str(w.module_id),
      module_title: str(w.module_title),
      topic_open: w.topic_open !== false,
      available_from: str(w.available_from),
      grade_scale: w.grade_scale === 'five' || w.grade_scale === 'hundred' ? w.grade_scale : null,
      opens_at: str(w.opens_at),
      closes_at: str(w.closes_at),
      personal: w.personal === true,
      status,
      submitted_at: str(w.submitted_at),
      reviewed_at: str(w.reviewed_at),
      score: num(w.score),
      tasks,
      group: parseGroup(w.group),
    })
  }
  const serverNow = str(r.server_now) ?? new Date().toISOString()
  const mocks: AssessmentMock[] = []
  for (const x of Array.isArray(r.mocks) ? r.mocks : []) {
    const m = obj(x)
    if (!m || !str(m.id) || !str(m.starts_at)) continue
    mocks.push({
      id: m.id as string,
      title: str(m.title) ?? 'Пробник',
      starts_at: m.starts_at as string,
      ends_at: str(m.ends_at) ?? (m.starts_at as string),
      photos_until: str(m.photos_until) ?? str(m.ends_at) ?? (m.starts_at as string),
      duration_minutes: num(m.duration_minutes) ?? undefined,
      submitted_at: str(m.submitted_at),
      has_work: m.has_work === true,
      notified: m.notified === true,
      score: num(m.score),
      max_score: num(m.max_score),
      primary_score: num(m.primary_score),
      primary_max: num(m.primary_max),
      part1_score: num(m.part1_score),
      part2_score: num(m.part2_score),
      prev_score: num(m.prev_score),
      group: parseGroup(m.group),
      server_now: str(m.server_now) ?? serverNow,
    })
  }
  return { serverNow, works, mocks }
}

// ─── Состояние строки ───────────────────────────────────────────────────────

/**
 * Где работа по времени сейчас (для строки раздела):
 *  - `reviewed` — есть вердикт; `sent` — сдана, ждёт проверки;
 *  - `unscheduled` — окна нет; `before` — до открытия; `live` — идёт;
 *  - `missed` — окно закрылось, сданной работы нет.
 */
export type WorkPhase = 'unscheduled' | 'before' | 'live' | 'sent' | 'reviewed' | 'missed'

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

export function workPhase(w: Pick<AssessmentWork, 'status' | 'opens_at' | 'closes_at'>, nowMs: number): WorkPhase {
  if (w.status === 'reviewed') return 'reviewed'
  if (w.status === 'submitted' || w.status === 'auto_submitted') return 'sent'
  const o = ms(w.opens_at), c = ms(w.closes_at)
  if (o == null || c == null) return 'unscheduled'
  if (nowMs < o) return 'before'
  if (nowMs < c) return 'live'
  return 'missed'
}

export type BlockKey = 'mock' | 'control' | 'check'

export const BLOCK_ORDER: readonly BlockKey[] = ['mock', 'control', 'check']

export const BLOCK_TITLE: Record<BlockKey, string> = {
  mock: 'Пробники',
  control: 'Контрольные',
  check: 'Проверочные и самостоятельные',
}

/** Короткая плашка блока (как в макете). */
export const BLOCK_TAG: Record<BlockKey, string> = {
  mock: 'Пробники',
  control: 'КР',
  check: 'Провер.',
}

export type AssessmentItem =
  | { key: string; block: 'mock'; mock: AssessmentMock; phase: MockLessonStatus; date: string | null; live: boolean; hasResult: boolean }
  | { key: string; block: WorkKind; work: AssessmentWork; phase: WorkPhase; date: string | null; live: boolean; hasResult: boolean }

/** Все строки раздела с состоянием на момент `nowMs`. */
export function assessmentItems(data: MyAssessments, nowMs: number): AssessmentItem[] {
  const out: AssessmentItem[] = []
  for (const mock of data.mocks) {
    const phase = lessonStatus(mock, nowMs)
    out.push({
      key: `mock:${mock.id}`, block: 'mock', mock, phase, date: mock.starts_at,
      live: phase === 'open',
      hasResult: phase === 'result' && mock.score != null,
    })
  }
  for (const work of data.works) {
    const phase = workPhase(work, nowMs)
    out.push({
      key: `work:${work.topic_id}`, block: work.kind, work, phase, date: work.opens_at,
      live: phase === 'live',
      hasResult: phase === 'reviewed',
    })
  }
  return out
}

/** По дате, новые сверху; без даты — в конце, по названию. */
export function sortByDateDesc<T extends { date: string | null }>(items: readonly T[], title: (t: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ta = ms(a.date), tb = ms(b.date)
    if (ta == null && tb == null) return title(a).localeCompare(title(b), 'ru')
    if (ta == null) return 1
    if (tb == null) return -1
    return tb - ta || title(a).localeCompare(title(b), 'ru')
  })
}

export function itemTitle(i: AssessmentItem): string {
  return i.block === 'mock' ? i.mock.title : i.work.title
}

export interface AssessmentBlock {
  key: BlockKey
  title: string
  items: AssessmentItem[]
  summary: string
}

/** Блоки по типам в постоянном порядке; пустых блоков нет. */
export function assessmentBlocks(items: readonly AssessmentItem[], nowMs: number): AssessmentBlock[] {
  const out: AssessmentBlock[] = []
  for (const key of BLOCK_ORDER) {
    const list = sortByDateDesc(items.filter(i => i.block === key), itemTitle)
    if (list.length === 0) continue
    out.push({ key, title: BLOCK_TITLE[key], items: list, summary: blockSummary(key, list, nowMs) })
  }
  return out
}

/** Идущие сейчас — строкой над блоками. Первым — тот, что закроется раньше. */
export function liveItems(items: readonly AssessmentItem[]): AssessmentItem[] {
  const end = (i: AssessmentItem) => ms(i.block === 'mock' ? i.mock.ends_at : i.work.closes_at) ?? Infinity
  return items.filter(i => i.live).sort((a, b) => end(a) - end(b))
}

// ─── Слова и числа ──────────────────────────────────────────────────────────

const MSK = 'Europe/Moscow'

/** «4», «4,1» — одна цифра после запятой, без «,0». */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',')
}

function mskDateKey(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
}

/** Разница в календарных днях по Москве: 0 — сегодня, 1 — завтра, −1 — вчера. */
export function mskDayDiff(iso: string, nowMs: number): number | null {
  const t = ms(iso)
  if (t == null) return null
  const a = Date.parse(`${mskDateKey(t)}T00:00:00Z`)
  const b = Date.parse(`${mskDateKey(nowMs)}T00:00:00Z`)
  return Math.round((a - b) / 86400_000)
}

/** «26 сент» по Москве. */
export function mskShortDate(iso: string | null | undefined): string {
  const t = ms(iso)
  if (t == null) return '—'
  return new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, day: 'numeric', month: 'short' })
    .format(new Date(t)).replace(/\.$/, '')
}

/** «10:45» по Москве. */
export function mskHm(iso: string | null | undefined): string {
  const t = ms(iso)
  if (t == null) return '—'
  return new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t))
}

/** «пт» по Москве. */
export function mskWeekday(iso: string): string {
  const t = ms(iso)
  if (t == null) return ''
  return new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, weekday: 'short' }).format(new Date(t)).replace(/\.$/, '')
}

/** Столбец даты в строке: «сегодня», «завтра», «вчера» или «26 сент». */
export function dateColumn(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—'
  const d = mskDayDiff(iso, nowMs)
  if (d === 0) return 'сегодня'
  if (d === 1) return 'завтра'
  if (d === -1) return 'вчера'
  return mskShortDate(iso)
}

/** «через 3 дня», «завтра в 10:00», «сегодня в 10:00», «через 25 мин». */
export function untilLabel(iso: string, nowMs: number): string {
  const t = ms(iso)
  if (t == null) return ''
  const left = t - nowMs
  if (left <= 0) return 'сейчас'
  if (left < 3600_000) return `через ${formatSpan(left)}`
  const d = mskDayDiff(iso, nowMs) ?? 0
  if (d <= 0) return `сегодня в ${mskHm(iso)}`
  if (d === 1) return `завтра в ${mskHm(iso)}`
  return `через ${d} ${plural(d, 'день', 'дня', 'дней')}`
}

function durationWords(fromIso: string | null, toIso: string | null, minutes?: number): string {
  const m = minutes ?? (ms(toIso) != null && ms(fromIso) != null ? Math.round(((ms(toIso) as number) - (ms(fromIso) as number)) / 60000) : NaN)
  if (!Number.isFinite(m) || m <= 0) return ''
  const h = Math.floor(m / 60), r = m % 60
  return h === 0 ? `${r} мин` : r === 0 ? `${h} ч` : `${h} ч ${r} мин`
}

/** «лучший результат в группе» / «лучше 70 % группы» / null. */
export function groupStanding(g: GroupStats | null | undefined): string | null {
  if (!g) return null
  if (g.best) return 'лучший результат в группе'
  if (g.better_pct != null && g.better_pct > 0) return `лучше ${g.better_pct} % группы`
  return null
}

/** «+14 к прошлому» / «−3 к прошлому» / «как в прошлый раз». */
export function prevDelta(score: number | null | undefined, prev: number | null | undefined): string | null {
  if (score == null || prev == null) return null
  const d = score - prev
  if (d === 0) return 'как в прошлый раз'
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} к прошлому`
}

export interface TaskMarksSummary {
  total: number
  correct: number
  partial: number
  wrong: number
  unsolved: number
  unchecked: number
}

export function summarizeMarks(tasks: readonly AssessmentTaskMark[] | null | undefined): TaskMarksSummary | null {
  if (!tasks || tasks.length === 0) return null
  const s: TaskMarksSummary = { total: tasks.length, correct: 0, partial: 0, wrong: 0, unsolved: 0, unchecked: 0 }
  for (const t of tasks) s[t.verdict] += 1
  return s
}

/** «верно 4 из 6 · частично 1». */
export function marksLine(s: TaskMarksSummary | null): string | null {
  if (!s) return null
  const parts = [`верно ${s.correct} из ${s.total}`]
  if (s.partial > 0) parts.push(`частично ${s.partial}`)
  return parts.join(' · ')
}

/** Подпись под оценкой: у пятибалльной — «оценка», у стобалльной — «из 100». */
export function scoreCaption(scale: AssessmentWork['grade_scale']): string {
  return scale === 'hundred' ? 'из 100' : 'оценка'
}

export type Tone = 'ok' | 'part' | 'bad' | 'wait' | 'miss' | 'live' | 'muted'

/** Цвет оценки: 5 и 4 — зелёный, 3 — охра, ниже — красный; сотня — без цвета. */
export function scoreTone(score: number | null, scale: AssessmentWork['grade_scale']): Tone | undefined {
  if (score == null || scale !== 'five') return undefined
  return score >= 4 ? 'ok' : score === 3 ? 'part' : 'bad'
}

export interface RowView {
  date: string
  sub: string
  result:
    | { kind: 'score'; value: string; caption: string; tone?: Tone }
    | { kind: 'text'; text: string; tone: Tone }
}

/** Как выглядит строка: дата, подпись, результат справа. */
export function rowView(item: AssessmentItem, nowMs: number): RowView {
  if (item.block === 'mock') {
    const e = item.mock
    const date = dateColumn(e.starts_at, nowMs)
    switch (item.phase) {
      case 'upcoming': {
        const dur = durationWords(e.starts_at, e.ends_at, e.duration_minutes)
        return { date, sub: `${mskWeekday(e.starts_at)}, ${mskHm(e.starts_at)}${dur ? ` · ${dur}` : ''}`, result: { kind: 'text', text: untilLabel(e.starts_at, nowMs), tone: 'muted' } }
      }
      case 'open':
        return { date, sub: `${mskHm(e.starts_at)}–${mskHm(e.ends_at)} · осталось ${formatSpan((ms(e.ends_at) ?? nowMs) - nowMs)}`, result: { kind: 'text', text: 'идёт', tone: 'live' } }
      case 'submitted':
        return { date, sub: `сдан · фото — до ${mskHm(e.photos_until)}`, result: { kind: 'text', text: 'сдан', tone: 'muted' } }
      case 'time_up':
        return { date, sub: `бланк закрыт · фото — до ${mskHm(e.photos_until)}`, result: { kind: 'text', text: 'время вышло', tone: 'wait' } }
      case 'checking':
        return { date, sub: 'работа у преподавателя', result: { kind: 'text', text: 'ждёт проверки', tone: 'wait' } }
      case 'missed':
        return { date, sub: 'работы нет', result: { kind: 'text', text: 'не сдан', tone: 'miss' } }
      case 'result': {
        const parts: string[] = []
        if (e.primary_score != null) parts.push(`первичный ${e.primary_score}${e.primary_max != null ? ` из ${e.primary_max}` : ''}`)
        const st = groupStanding(e.group)
        if (st) parts.push(st)
        if (e.score == null) return { date, sub: parts.join(' · ') || 'результат отправлен', result: { kind: 'text', text: 'итог', tone: 'ok' } }
        return { date, sub: parts.join(' · ') || (e.max_score != null ? `из ${e.max_score}` : ''), result: { kind: 'score', value: String(e.score), caption: 'вторичный' } }
      }
    }
  }
  const w = item.work
  const date = dateColumn(w.opens_at, nowMs)
  const span = w.opens_at && w.closes_at ? `${mskHm(w.opens_at)}–${mskHm(w.closes_at)}` : ''
  const personal = w.personal ? ' · личное время' : ''
  switch (item.phase) {
    case 'unscheduled':
      return { date, sub: w.topic_open ? 'время ещё не назначено' : 'тема пока закрыта', result: { kind: 'text', text: 'время не назначено', tone: 'muted' } }
    case 'before':
      return { date, sub: `${mskWeekday(w.opens_at as string)}, ${span}${personal}`, result: { kind: 'text', text: untilLabel(w.opens_at as string, nowMs), tone: 'muted' } }
    case 'live':
      return { date, sub: `${span} · осталось ${formatSpan((ms(w.closes_at) ?? nowMs) - nowMs)}${personal}`, result: { kind: 'text', text: 'идёт', tone: 'live' } }
    case 'sent':
      return {
        date,
        sub: w.submitted_at ? `${w.status === 'auto_submitted' ? 'сдано автоматически' : 'сдано'} в ${mskHm(w.submitted_at)}` : 'сдано',
        result: { kind: 'text', text: 'ждёт проверки', tone: 'wait' },
      }
    case 'missed':
      return { date, sub: span ? `${span} · работы нет` : 'работы нет', result: { kind: 'text', text: 'не сдано', tone: 'miss' } }
    case 'reviewed': {
      const marks = marksLine(summarizeMarks(w.tasks))
      const st = groupStanding(w.group)
      const sub = [marks, st].filter(Boolean).join(' · ') || 'проверено'
      if (w.score == null) return { date, sub, result: { kind: 'text', text: 'проверено', tone: 'ok' } }
      return { date, sub, result: { kind: 'score', value: String(w.score), caption: scoreCaption(w.grade_scale), tone: scoreTone(w.score, w.grade_scale) } }
    }
  }
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Сводка в заголовке блока — до трёх частей. */
export function blockSummary(key: BlockKey, items: readonly AssessmentItem[], nowMs: number): string {
  const parts: string[] = []
  const live = items.filter(i => i.live).length
  if (live > 0) parts.push(`идёт ${live}`)
  const waiting = items.filter(i => i.phase === 'sent' || i.phase === 'checking').length
  if (key === 'mock') {
    const withScore = items
      .filter((i): i is Extract<AssessmentItem, { block: 'mock' }> => i.block === 'mock' && i.hasResult)
      .sort((a, b) => (ms(b.mock.starts_at) ?? 0) - (ms(a.mock.starts_at) ?? 0))
    const last = withScore[0]?.mock
    if (last?.score != null) parts.push(`последний ${last.score}`)
    if (last?.group?.avg != null) parts.push(`средний по группе ${formatNumber(last.group.avg)}`)
  } else {
    const works = items
      .filter((i): i is Extract<AssessmentItem, { block: WorkKind }> => i.block !== 'mock' && i.phase === 'reviewed')
      .map(i => i.work)
    const five = works.filter(w => w.grade_scale === 'five' && w.score != null)
    const hundred = works.filter(w => w.grade_scale === 'hundred' && w.score != null)
    if (five.length > 0) {
      parts.push(`средняя оценка ${formatNumber(mean(five.map(w => w.score as number)))}`)
      const groupAvg = mean(five.map(w => w.group?.avg).filter((x): x is number => x != null))
      if (groupAvg != null) parts.push(`группа ${formatNumber(groupAvg)}`)
    } else if (hundred.length > 0) {
      parts.push(`средний балл ${formatNumber(mean(hundred.map(w => w.score as number)))}`)
    }
  }
  if (waiting > 0) parts.push(`ждёт проверки ${waiting}`)
  if (parts.length === 0) {
    const next = items
      .map(i => i.date)
      .filter((d): d is string => !!d && (ms(d) ?? 0) > nowMs)
      .sort()[0]
    if (next) parts.push(`${key === 'mock' ? 'ближайший' : 'ближайшая'} ${mskShortDate(next)}`)
  }
  return parts.slice(0, 3).join(' · ')
}

// ─── График пробников ──────────────────────────────────────────────────────

export interface ChartPoint {
  id: string
  title: string
  date: string
  you: number
  /** Средний группы — только где правило троих выполнено. */
  group: number | null
}

/** Пробники со своим итогом, от старых к новым. */
export function mockChartPoints(mocks: readonly AssessmentMock[], nowMs: number): ChartPoint[] {
  return mocks
    .filter(m => lessonStatus(m, nowMs) === 'result' && m.score != null)
    .sort((a, b) => (ms(a.starts_at) ?? 0) - (ms(b.starts_at) ?? 0))
    .map(m => ({ id: m.id, title: m.title, date: mskShortDate(m.starts_at), you: m.score as number, group: m.group?.avg ?? null }))
}

/** Подпись графика для скринридера — с числами. */
export function chartAriaLabel(points: readonly ChartPoint[]): string {
  const you = points.map(p => `${p.title} (${p.date}) — ${p.you}`).join(', ')
  const grp = points.filter(p => p.group != null).map(p => `${p.title} — ${formatNumber(p.group)}`).join(', ')
  return `Вторичный балл по пробникам: ${you}${grp ? `; средний по группе: ${grp}` : ''}`
}

// ─── Ученик: без дублей в модулях ──────────────────────────────────────────

export function isAssessmentTopic(kind: unknown): boolean {
  return kind === 'check' || kind === 'control'
}

/**
 * У ученика работы по времени живут в разделе, а не в своих модулях. Модуль,
 * в котором после этого не осталось тем, скрыт (пустой изначально — нет: это
 * не наше решение). Счётчики модулей и курса НЕ пересчитываются — прогресс
 * (§141/§152/§162) не трогаем, меняется только список.
 */
export function withoutAssessmentTopics<M extends { topics: readonly { kind?: unknown }[] }>(modules: readonly M[]): M[] {
  const out: M[] = []
  for (const m of modules) {
    const kept = m.topics.filter(t => !isAssessmentTopic(t.kind))
    if (kept.length === m.topics.length) { out.push(m); continue }
    if (kept.length === 0) continue
    out.push({ ...m, topics: kept })
  }
  return out
}

// ─── Свёрнутые блоки (localStorage) ────────────────────────────────────────

export function collapsedKey(scope: string): string {
  return `course-assessments:collapsed:${scope}`
}

export function readCollapsed(storage: Pick<Storage, 'getItem'> | null | undefined, scope: string): Set<BlockKey> {
  try {
    const raw = storage?.getItem(collapsedKey(scope))
    const arr = raw ? JSON.parse(raw) : []
    return new Set((Array.isArray(arr) ? arr : []).filter((k): k is BlockKey => BLOCK_ORDER.includes(k as BlockKey)))
  } catch {
    return new Set()
  }
}

export function storeCollapsed(storage: Pick<Storage, 'setItem'> | null | undefined, scope: string, value: Set<BlockKey>): void {
  try {
    storage?.setItem(collapsedKey(scope), JSON.stringify([...value]))
  } catch {
    /* приватный режим — просто не запомнится */
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

// ─── Учитель: сводка по классу ─────────────────────────────────────────────

export type SummaryStatus = 'unscheduled' | 'planned' | 'live' | 'review' | 'done'

export interface SummaryWork {
  topic_id: string
  homework_id: string | null
  kind: WorkKind
  title: string
  module_title: string | null
  published: boolean
  opens_at: string | null
  closes_at: string | null
  grade_scale: 'five' | 'hundred' | null
  status: SummaryStatus
  submitted: number
  pending: number
  reviewed: number
  avg_score: number | null
  writing: number
  personal_live: number
}

export interface SummaryMock {
  id: string
  title: string
  template_id: string | null
  max_score: number | null
  starts_at: string | null
  ends_at: string | null
  status: SummaryStatus
  submitted: number
  pending: number
  avg_score: number | null
  writing: number
  in_group: number
}

export interface CourseAssessmentsSummary {
  serverNow: string
  isTemplate: boolean
  groupId: string | null
  groupName: string | null
  inClass: number
  works: SummaryWork[]
  mocks: SummaryMock[]
}

const SUMMARY_STATUSES: readonly SummaryStatus[] = ['unscheduled', 'planned', 'live', 'review', 'done']
function status(v: unknown): SummaryStatus {
  return SUMMARY_STATUSES.includes(v as SummaryStatus) ? v as SummaryStatus : 'unscheduled'
}

export function parseSummary(raw: unknown): CourseAssessmentsSummary | null {
  const r = obj(raw)
  if (!r) return null
  const works: SummaryWork[] = (Array.isArray(r.works) ? r.works : []).map(obj).filter((w): w is Record<string, unknown> => !!w && !!str(w.topic_id))
    .map(w => ({
      topic_id: w.topic_id as string,
      homework_id: str(w.homework_id),
      kind: w.kind === 'check' ? 'check' : 'control',
      title: str(w.title) ?? 'Без названия',
      module_title: str(w.module_title),
      published: w.published === true,
      opens_at: str(w.opens_at),
      closes_at: str(w.closes_at),
      grade_scale: w.grade_scale === 'five' || w.grade_scale === 'hundred' ? w.grade_scale : null,
      status: status(w.status),
      submitted: num(w.submitted) ?? 0,
      pending: num(w.pending) ?? 0,
      reviewed: num(w.reviewed) ?? 0,
      avg_score: num(w.avg_score),
      writing: num(w.writing) ?? 0,
      personal_live: num(w.personal_live) ?? 0,
    }))
  const mocks: SummaryMock[] = (Array.isArray(r.mocks) ? r.mocks : []).map(obj).filter((m): m is Record<string, unknown> => !!m && !!str(m.id))
    .map(m => ({
      id: m.id as string,
      title: str(m.title) ?? 'Пробник',
      template_id: str(m.template_id),
      max_score: num(m.max_score),
      starts_at: str(m.starts_at),
      ends_at: str(m.ends_at),
      status: status(m.status),
      submitted: num(m.submitted) ?? 0,
      pending: num(m.pending) ?? 0,
      avg_score: num(m.avg_score),
      writing: num(m.writing) ?? 0,
      in_group: num(m.in_group) ?? 0,
    }))
  return {
    serverNow: str(r.server_now) ?? new Date().toISOString(),
    isTemplate: r.is_template === true,
    groupId: str(r.group_id),
    groupName: str(r.group_name),
    inClass: num(r.in_class) ?? 0,
    works,
    mocks,
  }
}

export type TeacherAction =
  | { kind: 'queue'; label: string; topicId: string }
  | { kind: 'works'; label: string; topicId: string }
  | { kind: 'topic'; label: string; topicId: string }
  | { kind: 'mock'; label: string; to: string }

export interface TeacherRow {
  key: string
  block: BlockKey
  title: string
  module: string | null
  date: string | null
  when: string
  status: { text: string; tone: 'live' | 'soon' | 'check' | 'done' }
  note: string | null
  submitted: string
  avg: string
  actions: TeacherAction[]
}

export interface TeacherBlock {
  key: BlockKey
  title: string
  count: number
  summary: string
  rows: TeacherRow[]
}

function whenText(from: string | null, to: string | null, nowMs: number): string {
  if (!from) return 'время не назначено'
  const d = mskDayDiff(from, nowMs)
  const day = d === 0 ? 'сегодня' : d === 1 ? 'завтра' : `${mskWeekday(from)} ${mskShortDate(from)}`
  return `${day}, ${mskHm(from)}${to ? `–${mskHm(to)}` : ''}`
}

function workRow(w: SummaryWork, inClass: number, nowMs: number, template: boolean): TeacherRow {
  let st: TeacherRow['status']
  const actions: TeacherAction[] = []
  switch (w.status) {
    case 'unscheduled':
      st = { text: 'время не назначено', tone: 'soon' }
      actions.push({ kind: 'topic', label: 'Окно темы', topicId: w.topic_id })
      break
    case 'planned':
      st = { text: 'запланирована', tone: 'soon' }
      actions.push({ kind: 'topic', label: 'Окно темы', topicId: w.topic_id })
      break
    case 'live':
      st = { text: w.writing > 0 ? `идёт · пишут ${w.writing}` : 'идёт', tone: 'live' }
      actions.push({ kind: 'works', label: 'Кто пишет', topicId: w.topic_id })
      break
    case 'review':
      st = { text: `проверить ${w.pending}`, tone: 'check' }
      actions.push({ kind: 'queue', label: 'Проверка', topicId: w.topic_id })
      break
    default:
      st = w.submitted > 0 ? { text: 'проверена', tone: 'done' } : { text: 'никто не сдал', tone: 'soon' }
      actions.push({ kind: 'works', label: 'Работы', topicId: w.topic_id })
  }
  if (!w.published && w.status !== 'review') st = { text: 'не опубликована', tone: 'soon' }
  if (template) {
    return {
      key: `work:${w.topic_id}`, block: w.kind, title: w.title, module: w.module_title, date: null,
      when: '—', status: { text: 'окно — в классе', tone: 'soon' }, note: null, submitted: '—', avg: '—',
      actions: [{ kind: 'topic', label: 'Окно темы', topicId: w.topic_id }],
    }
  }
  const notes: string[] = []
  if (w.personal_live > 0) notes.push(`личное время у ${w.personal_live}`)
  if (w.status === 'live' && w.pending > 0) notes.push(`ждут проверки ${w.pending}`)
  return {
    key: `work:${w.topic_id}`,
    block: w.kind,
    title: w.title,
    module: w.module_title,
    date: w.opens_at,
    when: whenText(w.opens_at, w.closes_at, nowMs),
    status: st,
    note: notes.length ? notes.join(' · ') : null,
    submitted: w.status === 'planned' || w.status === 'unscheduled' ? '—' : `${w.submitted} из ${inClass}`,
    avg: w.avg_score == null ? '—' : formatNumber(w.avg_score),
    actions,
  }
}

function mockRow(m: SummaryMock, nowMs: number): TeacherRow {
  let st: TeacherRow['status']
  const actions: TeacherAction[] = []
  const setup: TeacherAction = { kind: 'mock', label: 'Настройка', to: `/mock-exams/${m.id}?tab=setup` }
  const table: TeacherAction = { kind: 'mock', label: 'Таблица', to: `/mock-exams/${m.id}?tab=table` }
  switch (m.status) {
    case 'unscheduled':
      st = { text: 'без времени', tone: 'soon' }
      actions.push(m.template_id ? table : setup)
      break
    case 'planned':
      st = { text: 'запланирован', tone: 'soon' }
      actions.push(setup)
      break
    case 'live':
      st = { text: m.writing > 0 ? `идёт · пишут ${m.writing}` : 'идёт', tone: 'live' }
      actions.push({ kind: 'mock', label: 'Кто пишет', to: `/mock-exams/${m.id}?tab=works` })
      break
    case 'review':
      st = { text: `проверить ${m.pending}`, tone: 'check' }
      actions.push(m.template_id ? table : setup)
      break
    default:
      st = m.submitted > 0 ? { text: 'проверен', tone: 'done' } : { text: 'никто не писал', tone: 'soon' }
      actions.push(m.template_id ? table : setup)
  }
  return {
    key: `mock:${m.id}`,
    block: 'mock',
    title: m.title,
    module: null,
    date: m.starts_at,
    when: m.starts_at ? whenText(m.starts_at, m.ends_at, nowMs) : 'время не назначено',
    status: st,
    note: null,
    submitted: m.status === 'planned' || (m.status === 'unscheduled' && m.submitted === 0) ? '—' : `${m.submitted} из ${m.in_group}`,
    avg: m.avg_score == null ? '—' : formatNumber(m.avg_score),
    actions,
  }
}

/** Таблица учителя: те же три блока, внутри — по дате, новые сверху. */
export function teacherBlocks(s: CourseAssessmentsSummary, nowMs: number): TeacherBlock[] {
  const rows: TeacherRow[] = [
    ...s.mocks.map(m => mockRow(m, nowMs)),
    ...s.works.map(w => workRow(w, s.inClass, nowMs, s.isTemplate)),
  ]
  const out: TeacherBlock[] = []
  for (const key of BLOCK_ORDER) {
    const list = sortByDateDesc(rows.filter(r => r.block === key), r => r.title)
    if (list.length === 0) continue
    let summary = ''
    if (!s.isTemplate) {
      if (key === 'mock') {
        const last = s.mocks
          .filter(m => m.avg_score != null && m.starts_at)
          .sort((a, b) => (ms(b.starts_at) ?? 0) - (ms(a.starts_at) ?? 0))[0]
        if (last) summary = `средний последнего ${formatNumber(last.avg_score)}`
      } else {
        const pending = s.works.filter(w => w.kind === key).reduce((n, w) => n + w.pending, 0)
        if (pending > 0) summary = `ждут проверки ${pending}`
      }
    }
    out.push({ key, title: BLOCK_TITLE[key], count: list.length, summary, rows: list })
  }
  return out
}
