/**
 * §244. Раскладка страницы «Курсы» у учителя: классы, программы, шаблоны,
 * прочие курсы и полоса «что требует внимания».
 *
 * Всё чистое: на входе список курсов (`useCourseProgram`) и цифры по курсам
 * (`teacher_courses_overview`, одна функция базы на экран), на выходе — что в
 * какой строке рисовать. Страница только рисует; правила здесь и в тестах
 * `src/lib/__tests__/coursesOverview.test.ts`.
 *
 * Словарь:
 *  - программа — шаблон (`is_template`), каркас курса;
 *  - класс — копии шаблонов с одинаковым коротким именем (`copyDisplayTitle`
 *    + `classKey`): «11А» на математике и на физике — один класс;
 *  - другие курсы — всё живое, что не шаблон и не копия живого шаблона;
 *  - архив — как раньше (`isArchived`): убранное осознанно, без родства.
 */
import { copyDisplayTitle } from '@/lib/courseDisplayName'
import { groupCoursesByTemplate, type GroupableCourse } from '@/lib/courseGrouping'
import { classKey, pickDisplayName } from '@/lib/classKey'
import { plural, pluralTopics } from '@/lib/plural'
import { EXAM_LABELS, SUBJECT_LABELS } from '@/utils/format'

// ─── Цифры по курсу ─────────────────────────────────────────────────────────

export interface OverviewCourse extends GroupableCourse {
  subject: string
  exam_type: string
  owner_id: string | null
}

/** Строка `teacher_courses_overview` в именах клиента. */
export interface CourseStat {
  courseId: string
  students: number
  studentIds: string[]
  topics: number
  openTopics: number
  modules: number
  pending: number
  subs7d: number
  /** 'YYYY-MM-DD' — ближайшее открытие темы по плану; null — плана нет. */
  nextOpen: string | null
  nextOpenCount: number
}

export type CourseStats = Record<string, CourseStat>

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/**
 * Ответ базы → словарь по курсу. Всё, что не похоже на строку функции,
 * отбрасывается молча: цифры на этой странице — подсказка, а не право, и
 * кривой ответ не должен ронять список курсов.
 */
export function normalizeOverview(data: unknown): CourseStats {
  const out: CourseStats = {}
  if (!Array.isArray(data)) return out
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.course_id !== 'string') continue
    const ids = Array.isArray(r.student_ids) ? r.student_ids.filter((x): x is string => typeof x === 'string') : []
    out[r.course_id] = {
      courseId: r.course_id,
      students: num(r.students),
      studentIds: ids,
      topics: num(r.topics),
      openTopics: num(r.open_topics),
      modules: num(r.modules),
      pending: num(r.pending),
      subs7d: num(r.subs_7d),
      nextOpen: typeof r.next_open === 'string' ? r.next_open.slice(0, 10) : null,
      nextOpenCount: num(r.next_open_count),
    }
  }
  return out
}

// ─── Программа: короткое имя, значок, цвет ──────────────────────────────────

export type SubjectTone = 'math' | 'physics' | 'other'

export interface ProgramInfo {
  /** «Математика · 1 часть», «Математика · 2 часть», «Физика». */
  name: string
  tone: SubjectTone
  /** Знак в значке: ∑ — математика, ∫ — её вторая часть, Φ — физика. */
  glyph: string
  part: number | null
}

const MATH_SUBJECTS = new Set(['math', 'algebra', 'geometry', 'probability_statistics'])

export function subjectTone(subject: string): SubjectTone {
  if (subject === 'physics') return 'physics'
  if (MATH_SUBJECTS.has(subject)) return 'math'
  return 'other'
}

const ORDINAL_PART: Record<string, number> = { перв: 1, втор: 2, трет: 3, четв: 4 }

/**
 * Номер части из названия: «1 часть», «1-я часть», «Часть 2», «Вторая часть».
 * Нет упоминания части — null.
 */
export function detectPart(title: string): number | null {
  const s = (title ?? '').toLocaleLowerCase('ru')
  const before = s.match(/(\d+)\s*(?:-?\s*[яй])?\s*част/)
  if (before) return Number(before[1])
  const after = s.match(/част[ьи]\s*№?\s*(\d+)/)
  if (after) return Number(after[1])
  const word = s.match(/(перв|втор|трет|четв)[а-я]*\s+част/)
  if (word) return ORDINAL_PART[word[1]]
  return null
}

/**
 * Короткое имя программы — ПРАВИЛО: название предмета (`SUBJECT_LABELS` по
 * `subject` курса, не по названию) и, если в названии курса есть часть, —
 * « · N часть». Экзамен, «джентльменский набор» и прочие хвосты названия в
 * короткое имя не идут: полное название — в карточке шаблона и подсказкой.
 * Совпадения коротких имён у разных шаблонов разводит `buildCoursesLayout`.
 */
export function programInfo(course: { title: string; subject: string }): ProgramInfo {
  const tone = subjectTone(course.subject)
  const label = SUBJECT_LABELS[course.subject] ?? (course.title || course.subject)
  const part = detectPart(course.title)
  const glyph = tone === 'physics' ? 'Φ'
    : tone === 'math' ? (part === 2 ? '∫' : '∑')
    : (label.trim()[0] ?? '·').toLocaleUpperCase('ru')
  return { name: part ? `${label} · ${part} часть` : label, tone, glyph, part }
}

/**
 * «<программы> здесь нет» — родительный падеж короткого имени: «2 части»,
 * «Физики», «Математики». Чего не умеем склонять — в кавычках как есть.
 */
export function programGenitive(p: ProgramInfo): string {
  if (p.part) return `${p.part} части`
  const name = p.name
  if (/^[А-Яа-яЁё]+$/.test(name)) {
    if (/[кгхжшчщ]а$/.test(name)) return name.slice(0, -1) + 'и'
    if (/ия$/.test(name)) return name.slice(0, -1) + 'и'
    if (/а$/.test(name)) return name.slice(0, -1) + 'ы'
  }
  return `«${name}»`
}

// ─── Раскладка ──────────────────────────────────────────────────────────────

export interface CourseCardData<T> {
  course: T
  stat: CourseStat | null
  program: ProgramInfo
  /** Короткое имя класса этого курса (для вида «По программам» и чипов шаблона). */
  className: string
}

export type ClassSlot<T> =
  | { kind: 'course'; card: CourseCardData<T> }
  | { kind: 'missing'; templateId: string; program: ProgramInfo }

export interface ClassRow<T> {
  key: string
  name: string
  slots: ClassSlot<T>[]
  courseCount: number
  /** Различные ученики по курсам строки; null — цифр нет (функция не ответила). */
  students: number | null
}

export interface ProgramRow<T> {
  template: T
  program: ProgramInfo
  stat: CourseStat | null
  cards: CourseCardData<T>[]
}

export interface OtherItem<T> {
  course: T
  stat: CourseStat | null
  program: ProgramInfo
}

export interface CoursesLayout<T> {
  classes: ClassRow<T>[]
  programs: ProgramRow<T>[]
  other: OtherItem<T>[]
  archived: T[]
}

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, 'ru', { numeric: true, sensitivity: 'base' })

/**
 * Раскладывает курсы по классам и программам.
 *
 *  - Программы (шаблоны) — по названию: так «1 часть» стоит перед «Второй
 *    частью», а математика перед физикой, и этот порядок — порядок карточек в
 *    строке класса.
 *  - Класс — копии живых шаблонов с одинаковым `classKey` короткого имени.
 *    Имя строки — самое частое написание (`pickDisplayName`).
 *  - Классы — по убыванию учеников (различных по курсам строки), при равенстве
 *    — по имени. Пока цифр нет — по имени.
 *  - Пунктирная плашка «… здесь нет» — только когда у класса хотя бы две
 *    программы и их больше, чем недостающих («2 из 3»). Считаются программы,
 *    у которых есть хоть один класс: шаблон, по которому никто не учится, не
 *    должен дырявить каждую строку.
 */
export function buildCoursesLayout<T extends OverviewCourse>(
  courses: T[],
  stats: CourseStats | null,
): CoursesLayout<T> {
  const grouped = groupCoursesByTemplate(courses)
  const statOf = (id: string) => stats?.[id] ?? null

  // Программы по порядку и их короткие имена без совпадений.
  const groups = [...grouped.groups].sort((a, b) => byTitle(a.template, b.template))
  const programs = new Map<string, ProgramInfo>()
  const base = groups.map(g => programInfo(g.template))
  const dup = (i: number, names: string[]) => names.filter(n => n === names[i]).length > 1
  const names1 = base.map(p => p.name)
  const names2 = base.map((p, i) => dup(i, names1)
    ? `${p.name} · ${EXAM_LABELS[groups[i].template.exam_type] ?? groups[i].template.exam_type}`
    : p.name)
  groups.forEach((g, i) => {
    programs.set(g.template.id, { ...base[i], name: dup(i, names2) ? g.template.title : names2[i] })
  })
  const templateOrder = new Map(groups.map((g, i) => [g.template.id, i]))

  // Классы.
  interface Draft { key: string; raw: string[]; cards: { card: CourseCardData<T>; templateId: string }[] }
  const drafts = new Map<string, Draft>()
  for (const g of groups) {
    for (const copy of g.copies) {
      const className = copyDisplayTitle(copy.title, g.template.title)
      const key = classKey(className)
      const d = drafts.get(key) ?? { key, raw: [], cards: [] }
      d.raw.push(className)
      d.cards.push({
        templateId: g.template.id,
        card: { course: copy, stat: statOf(copy.id), program: programs.get(g.template.id)!, className },
      })
      drafts.set(key, d)
    }
  }

  const usedTemplates = groups.filter(g => g.copies.length > 0).map(g => g.template.id)
  const levelOf = new Map(groups.map(g => [g.template.id, g.template.exam_type]))
  const classes: ClassRow<T>[] = [...drafts.values()].map(d => {
    const name = pickDisplayName(d.raw)
    for (const c of d.cards) c.card.className = name
    const cards = [...d.cards].sort((a, b) =>
      (templateOrder.get(a.templateId)! - templateOrder.get(b.templateId)!) || byTitle(a.card.course, b.card.course))

    const present = new Set(cards.map(c => c.templateId))
    // §244.1. Дыры — только среди программ того же уровня (exam_type), что и
    // курсы класса: у ЕГЭ-класса не должно быть плашки «Физика · 8 класс
    // здесь нет», а физика 8 класса не должна сдвигать карточки ЕГЭ.
    const levels = new Set([...present].map(id => levelOf.get(id)))
    const candidates = usedTemplates.filter(id => levels.has(levelOf.get(id)))
    const missing = candidates.filter(id => !present.has(id))
    const withGaps = present.size >= 2 && missing.length > 0 && missing.length < present.size
    const slots: ClassSlot<T>[] = withGaps
      ? candidates.flatMap((id): ClassSlot<T>[] => present.has(id)
        ? cards.filter(c => c.templateId === id).map(c => ({ kind: 'course' as const, card: c.card }))
        : [{ kind: 'missing' as const, templateId: id, program: programs.get(id)! }])
      : cards.map(c => ({ kind: 'course' as const, card: c.card }))

    let students: number | null = null
    if (stats) {
      const ids = new Set<string>()
      for (const c of cards) for (const s of c.card.stat?.studentIds ?? []) ids.add(s)
      students = ids.size
    }
    return { key: d.key, name, slots, courseCount: cards.length, students }
  })
  classes.sort((a, b) => ((b.students ?? -1) - (a.students ?? -1))
    || a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' }))

  const classIndex = new Map(classes.map((c, i) => [c.key, i]))
  const programRows: ProgramRow<T>[] = groups.map(g => ({
    template: g.template,
    program: programs.get(g.template.id)!,
    stat: statOf(g.template.id),
    cards: g.copies
      .map(copy => {
        const raw = copyDisplayTitle(copy.title, g.template.title)
        const row = classes[classIndex.get(classKey(raw))!]
        return { course: copy, stat: statOf(copy.id), program: programs.get(g.template.id)!, className: row?.name ?? raw }
      })
      .sort((a, b) => (classIndex.get(classKey(a.className))! - classIndex.get(classKey(b.className))!)
        || byTitle(a.course, b.course)),
  }))

  return {
    classes,
    programs: programRows,
    other: grouped.loose.map(c => ({ course: c, stat: statOf(c.id), program: programInfo(c) })),
    archived: grouped.archived,
  }
}

// ─── Полоса внимания ────────────────────────────────────────────────────────

export interface NextOpening {
  date: string
  courseId: string
  /** «11А, Математика · 2 часть» — для копии; название — для прочего курса. */
  label: string
  /** Сколько тем этого курса откроется в тот день. */
  count: number
  /** Сколько ещё курсов открывают темы в тот же день. */
  more: number
}

export interface Attention {
  pending: number
  pendingCourses: number
  subs7d: number
  next: NextOpening | null
}

/**
 * Три плитки сверху. Считаются живые курсы с учениками по смыслу — классы и
 * «другие» (шаблоны и архив — нет: учеников там нет или их больше не ведут).
 * Цифры — только по курсам, которые вернула функция, то есть где вызывающий —
 * персонал (`course_is_staff`). Нет цифр вовсе — полосы нет (null).
 * Нет плана ни у одного курса — `next` null, плитку не рисуем.
 */
export function buildAttention<T extends OverviewCourse>(
  layout: CoursesLayout<T>,
  stats: CourseStats | null,
): Attention | null {
  if (!stats) return null
  const live: { course: T; label: string }[] = [
    ...layout.classes.flatMap(r => r.slots.flatMap(s => s.kind === 'course'
      ? [{ course: s.card.course, label: `${r.name}, ${s.card.program.name}` }]
      : [])),
    ...layout.other.map(o => ({ course: o.course, label: o.course.title })),
  ]
  let pending = 0
  let pendingCourses = 0
  let subs7d = 0
  const planned: { date: string; courseId: string; label: string; count: number }[] = []
  for (const { course, label } of live) {
    const st = stats[course.id]
    if (!st) continue
    pending += st.pending
    if (st.pending > 0) pendingCourses++
    subs7d += st.subs7d
    if (st.nextOpen) planned.push({ date: st.nextOpen, courseId: course.id, label, count: st.nextOpenCount })
  }
  planned.sort((a, b) => a.date.localeCompare(b.date))
  const first = planned[0]
  const next = first
    ? { ...first, more: planned.filter(p => p.date === first.date).length - 1 }
    : null
  return { pending, pendingCourses, subs7d, next }
}

// ─── Подписи ────────────────────────────────────────────────────────────────

export type ChipTone = 'warn' | 'ok' | 'mute' | 'plan'
export interface Chip { text: string; tone: ChipTone }

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** «12 окт»; другой год — «12 янв 2027». Без Intl: одинаково в любом браузере и в тестах. */
export function formatDayMonth(iso: string, todayIso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const base = `${d} ${MONTHS[m - 1] ?? ''}`.trim()
  return todayIso.slice(0, 4) === String(y) ? base : `${base} ${y}`
}

export const studentsLabel = (n: number) =>
  n === 0 ? 'без учеников' : `${n} ${plural(n, 'ученик', 'ученика', 'учеников')}`
export const coursesLabel = (n: number) => `${n} ${plural(n, 'курс', 'курса', 'курсов')}`
export const modulesLabel = (n: number) => `${n} ${plural(n, 'модуль', 'модуля', 'модулей')}`
export const topicsLabel = (n: number) => pluralTopics(n)

/** Чипы карточки: проверка, сдачи за неделю, план. */
export function courseChips(stat: CourseStat, todayIso: string): Chip[] {
  const p = stat.pending
  const s = stat.subs7d
  return [
    p > 0
      ? { text: `${p} ${plural(p, 'ждёт', 'ждут', 'ждут')} проверки`, tone: 'warn' }
      : { text: 'нет работ на проверке', tone: 'mute' },
    { text: `${s} ${plural(s, 'сдача', 'сдачи', 'сдач')} за неделю`, tone: s > 0 ? 'ok' : 'mute' },
    stat.nextOpen
      ? { text: `далее ${formatDayMonth(stat.nextOpen, todayIso)}`, tone: 'plan' }
      : { text: 'плана нет', tone: 'mute' },
  ]
}

/** Подпись плитки «ждут проверки»: «работа ждёт» / «работы ждут» / «работ ждут». */
export function pendingTileLabel(a: Attention): string {
  const words = plural(a.pending, 'работа ждёт', 'работы ждут', 'работ ждут')
  return a.pending > 0 ? `${words} проверки · ${coursesLabel(a.pendingCourses)}` : `${words} проверки`
}

export function subsTileLabel(a: Attention): string {
  return `${plural(a.subs7d, 'сдача', 'сдачи', 'сдач')} за 7 дней по всем классам`
}

export function nextTileLabel(n: NextOpening): string {
  const topics = n.count > 1 ? ` (${pluralTopics(n.count)})` : ''
  const more = n.more > 0 ? ` и ещё ${coursesLabel(n.more)}` : ''
  return `следующее открытие по плану · ${n.label}${topics}${more}`
}

/** Подпись прочего курса: «2 ученика» или «физика · 1 тема · без учеников». */
export function otherCourseLabel(item: OtherItem<OverviewCourse>): string | null {
  const st = item.stat
  if (!st) return null
  if (st.students > 0) return studentsLabel(st.students)
  const subject = (SUBJECT_LABELS[item.course.subject] ?? item.course.subject).toLocaleLowerCase('ru')
  return `${subject} · ${topicsLabel(st.topics)} · без учеников`
}
