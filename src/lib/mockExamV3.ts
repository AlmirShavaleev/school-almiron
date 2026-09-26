/**
 * §228. Пробник v3 — одна сущность «как урок»: форма «Новый пробник», страница
 * пробника со статусом и вкладками, проверка работы по номерам, раздел
 * «Пробники» у ученика. Здесь — чистая логика этих экранов, без запросов.
 *
 * Правила, на которых всё стоит (макет `МАКЕТ-ПРОБНИК-V3.html`, карточка §228):
 *  - «проверено» — у ученика есть балл по КАЖДОМУ номеру; «частично» — есть,
 *    но не по всем. Отдельной колонки «проверено» в базе нет — это производное
 *    от `mock_exam_task_scores`, как и «авто» в §221;
 *  - первая часть, поставленная ключом, — ещё не проверка преподавателя:
 *    пока во второй части нет ни одного балла, работа «ждёт проверки»;
 *  - «Уведомить» одному — только когда все номера оценены; правило «тот же
 *    итог второй раз не уходит» — по-прежнему в базе (§219, `mockExamNotify`).
 */
import { canNotify, notifyState, type MockExamResultNotifyRow, type NotifyState, type NotifySummary } from '@/lib/mockExamNotify'
import { toTestScore } from '@/lib/mockExamGrid'
import { mskDayLong, mskTime, fromMskInput, toMskInput, START_NOTICE_GRACE_MS } from '@/lib/mockExamLesson'
import { livePhase, type LivePhase, type LiveStudentRow } from '@/lib/mockExamLive'
import { plural } from '@/lib/plural'
import type { VerdictMarkState } from '@/lib/verdictMark'

const MIN = 60_000
const HOUR = 60 * MIN

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/* ───────────────────────────── Окно пробника ───────────────────────────── */

export interface ExamWindow {
  starts_at: string | null
  ends_at: string | null
  photos_until: string | null
}

/** Окно из строки `mock_exams` — та же арифметика, что у `mock_exam_window` в базе. */
export function windowOf(e: { starts_at: string | null; duration_minutes?: number | null; photo_grace_minutes?: number | null }): ExamWindow {
  const s = ms(e.starts_at)
  if (s == null) return { starts_at: null, ends_at: null, photos_until: null }
  const ends = s + (e.duration_minutes ?? 240) * MIN
  return {
    starts_at: new Date(s).toISOString(),
    ends_at: new Date(ends).toISOString(),
    photos_until: new Date(ends + (e.photo_grace_minutes ?? 15) * MIN).toISOString(),
  }
}

/* ───────────────────────────── Работы учеников ─────────────────────────── */

export type WorkStatus =
  /** Пробник ещё не начался. */
  | 'not_started'
  /** Идёт окно, ученик на странице или открывал её, не сдал. */
  | 'writing'
  /** Идёт окно, страницу не открывал. */
  | 'not_opened'
  /** Работа есть, второй части не касались (первая могла пройти по ключу). */
  | 'waiting'
  /** Баллы есть, но не по всем номерам. */
  | 'partial'
  /** Балл по каждому номеру. */
  | 'checked'
  /** Окно закрыто, ничего не пришло. */
  | 'absent'
  /** Пробник без онлайн-окна, баллов нет. */
  | 'empty'

export interface WorkInput {
  id: string
  name: string
  profileId: string | null
  /** Сохранённые баллы по номерам; null — пусто. */
  points: (number | null)[]
  /** Клетка поставлена ключом и не правилась (points = auto_points). */
  auto?: boolean[]
  sheet: { answers: (string | null)[] | null; submitted_at: string | null } | null
  photos: number
  result?: MockExamResultNotifyRow | null
  /** Строка монитора §224 (во время окна), если есть. */
  live?: Pick<LiveStudentRow, 'online' | 'has_sheet'> | null
}

export interface WorkRow {
  id: string
  name: string
  profileId: string | null
  status: WorkStatus
  hasWork: boolean
  submittedAt: string | null
  photos: number
  /** Номера (с 1) без балла. */
  missing: number[]
  p1: { got: number; of: number } | null
  p2: { got: number; of: number } | null
  primary: number | null
  test: number | null
  notify: NotifyState
  /** «Уведомить» одному: все номера оценены и итог ещё не отправлен (или изменился). */
  canNotifyOne: boolean
}

export interface Tpl { max_points: number[]; part1_last: number; score_scale?: number[] | null }

export function hasWorkOf(w: Pick<WorkInput, 'sheet' | 'photos'>): boolean {
  if (w.photos > 0) return true
  if (!w.sheet) return false
  if (w.sheet.submitted_at) return true
  return (w.sheet.answers ?? []).some(a => (a ?? '').trim() !== '')
}

export function workRow(w: WorkInput, tpl: Tpl, phase: LivePhase | 'none'): WorkRow {
  const n = tpl.max_points.length
  const p1End = tpl.part1_last
  const pts = Array.from({ length: n }, (_, i) => w.points[i] ?? null)
  const missing = pts.flatMap((v, i) => (v == null ? [i + 1] : []))
  const scored = pts.some(v => v != null)
  const hasWork = hasWorkOf(w)
  const p2Touched = pts.slice(p1End).some(v => v != null)
  const manualP1 = pts.slice(0, p1End).some((v, i) => v != null && !(w.auto?.[i]))
  const sum = (a: number, b: number) => a + b
  const part = (from: number, to: number) => {
    const cells = pts.slice(from, to)
    if (!cells.some(v => v != null)) return null
    return {
      got: cells.reduce<number>((a, v, i) => a + Math.min(v ?? 0, tpl.max_points[from + i] ?? 0), 0),
      of: tpl.max_points.slice(from, to).reduce(sum, 0),
    }
  }
  const p1 = part(0, p1End)
  const p2 = p1End < n ? part(p1End, n) : null
  const primary = scored ? (p1?.got ?? 0) + (p2?.got ?? 0) : null

  let status: WorkStatus
  if (phase === 'upcoming') status = 'not_started'
  else if (phase === 'running' && !w.sheet?.submitted_at && missing.length > 0) {
    status = hasWork || w.live?.has_sheet || !!w.sheet ? 'writing' : 'not_opened'
  } else if (scored && missing.length === 0) status = 'checked'
  else if (scored && (p2Touched || manualP1)) status = 'partial'
  else if (hasWork || w.sheet?.submitted_at) status = 'waiting'
  else if (scored) status = 'partial'
  else status = phase === 'none' ? 'empty' : 'absent'

  const notify = notifyState(w.result)
  return {
    id: w.id, name: w.name, profileId: w.profileId, status, hasWork,
    submittedAt: w.sheet?.submitted_at ?? null, photos: w.photos, missing, p1, p2, primary,
    test: w.result?.score ?? (primary != null ? toTestScore(primary, tpl.score_scale) : null),
    notify,
    canNotifyOne: status === 'checked' && !!w.profileId && canNotify(notify),
  }
}

export function workRows(ws: WorkInput[], tpl: Tpl, win: ExamWindow | null, nowMs: number): WorkRow[] {
  const phase: LivePhase | 'none' = win?.starts_at ? livePhase(win, nowMs) : 'none'
  return ws.map(w => workRow(w, tpl, phase))
}

/** «№16», «№14, №16», «№13, №14, №15 …» — первые три. */
export function taskList(nums: number[], cap = 3): string {
  const head = nums.slice(0, cap).map(n => `№${n}`).join(', ')
  return nums.length > cap ? `${head} …` : head
}

export interface StatusLook { label: string; mark: VerdictMarkState; note?: string }

/** Метка статуса строки «Работы» — словом и формой `VerdictMark`. */
export function statusLook(r: WorkRow): StatusLook {
  switch (r.status) {
    case 'checked': return { label: 'проверено', mark: 'ok' }
    case 'partial': return { label: 'проверено частично', mark: 'part', note: `${taskList(r.missing)} не ${r.missing.length === 1 ? 'оценено' : 'оценены'}` }
    case 'waiting': return { label: 'ждёт проверки', mark: 'unk' }
    case 'writing': return { label: 'пишет сейчас', mark: 'none' }
    case 'not_opened': return { label: 'не заходил', mark: 'bad' }
    case 'absent': return { label: 'не писал', mark: 'bad' }
    case 'not_started': return { label: 'ещё не начался', mark: 'none' }
    case 'empty': return { label: 'баллов нет', mark: 'none' }
  }
}

/** «Зайцев Роман Петрович» → «Зайцев Р.» */
export function shortName(full: string): string {
  const [sur, first] = full.trim().split(/\s+/)
  if (!sur) return '—'
  return first ? `${sur} ${first[0].toUpperCase()}.` : sur
}

const NEEDS_CHECK: WorkStatus[] = ['waiting', 'partial']

/** Работы, которые можно открыть на проверку: есть работа или баллы. */
export function reviewable(rows: WorkRow[]): WorkRow[] {
  return rows.filter(r => r.status === 'waiting' || r.status === 'partial' || r.status === 'checked')
}

/**
 * «Следующая работа» — следующая НЕпроверенная по порядку списка «Работ»
 * после открытой; с конца — к пропущенным в начале; себя не предлагает.
 * Без открытой — первая непроверенная.
 */
export function nextToReview(rows: WorkRow[], currentId: string | null): WorkRow | null {
  const at = currentId ? rows.findIndex(r => r.id === currentId) : -1
  for (let k = 1; k <= rows.length; k++) {
    const r = rows[(at + k + rows.length) % rows.length]
    if (r.id !== currentId && NEEDS_CHECK.includes(r.status)) return r
  }
  return null
}

/** «работа 3 из 14» — среди тех, что можно проверять; нет в списке — null. */
export function reviewPosition(rows: WorkRow[], id: string): { n: number; of: number } | null {
  const list = reviewable(rows)
  const i = list.findIndex(r => r.id === id)
  return i < 0 ? null : { n: i + 1, of: list.length }
}

/** Кому уйдёт «Уведомить всех проверенных»: проверено и итог ещё не отправлен. */
export function notifyCheckedIds(rows: WorkRow[]): string[] {
  return rows.filter(r => r.canNotifyOne).map(r => r.id)
}

/* ─────────────────────────────── Статус пробника ─────────────────────── */

export type ExamStage = 'draft' | 'scheduled' | 'running' | 'checking' | 'sent'

export const STAGES: { key: ExamStage; label: string }[] = [
  { key: 'draft', label: 'Черновик' },
  { key: 'scheduled', label: 'Назначен' },
  { key: 'running', label: 'Идёт' },
  { key: 'checking', label: 'Проверка' },
  { key: 'sent', label: 'Результаты отправлены' },
]

/**
 * Где пробник: из окна (по часам базы), работ, баллов и `notified_*`.
 * «Идёт» — вместе с догрузкой фото: пока фото принимаются, проверять рано.
 * «Результаты отправлены» — у каждого, у кого есть работа или баллы, итог
 * отправлен и с тех пор не менялся.
 */
export function examStage(win: ExamWindow | null, rows: WorkRow[], nowMs: number): ExamStage {
  const s = ms(win?.starts_at)
  const p = ms(win?.photos_until)
  const graded = rows.filter(r => r.primary != null || r.hasWork)
  const allSent = graded.length > 0 && graded.every(r => r.notify.kind === 'sent')
  if (s == null || p == null) {
    if (!rows.some(r => r.primary != null)) return 'draft'
    return allSent ? 'sent' : 'checking'
  }
  if (nowMs < s) return 'scheduled'
  if (nowMs < p) return 'running'
  return allSent ? 'sent' : 'checking'
}

/**
 * Вывод одной строкой под заголовком («сначала вывод»). После окна —
 * «Сдали 14 из 16, проверено 9. Ждут проверки 5 работ. Не писали: …».
 */
export function worksSummary(stage: ExamStage, rows: WorkRow[], win: ExamWindow | null, groupName: string | null): string {
  const total = rows.length
  const group = groupName ? `группа ${groupName}` : 'группа'
  if (stage === 'draft') return `Черновик: ученики пробник не видят. Время начала назначается во вкладке «Настройка».`
  if (stage === 'scheduled') {
    return `Назначен на ${mskDayLong(win?.starts_at)}, ${mskTime(win?.starts_at)} (МСК) · ${group}, ${total} ${plural(total, 'ученик', 'ученика', 'учеников')}.`
  }
  const handed = rows.filter(r => r.hasWork).length
  const checked = rows.filter(r => r.status === 'checked').length
  const waiting = rows.filter(r => NEEDS_CHECK.includes(r.status)).length
  if (stage === 'running') {
    const writing = rows.filter(r => r.status === 'writing').length
    const submitted = rows.filter(r => r.submittedAt).length
    // «Онлайн ли прямо сейчас» знает только монитор (§224) — здесь то, что видно по бланкам.
    return `Идёт: сдали ${submitted} из ${total}, бланк открыли и ещё пишут ${writing}.`
  }
  const parts = [`Сдали ${handed} из ${total}, проверено ${checked}.`]
  if (waiting > 0) parts.push(`Ждут проверки ${waiting} ${plural(waiting, 'работа', 'работы', 'работ')}.`)
  const absent = rows.filter(r => r.status === 'absent')
  if (absent.length > 0) {
    const names = absent.slice(0, 4).map(r => shortName(r.name)).join(', ')
    const tail = absent.length > 4 ? ` и ещё ${absent.length - 4}` : ''
    const line = `Не ${absent.length === 1 ? 'писал' : 'писали'}: ${names}${tail}`
    // «Зайцев Р.» уже кончается точкой — второй не ставим.
    parts.push(line.endsWith('.') ? line : `${line}.`)
  }
  if (stage === 'sent') parts.push('Результаты отправлены.')
  else if (waiting === 0) {
    const pending = rows.filter(r => r.canNotifyOne).length
    if (pending > 0) parts.push(`Все работы проверены — осталось уведомить ${pending}.`)
  }
  return parts.join(' ')
}

/** Вкладка по умолчанию: после начала — «Работы»; черновик и назначенный — «Настройка». */
export type ExamTab = 'works' | 'table' | 'setup'
export function defaultTab(stage: ExamStage, hasWindow: boolean): ExamTab {
  if (!hasWindow) return stage === 'draft' ? 'setup' : 'table'
  return stage === 'draft' || stage === 'scheduled' ? 'setup' : 'works'
}

/* ───────────────────────────── Проверка работы ─────────────────────────── */

/** Метка номера по баллу: нет балла — «не сверено», 0 — неверно, максимум — верно, иначе частично. */
export function taskMark(points: number | null, max: number): VerdictMarkState {
  if (points == null) return 'unk'
  if (points <= 0) return 'bad'
  if (points >= max) return 'ok'
  return 'part'
}

export function markCounts(points: (number | null)[], maxPts: number[]): Record<VerdictMarkState, number> {
  const c: Record<VerdictMarkState, number> = { ok: 0, bad: 0, part: 0, unk: 0, none: 0 }
  maxPts.forEach((m, i) => { c[taskMark(points[i] ?? null, m)]++ })
  return c
}

/** «№16 ещё не оценено» / «№13, №16 ещё не оценены» / «все номера оценены». */
export function missingNote(points: (number | null)[], n: number): string {
  const miss = Array.from({ length: n }, (_, i) => i).filter(i => points[i] == null).map(i => i + 1)
  if (miss.length === 0) return 'все номера оценены'
  if (miss.length === n) return 'ни один номер не оценён'
  return `${taskList(miss)} ещё не ${miss.length === 1 ? 'оценено' : 'оценены'}`
}

export interface ReviewTotals { primary: number | null; test: number | null; of: number; complete: boolean }

export function reviewTotals(points: (number | null)[], tpl: Tpl): ReviewTotals {
  const of = tpl.max_points.reduce((a, b) => a + b, 0)
  const any = points.some(v => v != null)
  const primary = any ? points.reduce<number>((a, v, i) => a + Math.min(v ?? 0, tpl.max_points[i] ?? 0), 0) : null
  return {
    primary, of,
    test: toTestScore(primary, tpl.score_scale),
    complete: tpl.max_points.every((_, i) => points[i] != null),
  }
}

/** Клавиша → балл выбранному номеру: цифра не больше максимума, иначе null. */
export function keyToPoints(key: string, max: number): number | null {
  if (!/^\d$/.test(key)) return null
  const v = Number(key)
  return v <= max ? v : null
}

/* ─────────────────────────── Форма «Новый пробник» ────────────────────── */

/** Чипы длительности: 3 ч 55 мин (профиль ЕГЭ), 4 ч, своё. */
export const DURATION_PRESETS = [235, 240] as const

export function durationLabel(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} мин`
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
}

/** Дата и время по Москве из двух полей формы → ISO; неполное — null. */
export function mskMoment(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  return fromMskInput(`${date}T${time}`)
}

/** ISO → поля «Дата» и «Начало (МСК)». */
export function mskParts(iso: string | null | undefined): { date: string; time: string } {
  const v = toMskInput(iso)
  return v ? { date: v.slice(0, 10), time: v.slice(11, 16) } : { date: '', time: '' }
}

export interface TimelineItem {
  key: 'soon' | 'start' | 'end' | 'photos' | 'after'
  /** «09:00», «2 окт., 23:00» (если не в день начала), «потом». */
  at: string
  text: string
  /** Уже не случится (напоминание в прошлом) — показать тише и сказать почему. */
  skipped?: string
}

/**
 * Справа от формы — «Как увидят ученики 11А». Те же правила, что у триггера
 * напоминаний §224: «за час» — только если до начала больше часа; «Пробник
 * начался» — только если начало впереди (с запасом очереди, §224.2).
 */
export function studentTimeline(startsIso: string | null, durationMin: number, graceMin: number, nowMs: number): TimelineItem[] {
  const s = ms(startsIso)
  if (s == null) {
    return [
      { key: 'start', at: '—', text: 'Время начала не задано — черновик: ученики пробник не видят.' },
      { key: 'after', at: 'потом', text: 'Вы проверяете → ученик видит баллы, ключ и решение' },
    ]
  }
  const startDay = mskDayLong(new Date(s).toISOString())
  const at = (t: number) => {
    const iso = new Date(t).toISOString()
    return mskDayLong(iso) === startDay ? mskTime(iso) : `${mskDayLong(iso)}, ${mskTime(iso)}`
  }
  const ends = s + durationMin * MIN
  const photos = ends + graceMin * MIN
  const soonOk = s - nowMs > HOUR
  const startOk = s - nowMs >= START_NOTICE_GRACE_MS
  return [
    {
      key: 'soon', at: at(s - HOUR), text: 'Telegram: «Через час — пробник»',
      ...(soonOk ? {} : { skipped: 'не уйдёт — до начала меньше часа' }),
    },
    {
      key: 'start', at: at(s),
      text: startOk ? 'Открываются условие и бланк. Telegram: «Пробник начался»' : 'Открываются условие и бланк',
      ...(startOk ? {} : { skipped: 'Telegram «Пробник начался» не уйдёт — время уже наступило' }),
    },
    { key: 'end', at: at(ends), text: 'Бланк закрывается' },
    { key: 'photos', at: at(photos), text: 'Последний срок догрузить фото' },
    { key: 'after', at: 'потом', text: 'Вы проверяете → ученик видит баллы, ключ и решение' },
  ]
}

export interface ReadyItem { state: 'ok' | 'todo' | 'later'; text: string }

/** Чек-лист готовности под таймлайном. Решение — «можно позже», не ошибка. */
export function readiness(o: {
  groups: number
  startsIso: string | null
  hasCondition: boolean
  hasSolution: boolean
  keyFilled: number
  keyTotal: number
}): ReadyItem[] {
  return [
    o.groups > 0 ? { state: 'ok', text: o.groups === 1 ? 'Группа выбрана' : `Групп: ${o.groups} — будет ${o.groups} ${plural(o.groups, 'пробник', 'пробника', 'пробников')}` } : { state: 'todo', text: 'Группа не выбрана' },
    o.startsIso ? { state: 'ok', text: 'Время начала задано' } : { state: 'todo', text: 'Время начала не задано' },
    o.hasCondition ? { state: 'ok', text: 'Условие загружено' } : { state: 'todo', text: 'Условие не загружено' },
    o.keyTotal === 0 ? { state: 'later', text: 'Ключ — после выбора шаблона' }
      : o.keyFilled === o.keyTotal ? { state: 'ok', text: `Ключ: ${o.keyFilled} из ${o.keyTotal}` }
        : o.keyFilled > 0 ? { state: 'ok', text: `Ключ: ${o.keyFilled} из ${o.keyTotal} — пустые проверите вручную` }
          : { state: 'later', text: `Ключ не внесён — первую часть проверите вручную` },
    o.hasSolution ? { state: 'ok', text: 'Решение загружено' } : { state: 'later', text: 'Решение — можно добавить позже' },
  ]
}

/** Что мешает «Назначить» (пустой список — можно). Черновику время не нужно. */
export function assignProblems(o: { title: string; templateId: string; groups: number; startsIso: string | null; draft: boolean; durationOk: boolean }): string[] {
  const out: string[] = []
  if (!o.title.trim()) out.push('Нужно название')
  if (!o.templateId) out.push('Нужен шаблон — по нему строится бланк и таблица баллов')
  if (o.groups === 0) out.push('Выберите группу')
  if (!o.durationOk) out.push('Длительность — от 10 до 720 минут')
  if (!o.draft && !o.startsIso) out.push('Нужны дата и время начала')
  return out
}

/* ─────────────────────────── Ученик: «Пробники» ───────────────────────── */

/**
 * «+8» к прошлому пробнику той же группы с видимым итогом; первого нет — null.
 * `past` — прошедшие по возрастанию начала.
 */
export function deltaToPrevious<E extends { id: string; group: string; starts_at: string; score?: number | null }>(list: E[], id: string): number | null {
  const me = list.find(e => e.id === id)
  if (!me || me.score == null) return null
  const prev = list
    .filter(e => e.group === me.group && e.id !== id && e.score != null && e.starts_at < me.starts_at)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0]
  return prev ? (me.score as number) - (prev.score as number) : null
}

/** «через 6 дней», «через 3 ч», «через 40 мин». */
export function untilLabel(leftMs: number): string {
  const days = Math.floor(leftMs / (24 * HOUR))
  if (days >= 1) return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`
  const h = Math.floor(leftMs / HOUR)
  if (h >= 1) return `через ${h} ч`
  return `через ${Math.max(1, Math.ceil(leftMs / MIN))} мин`
}

/** Что сказать после отправки — по ответу базы. */
export function sentLine(r: NotifySummary | null, name: string | null): string {
  if (!r) return 'Отправлено.'
  if (r.sent === 0) {
    if (r.already > 0) return name ? `${name}: этот итог уже отправлен — повторно не ушло.` : 'Никому не ушло: всем проверенным итог уже отправлен.'
    if (r.no_result > 0) return 'Не отправлено: у ученика нет сохранённого итога.'
    if (r.no_profile > 0) return 'Не отправлено: у ученика нет учётной записи.'
    return 'Отправлять некому.'
  }
  const who = name ? `${name}: результат отправлен.` : `Отправлено ${r.sent} ${plural(r.sent, 'ученику', 'ученикам', 'ученикам')}.`
  const tg = r.telegram > 0 ? ` В Telegram — ${r.telegram} из ${r.sent}.` : ' Telegram не подключён — только на сайте.'
  return who + tg
}
