/**
 * §224. Монитор идущего пробника у преподавателя — чистая логика экрана.
 *
 * «Онлайн» считает база (`mock_exam_live`: пинг не старше 75 с при открытом
 * окне), экран только раскладывает учеников по состояниям и пишет вывод
 * словами. Время — от `server_now` базы (смещение часов устройства
 * вычитается), как у ученика в §221.
 */
import { mskDayLong, mskTime } from '@/lib/mockExamLesson'

/** Ученик в ответе `mock_exam_live`. */
export interface LiveStudentRow {
  student_id: string
  name: string
  has_sheet: boolean
  opened_at: string | null
  last_seen_at: string | null
  online: boolean
  /** Сколько полей бланка заполнено; null — неизвестно (запасной путь без RPC). */
  answered: number | null
  submitted_at: string | null
  photos: number
}

/** Ответ `mock_exam_live`. Ключа и ответов здесь нет. */
export interface MockExamLive {
  id: string
  title: string
  group_id: string | null
  starts_at: string | null
  ends_at: string | null
  photos_until: string | null
  server_now: string
  part1_last: number | null
  students: LiveStudentRow[]
}

export type LivePhase = 'upcoming' | 'running' | 'photos' | 'ended'

export interface LiveWindow { starts_at: string | null; ends_at: string | null; photos_until: string | null }

export function livePhase(w: LiveWindow, nowMs: number): LivePhase {
  const s = ms(w.starts_at)
  const e = ms(w.ends_at)
  const p = ms(w.photos_until)
  if (s == null || e == null || p == null) return 'ended'
  if (nowMs < s) return 'upcoming'
  if (nowMs < e) return 'running'
  if (nowMs < p) return 'photos'
  return 'ended'
}

/** Опрашивать базу ещё нужно: окно не закрылось и 15 минут догрузки фото не прошли. */
export function shouldPoll(w: LiveWindow, nowMs: number): boolean {
  const p = ms(w.photos_until)
  return p != null && nowMs < p
}

/** «2 ч 13 мин», «45 мин», «2 ч». Округление вверх до минуты: «0 мин» не бывает, пока окно открыто. */
export function formatSpan(leftMs: number): string {
  const mins = Math.max(1, Math.ceil(leftMs / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} мин`
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
}

/** Строка-вывод над таблицей: что с пробником сейчас. */
export function liveHeadline(w: LiveWindow, nowMs: number): string {
  const phase = livePhase(w, nowMs)
  switch (phase) {
    case 'upcoming':
      return `Начнётся ${mskDayLong(w.starts_at)} в ${mskTime(w.starts_at)} · через ${formatSpan((ms(w.starts_at) ?? nowMs) - nowMs)}`
    case 'running':
      return `Идёт · осталось ${formatSpan((ms(w.ends_at) ?? nowMs) - nowMs)} · до ${mskTime(w.ends_at)}`
    case 'photos':
      return `Закончился в ${mskTime(w.ends_at)} · фото до ${mskTime(w.photos_until)}`
    case 'ended':
      return w.starts_at
        ? `Закончился · ${mskDayLong(w.starts_at)}, ${mskTime(w.starts_at)}–${mskTime(w.ends_at)}`
        : 'Закончился'
  }
}

export type LiveKind =
  /** Строки бланка нет — страницу пробника не открывал. */
  | 'absent'
  /** Открывал, сейчас не на странице, не сдал. */
  | 'away'
  /** На странице прямо сейчас (база: пинг не старше 75 с), не сдал. */
  | 'online'
  | 'submitted'

export interface LiveRow extends LiveStudentRow {
  kind: LiveKind
  /** Метка словами: «Не заходил», «Пишет · онлайн», «Был в 12:41», «Сдал в 13:20». */
  label: string
  /** Тон метки: problem — красная с иконкой, warn — жёлтая, ok/live/idle — спокойные. */
  tone: 'problem' | 'warn' | 'live' | 'ok' | 'idle'
}

const ORDER: Record<LiveKind, number> = { absent: 0, away: 1, online: 2, submitted: 3 }

export function liveKind(s: LiveStudentRow): LiveKind {
  if (s.submitted_at) return 'submitted'
  if (!s.has_sheet) return 'absent'
  return s.online ? 'online' : 'away'
}

/**
 * Ученики по состояниям: не заходили → открывали и ушли → пишут → сдали;
 * внутри — по алфавиту. Проблемные сверху: их видно без прокрутки.
 */
export function liveRows(students: LiveStudentRow[], phase: LivePhase): LiveRow[] {
  const rows = students.map(s => {
    const kind = liveKind(s)
    return { ...s, kind, ...labelFor(s, kind, phase) }
  })
  rows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name, 'ru'))
  return rows
}

function labelFor(s: LiveStudentRow, kind: LiveKind, phase: LivePhase): { label: string; tone: LiveRow['tone'] } {
  const started = phase !== 'upcoming'
  switch (kind) {
    case 'submitted':
      return { label: `Сдал в ${mskTime(s.submitted_at)}`, tone: 'ok' }
    case 'online':
      return { label: 'Пишет · онлайн', tone: 'live' }
    case 'away': {
      const seen = s.last_seen_at ?? s.opened_at
      const was = seen ? `Был в ${mskTime(seen)}` : 'Открывал'
      return phase === 'running'
        ? { label: was, tone: 'warn' }
        : { label: `${was} · не сдал`, tone: 'warn' }
    }
    case 'absent':
      return started ? { label: 'Не заходил', tone: 'problem' } : { label: 'Ещё не начался', tone: 'idle' }
  }
}

export interface LiveCounts {
  total: number
  online: number
  submitted: number
  away: number
  absent: number
}

export function liveCounts(rows: { kind: LiveKind }[]): LiveCounts {
  const c: LiveCounts = { total: rows.length, online: 0, submitted: 0, away: 0, absent: 0 }
  for (const r of rows) c[r.kind]++
  return c
}

/**
 * Одна строка счётчиков словами, с числом группы. Пока идёт — «пишут
 * сейчас»; после конца «пишут» не бывает, и «открывали» становится «не
 * сдали». До начала — только сколько в группе.
 */
export function liveCountsLine(c: LiveCounts, phase: LivePhase): string {
  const group = `В группе ${c.total}`
  if (phase === 'upcoming') return group
  const parts = [group]
  if (phase === 'running') {
    parts.push(`пишут сейчас ${c.online}`, `сдали ${c.submitted}`, `открывали, сейчас не на сайте ${c.away}`)
  } else {
    parts.push(`сдали ${c.submitted}`, `открывали, не нажали «Сдать» ${c.away + c.online}`)
  }
  parts.push(`не заходили ${c.absent}`)
  return parts.join(' · ')
}

/** «бланк 8 из 12»; неизвестно — пусто. */
export function sheetLabel(answered: number | null, part1: number | null): string {
  if (answered == null || !part1) return ''
  return `бланк ${answered} из ${part1}`
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}
