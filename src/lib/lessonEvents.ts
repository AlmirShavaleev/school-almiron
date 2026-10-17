/**
 * Модалка «Урок пройден / открыт следующий» (письмо ЛК_стиль_модалка_открыт_урок.md,
 * 16.10; макет MNVKGAgPBCcKz86H5tXZnk). Четыре ситуации:
 *  1. next    — урок пройден, открыт следующий (или ближайший открытый в разделе);
 *  2. wait    — урок пройден, открытых несданных в разделе нет, следующий закрыт;
 *  3. opened  — открылись новые уроки (первый вход после даты открытия);
 *  4. section — пройден последний урок раздела.
 *
 * «Урок засчитан» — ДЗ сдано или принято (то же «пройдено», что в «Моих
 * курсах» и плитках). Уроки без ДЗ в «пройдено» не входят: самоотметки из
 * интерфейса убраны (15.10).
 *
 * Один раз на событие: снимок «засчитано / открыто» по ученику и курсу живёт в
 * localStorage; событие — разница с прошлым снимком, после показа снимок
 * обновляется. Первый заход в курс — только запоминаем. Подходящего места на
 * сервере нет, базу не трогаем (письмо).
 */
import { isTopicOpen, todayLocal } from '@/lib/topicAvailability'
import { lessonTile, lockLine, type ScreenModule, type ScreenTopic } from '@/lib/courseScreen'
import { plural } from '@/lib/plural'

export interface Snapshot { done: string[]; open: string[] }

export interface EventLesson { id: string; n: number; title: string; foot: string; locked: boolean; moduleTitle: string }

export type LessonEvent =
  | { kind: 'next'; passed: { n: number; title: string }; next: EventLesson }
  | { kind: 'wait'; passed: { n: number; title: string }; next: EventLesson; when: string | null }
  | { kind: 'opened'; moduleTitle: string; lessons: EventLesson[]; nextDate: string | null }
  | { kind: 'section'; moduleTitle: string; count: number; next: EventLesson | null; nextModuleTitle: string | null }

const counted = (t: ScreenTopic) => !!t.hw_id || t.hw_status != null
export const isDone = (t: ScreenTopic) => t.hw_status === 'submitted' || t.hw_status === 'accepted'

export function snapshotOf(modules: readonly ScreenModule[], today: string = todayLocal()): Snapshot {
  const all = modules.flatMap(m => m.topics)
  return {
    done: all.filter(isDone).map(t => t.id),
    open: all.filter(t => isTopicOpen(t, today)).map(t => t.id),
  }
}

function lessonOf(m: ScreenModule, t: ScreenTopic, today: string): EventLesson {
  const no = new Map(m.topics.map((x, i) => [x.id, i + 1]))
  const tile = lessonTile(t, today, Date.now(), no)
  return { id: t.id, n: no.get(t.id) ?? 1, title: t.title, foot: tile.pill, locked: tile.state === 'locked', moduleTitle: m.title }
}

/** Какое событие показать (или null) по прошлому и текущему снимку. */
export function detectEvent(prev: Snapshot | null, modules: readonly ScreenModule[], today: string = todayLocal()): LessonEvent | null {
  if (!prev) return null
  const had = new Set(prev.done)
  const wasOpen = new Set(prev.open)

  // Последний (по порядку курса) впервые засчитанный урок.
  let last: { m: ScreenModule; mi: number; t: ScreenTopic; ti: number } | null = null
  modules.forEach((m, mi) => m.topics.forEach((t, ti) => {
    if (isDone(t) && !had.has(t.id)) last = { m, mi, t, ti }
  }))

  if (last) {
    const { m, mi, t, ti } = last as { m: ScreenModule; mi: number; t: ScreenTopic; ti: number }
    const passed = { n: ti + 1, title: t.title }
    const rest = m.topics.filter(counted)
    // ДЗ закрытых уроков ученику не видно (RLS): раздел пройден, только когда
    // в нём не осталось закрытых уроков и все уроки с ДЗ засчитаны.
    if (rest.length > 0 && rest.every(isDone) && m.topics.every(x => isTopicOpen(x, today))) {
      const nm = modules.slice(mi + 1).find(x => x.topics.length > 0) ?? null
      return {
        kind: 'section', moduleTitle: m.title, count: rest.length,
        next: nm ? lessonOf(nm, nm.topics[0], today) : null, nextModuleTitle: nm?.title ?? null,
      }
    }
    // Следующий открытый урок после пройденного (и без ДЗ — как в макете), иначе
    // любой открытый с несданным ДЗ в разделе; иначе — закрытый следующий.
    const after = m.topics.slice(ti + 1)
    const open = after.find(x => isTopicOpen(x, today) && !isDone(x))
      ?? m.topics.find(x => isTopicOpen(x, today) && counted(x) && !isDone(x))
    if (open) return { kind: 'next', passed, next: lessonOf(m, open, today) }
    const locked = after.find(x => !isTopicOpen(x, today)) ?? m.topics.find(x => !isTopicOpen(x, today))
    if (locked) {
      const no = new Map(m.topics.map((x, i) => [x.id, i + 1]))
      const l = lockLine(locked, today, no)
      // «Урок откроется в понедельник, …» / «Откроется в понедельник, … — или раньше…» → «в понедельник».
      const when = /^(?:Урок о|О)ткроется (в [^,]+|завтра)/.exec(l.tip)?.[1] ?? null
      return { kind: 'wait', passed, next: lessonOf(m, locked, today), when }
    }
    return null
  }

  const opened: EventLesson[] = []
  for (const m of modules) for (const t of m.topics) {
    if (isTopicOpen(t, today) && !wasOpen.has(t.id)) opened.push(lessonOf(m, t, today))
  }
  if (opened.length === 0) return null
  const firstModule = modules.find(m => m.topics.some(t => t.id === opened[0].id))!
  const future = firstModule.topics
    .filter(t => !isTopicOpen(t, today))
    .map(t => lockLine(t, today).short)
    .find(s => s.startsWith('🔒 откроется '))
  return {
    kind: 'opened', moduleTitle: firstModule.title, lessons: opened,
    nextDate: future ? future.slice('🔒 откроется '.length) : null,
  }
}

/** Номера уроков: «уроки 6–10» для подряд идущих, иначе «уроки 6, 8, 9». */
export function lessonNumbers(ns: readonly number[]): string {
  const s = [...ns].sort((a, b) => a - b)
  if (s.length === 1) return `урок ${s[0]}`
  const contiguous = s.every((n, i) => i === 0 || n === s[i - 1] + 1)
  return contiguous ? `уроки ${s[0]}–${s[s.length - 1]}` : `уроки ${s.join(', ')}`
}

/** «Открылся 1 новый урок» / «Открылись 5 новых уроков». */
export function openedTitle(k: number): string {
  return `${plural(k, 'Открылся', 'Открылись', 'Открылись')} ${k} ${plural(k, 'новый урок', 'новых урока', 'новых уроков')}`
}

// ── хранение «показано» ─────────────────────────────────────────────────────
const KEY = (who: string, courseId: string) => `lesson-events:${who}:${courseId}`

export function readSnapshot(who: string, courseId: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY(who, courseId))
    const v = raw ? JSON.parse(raw) : null
    return v && Array.isArray(v.done) && Array.isArray(v.open) ? v : null
  } catch { return null }
}

export function writeSnapshot(who: string, courseId: string, s: Snapshot): void {
  try { localStorage.setItem(KEY(who, courseId), JSON.stringify(s)) } catch { /* хранилище недоступно — без модалки */ }
}

/** Взять событие и сразу запомнить текущее состояние: второй раз то же не покажется. */
export function takeLessonEvent(who: string, courseId: string, modules: readonly ScreenModule[], today: string = todayLocal()): LessonEvent | null {
  const cur = snapshotOf(modules, today)
  const ev = detectEvent(readSnapshot(who, courseId), modules, today)
  writeSnapshot(who, courseId, cur)
  return ev
}

