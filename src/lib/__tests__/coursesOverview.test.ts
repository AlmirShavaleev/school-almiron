import { describe, expect, it } from 'vitest'
import {
  buildAttention, buildCoursesLayout, courseChips, detectPart, formatDayMonth, nextTileLabel,
  normalizeOverview, otherCourseLabel, pendingTileLabel, programGenitive, programInfo, subsTileLabel,
  type CourseStat, type CourseStats, type OverviewCourse,
} from '@/lib/coursesOverview'

/**
 * §244. Раскладка страницы «Курсы»: классы, программы, прочее, полоса внимания
 * и подписи. Данные — как на проде у владельца: три шаблона, классы 11А и 10А,
 * группа индивидуальных учеников под двумя написаниями.
 */

const course = (over: Partial<OverviewCourse> & { id: string; title: string }): OverviewCourse => ({
  subject: 'math', exam_type: 'ege', owner_id: 'me',
  is_active: true, is_draft: false, is_template: false, copied_from_course_id: null,
  ...over,
})

const M1 = course({ id: 'm1', title: 'Математика ЕГЭ. 1 часть + джентльменский набор', is_template: true })
const M2 = course({ id: 'm2', title: 'Математика ЕГЭ. Вторая часть', is_template: true })
const PH = course({ id: 'ph', title: 'Физика ЕГЭ', subject: 'physics', is_template: true })

const COURSES: OverviewCourse[] = [
  M1, M2, PH,
  course({ id: 'm1-11', title: 'Математика ЕГЭ. 1 часть + джентльменский набор — 11А', copied_from_course_id: 'm1' }),
  course({ id: 'm1-10', title: 'Математика ЕГЭ. 1 часть + джентльменский набор 10А', copied_from_course_id: 'm1' }),
  course({ id: 'm1-ind', title: 'Математика ЕГЭ. 1 часть + джентльменский набор 2026-2027 Ученики', copied_from_course_id: 'm1' }),
  course({ id: 'm2-11', title: 'Математика ЕГЭ. Вторая часть 11А', copied_from_course_id: 'm2', is_draft: true, is_active: false }),
  course({ id: 'm2-ind', title: 'Математика ЕГЭ. Вторая часть Ученики 2026–2027', copied_from_course_id: 'm2' }),
  course({ id: 'ph-11', title: 'Физика ЕГЭ 11А', subject: 'physics', copied_from_course_id: 'ph' }),
  course({ id: 'ph-10', title: 'Физика ЕГЭ 10А класс', subject: 'physics', copied_from_course_id: 'ph' }),
  course({ id: 'ph-ind', title: 'Физика ЕГЭ Ученики 2026-2027', subject: 'physics', copied_from_course_id: 'ph' }),
  course({ id: 'loose', title: '10А', subject: 'physics' }),
  course({ id: 'sand', title: 'Песочница — пробник (тест)' }),
  course({ id: 'old', title: 'Физика ЕГЭ 2025', subject: 'physics', copied_from_course_id: 'ph', is_active: false }),
]

const stat = (courseId: string, over: Partial<CourseStat> = {}): CourseStat => ({
  courseId, students: 0, studentIds: [], topics: 0, openTopics: 0, modules: 0,
  pending: 0, subs7d: 0, nextOpen: null, nextOpenCount: 0, ...over,
})
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

// 11А: 24 ученика на 1 части, 14 из них на 2 части, 11 на физике (все — из тех же 24).
// 10А: 8 на 1 части, 16 на физике, из них 7 общих ⇒ 17 различных.
// Индивидуальные: 2 + 1 + 3, все разные ⇒ 6.
const STATS: CourseStats = {
  m1: stat('m1', { topics: 86, modules: 16 }),
  m2: stat('m2', { topics: 131, modules: 6 }),
  ph: stat('ph', { topics: 170, modules: 7, nextOpen: '2026-10-01' }),
  'm1-11': stat('m1-11', { students: 24, studentIds: ids('a', 24), topics: 86, openTopics: 58, pending: 16, subs7d: 49, nextOpen: '2026-11-09', nextOpenCount: 1 }),
  'm2-11': stat('m2-11', { students: 14, studentIds: ids('a', 14), topics: 131, openTopics: 23, nextOpen: '2026-10-12', nextOpenCount: 2 }),
  'ph-11': stat('ph-11', { students: 11, studentIds: ids('a', 11), topics: 170, openTopics: 60, pending: 1, subs7d: 5, nextOpen: '2026-10-26' }),
  'm1-10': stat('m1-10', { students: 8, studentIds: ids('b', 8), topics: 86, openTopics: 17, subs7d: 1 }),
  'ph-10': stat('ph-10', { students: 16, studentIds: [...ids('b', 7), ...ids('c', 9)], topics: 172, openTopics: 9, pending: 7, subs7d: 33 }),
  'm1-ind': stat('m1-ind', { students: 2, studentIds: ['i1', 'i2'], topics: 86, openTopics: 19, subs7d: 1 }),
  'm2-ind': stat('m2-ind', { students: 1, studentIds: ['i3'], topics: 131, openTopics: 14 }),
  'ph-ind': stat('ph-ind', { students: 3, studentIds: ['i4', 'i5', 'i6'], topics: 170, openTopics: 16, pending: 2, subs7d: 2 }),
  loose: stat('loose', { topics: 1 }),
  sand: stat('sand', { students: 2, studentIds: ['s1', 's2'], pending: 3, nextOpen: '2026-10-12', nextOpenCount: 1 }),
  old: stat('old', { students: 30, pending: 5, subs7d: 9, nextOpen: '2026-10-02' }),
}

const names = (rows: { name: string }[]) => rows.map(r => r.name)
const slotTitles = (row: ReturnType<typeof buildCoursesLayout<OverviewCourse>>['classes'][number]) =>
  row.slots.map(s => (s.kind === 'course' ? s.card.program.name : `нет: ${s.program.name}`))

describe('короткое имя программы', () => {
  it('предмет по subject и часть из названия', () => {
    expect(programInfo(M1).name).toBe('Математика · 1 часть')
    expect(programInfo(M2).name).toBe('Математика · 2 часть')
    expect(programInfo(PH).name).toBe('Физика')
  })

  it('часть узнаётся в разных написаниях', () => {
    expect(detectPart('ЕГЭ 1-я часть')).toBe(1)
    expect(detectPart('Часть 2')).toBe(2)
    expect(detectPart('Вторая часть')).toBe(2)
    expect(detectPart('Первая часть и джентльменский набор')).toBe(1)
    expect(detectPart('Физика ЕГЭ 2027')).toBeNull()
  })

  it('значок и цвет: математика — синяя (∑, вторая часть ∫), физика — фиолетовая Φ', () => {
    expect(programInfo(M1)).toMatchObject({ tone: 'math', glyph: '∑' })
    expect(programInfo(M2)).toMatchObject({ tone: 'math', glyph: '∫' })
    expect(programInfo(PH)).toMatchObject({ tone: 'physics', glyph: 'Φ' })
  })

  it('родительный падеж для плашки «… здесь нет»', () => {
    expect(programGenitive(programInfo(M2))).toBe('2 части')
    expect(programGenitive(programInfo(PH))).toBe('Физики')
    expect(programGenitive(programInfo(course({ id: 'x', title: 'x', subject: 'math' })))).toBe('Математики')
  })

  it('совпадающие короткие имена разных шаблонов разводятся экзаменом', () => {
    const layout = buildCoursesLayout([
      course({ id: 'e', title: 'Физика ЕГЭ', subject: 'physics', is_template: true }),
      course({ id: 'o', title: 'Физика ОГЭ', subject: 'physics', exam_type: 'oge', is_template: true }),
    ], null)
    expect(layout.programs.map(p => p.program.name)).toEqual(['Физика · ЕГЭ', 'Физика · ОГЭ'])
  })
})

describe('вид «По классам»', () => {
  const layout = buildCoursesLayout(COURSES, STATS)

  it('копии разных шаблонов с одним коротким именем — один класс; написание не важно', () => {
    expect(names(layout.classes)).toEqual(['11А', '10А', '2026-2027 Ученики'])
    const ind = layout.classes[2]
    expect(ind.courseCount).toBe(3)
  })

  it('классы — по убыванию различных учеников; ученик на двух курсах класса считается один раз', () => {
    expect(layout.classes.map(c => c.students)).toEqual([24, 17, 6])
  })

  it('внутри строки — фиксированный порядок программ: 1 часть, 2 часть, физика', () => {
    expect(slotTitles(layout.classes[0])).toEqual(['Математика · 1 часть', 'Математика · 2 часть', 'Физика'])
  })

  it('два курса из трёх — на месте недостающего пунктирная плашка', () => {
    expect(slotTitles(layout.classes[1])).toEqual(['Математика · 1 часть', 'нет: Математика · 2 часть', 'Физика'])
  })

  it('один курс из трёх — без плашек', () => {
    const l = buildCoursesLayout([M1, M2, PH,
      course({ id: 'a', title: 'Физика ЕГЭ 9Б', subject: 'physics', copied_from_course_id: 'ph' }),
      course({ id: 'b', title: 'Математика ЕГЭ. Вторая часть 11А', copied_from_course_id: 'm2' }),
      course({ id: 'c', title: 'Физика ЕГЭ 11А', subject: 'physics', copied_from_course_id: 'ph' }),
    ], null)
    const nineB = l.classes.find(c => c.name === '9Б')!
    expect(nineB.slots.map(s => s.kind)).toEqual(['course'])
  })

  it('шаблон, по которому ещё никто не учится, не дырявит строки классов', () => {
    const l = buildCoursesLayout([...COURSES, course({ id: 'new', title: 'Информатика ЕГЭ', subject: 'informatics', is_template: true })], STATS)
    expect(slotTitles(l.classes[1])).toEqual(['Математика · 1 часть', 'нет: Математика · 2 часть', 'Физика'])
  })

  it('черновик-копия остаётся в своём классе (не в архиве)', () => {
    const ids11 = layout.classes[0].slots.flatMap(s => (s.kind === 'course' ? [s.card.course.id] : []))
    expect(ids11).toContain('m2-11')
    expect(layout.archived.map(c => c.id)).toEqual(['old'])
  })

  it('без цифр классы идут по имени и без числа учеников', () => {
    const l = buildCoursesLayout(COURSES, null)
    expect(names(l.classes)).toEqual(['10А', '11А', '2026-2027 Ученики'])
    expect(l.classes.every(c => c.students === null)).toBe(true)
  })

  it('пустой список — пустая раскладка', () => {
    expect(buildCoursesLayout([], null)).toEqual({ classes: [], programs: [], other: [], archived: [] })
  })
})

describe('вид «По программам»', () => {
  const layout = buildCoursesLayout(COURSES, STATS)

  it('строка — шаблон, по порядку названий; карточки — его классы в порядке классов', () => {
    expect(layout.programs.map(p => p.program.name)).toEqual(['Математика · 1 часть', 'Математика · 2 часть', 'Физика'])
    expect(layout.programs[0].cards.map(c => c.className)).toEqual(['11А', '10А', '2026-2027 Ученики'])
    expect(layout.programs[1].cards.map(c => c.className)).toEqual(['11А', '2026-2027 Ученики'])
  })

  it('имя класса в карточке — общее для строки класса, а не своё написание копии', () => {
    // У 2 части копия называется «Ученики 2026–2027», но класс один.
    expect(layout.programs[1].cards[1].course.id).toBe('m2-ind')
    expect(layout.programs[1].cards[1].className).toBe('2026-2027 Ученики')
  })

  it('архивная копия не попадает в классы шаблона', () => {
    expect(layout.programs[2].cards.map(c => c.course.id)).not.toContain('old')
  })
})

describe('другие курсы', () => {
  const layout = buildCoursesLayout(COURSES, STATS)

  it('не шаблоны и не копии — отдельной строкой', () => {
    expect(layout.other.map(o => o.course.id)).toEqual(['loose', 'sand'])
  })

  it('подпись: без учеников — предмет и темы, с учениками — число учеников', () => {
    expect(otherCourseLabel(layout.other[0])).toBe('физика · 1 тема · без учеников')
    expect(otherCourseLabel(layout.other[1])).toBe('2 ученика')
  })
})

describe('полоса внимания', () => {
  const layout = buildCoursesLayout(COURSES, STATS)
  const a = buildAttention(layout, STATS)!

  it('ждут проверки и сдачи — сумма по классам и прочим, без шаблонов и архива', () => {
    // 16 + 1 + 7 + 2 + 3 (песочница); архив «old» (5) — нет.
    expect(a.pending).toBe(29)
    expect(a.pendingCourses).toBe(5)
    expect(a.subs7d).toBe(49 + 5 + 1 + 33 + 1 + 2)
    expect(pendingTileLabel(a)).toBe('работ ждут проверки · 5 курсов')
    // 91 — «сдача», как «21 сдача».
    expect(subsTileLabel(a)).toBe('сдача за 7 дней по всем классам')
  })

  it('следующее открытие — ближайшая дата среди классов; шаблон и архив не в счёт', () => {
    // У шаблона физики 1 окт, у архива 2 окт — их не видно ученикам.
    expect(a.next).toMatchObject({ date: '2026-10-12', courseId: 'm2-11', label: '11А, Математика · 2 часть', count: 2, more: 1 })
    expect(nextTileLabel(a.next!)).toBe('следующее открытие по плану · 11А, Математика · 2 часть (2 темы) и ещё 1 курс')
  })

  it('плана нет ни у кого — плитки открытия нет', () => {
    const noPlan = Object.fromEntries(Object.entries(STATS).map(([k, v]) => [k, { ...v, nextOpen: null }]))
    expect(buildAttention(buildCoursesLayout(COURSES, noPlan), noPlan)!.next).toBeNull()
  })

  it('нет цифр — нет полосы', () => {
    expect(buildAttention(layout, null)).toBeNull()
  })

  it('склонения плиток: 1 работа ждёт, 2 работы ждут', () => {
    const one = buildAttention(buildCoursesLayout([COURSES[12]], { sand: stat('sand', { pending: 1, subs7d: 1 }) }), { sand: stat('sand', { pending: 1, subs7d: 1 }) })!
    expect(pendingTileLabel(one)).toBe('работа ждёт проверки · 1 курс')
    expect(subsTileLabel(one)).toBe('сдача за 7 дней по всем классам')
    const two = { pending: 2, pendingCourses: 2, subs7d: 3, next: null }
    expect(pendingTileLabel(two)).toBe('работы ждут проверки · 2 курса')
    expect(subsTileLabel(two)).toBe('сдачи за 7 дней по всем классам')
    expect(pendingTileLabel({ ...two, pending: 0, pendingCourses: 0 })).toBe('работ ждут проверки')
  })
})

describe('чипы карточки', () => {
  const today = '2026-09-29'
  const chips = (over: Partial<CourseStat>) => courseChips(stat('x', over), today).map(c => `${c.tone}:${c.text}`)

  it('ноль', () => {
    expect(chips({})).toEqual(['mute:нет работ на проверке', 'mute:0 сдач за неделю', 'mute:плана нет'])
  })

  it('один', () => {
    expect(chips({ pending: 1, subs7d: 1, nextOpen: '2026-10-12' }))
      .toEqual(['warn:1 ждёт проверки', 'ok:1 сдача за неделю', 'plan:далее 12 окт'])
  })

  it('много (и 21 — снова «ждёт», «сдача»)', () => {
    expect(chips({ pending: 16, subs7d: 49 })).toEqual(['warn:16 ждут проверки', 'ok:49 сдач за неделю', 'mute:плана нет'])
    expect(chips({ pending: 3, subs7d: 33 })).toEqual(['warn:3 ждут проверки', 'ok:33 сдачи за неделю', 'mute:плана нет'])
    expect(chips({ pending: 21, subs7d: 21 })).toEqual(['warn:21 ждёт проверки', 'ok:21 сдача за неделю', 'mute:плана нет'])
  })

  it('дата: в этом году без года, в другом — с годом', () => {
    expect(formatDayMonth('2026-11-09', today)).toBe('9 ноя')
    expect(formatDayMonth('2027-01-12', today)).toBe('12 янв 2027')
  })
})

describe('ответ базы', () => {
  it('строки функции переименовываются; мусор отбрасывается', () => {
    const s = normalizeOverview([
      { course_id: 'c1', students: 2, student_ids: ['a', 'b'], topics: 8, open_topics: 4, modules: 2, pending: 4, subs_7d: 5, next_open: '2026-10-04', next_open_count: 2 },
      { course_id: 42 }, null, 'x',
    ])
    expect(Object.keys(s)).toEqual(['c1'])
    expect(s.c1).toEqual({ courseId: 'c1', students: 2, studentIds: ['a', 'b'], topics: 8, openTopics: 4, modules: 2, pending: 4, subs7d: 5, nextOpen: '2026-10-04', nextOpenCount: 2 })
  })

  it('не массив — пусто', () => {
    expect(normalizeOverview(null)).toEqual({})
    expect(normalizeOverview({ error: 'x' })).toEqual({})
  })
})

describe('§244.1: плашки «здесь нет» только внутри одного уровня', () => {
  it('программа 8 класса не дырявит ЕГЭ-классы и не сдвигает их карточки', () => {
    const PH8 = course({ id: 'ph8', title: 'Физика 8 класс', subject: 'physics', exam_type: 'grade_8', is_template: true })
    const all = [
      ...COURSES,
      PH8,
      course({ id: 'ph8-a', title: 'Физика 8А класс', subject: 'physics', exam_type: 'grade_8', copied_from_course_id: 'ph8' }),
    ]
    const layout = buildCoursesLayout(all, STATS)
    for (const row of layout.classes) {
      const missing = row.slots.filter(s => s.kind === 'missing').map(s => s.kind === 'missing' ? s.program.name : '')
      expect(missing.some(n => n.includes('8 класс'))).toBe(false)
    }
    const ind = layout.classes.find(r => r.name.includes('2026'))!
    expect(ind.slots.every(s => s.kind === 'course')).toBe(true)
    const eighth = layout.classes.find(r => r.name.includes('8А'))!
    expect(eighth.slots).toHaveLength(1)
    expect(eighth.slots[0].kind).toBe('course')
  })
})
