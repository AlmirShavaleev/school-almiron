/**
 * §233. Главная преподавателя: правила экрана на границах.
 * «Просели» (8 работ, 15 п. п., пробник −10), фраза баннера, «Напомнить всем»,
 * «На проверке» (просрочка — тем же `isSubmittedLate`, что очередь).
 */
import { describe, expect, it } from 'vitest'
import {
  bannerPhrase, dayLabel, detectDrop, dropRows, homeworkReviewGroups, mockReviewGroups, normalizeHome,
  overdueWhen, remindLabel, remindNote, remindPlan, reviewGroups, upcomingHref, upcomingText,
  type OverdueRow, type SeriesRow,
} from '@/lib/teacherHome'
import type { QueueRow } from '@/lib/homeworkQueue'

const series = (hw: number[], mocks: SeriesRow['mocks'] = []): SeriesRow => ({
  student_id: 's1', student_name: 'Валиев Карим', course_id: 'c1', group_name: '11А', hw, mocks,
})

describe('«Просели» — правило А: 3 последних против 5 до них', () => {
  it('падение ровно на 15 п. п. — просел; подпись как в макете; столбики: прошлые светлые, 3 последние красные', () => {
    const r = detectDrop(series([80, 80, 80, 80, 80, 65, 65, 65]))
    expect(r).not.toBeNull()
    expect(r!.text).toBe('было 80 % по 5 работам, стало 65 % по 3 последним')
    expect(r!.bars.map(b => b.recent)).toEqual([false, false, false, false, false, true, true, true])
    expect(r!.bars[0].height).toBe(80)
  })

  it('падение на 14,9 п. п. — не просел', () => {
    // до: 80, после: 65,1 (65,1 · 3 = 195,3)
    expect(detectDrop(series([80, 80, 80, 80, 80, 65.1, 65.1, 65.1]))).toBeNull()
  })

  it('дробные проценты, дающие ровно 15 в сумме, не теряются на погрешности', () => {
    // до: (66,67 + 66,66 + 66,67 + 66,67 + 66,66) / 5 = 66,666; после: 51,666
    expect(detectDrop(series([66.67, 66.66, 66.67, 66.67, 66.66, 51.666, 51.666, 51.666]))).not.toBeNull()
  })

  it('7 работ — данных мало, ученика в блоке нет, как бы он ни упал', () => {
    expect(detectDrop(series([100, 100, 100, 100, 10, 10, 10]))).toBeNull()
  })

  it('рост и ровная линия — не просел', () => {
    expect(detectDrop(series([50, 50, 50, 50, 50, 90, 90, 90]))).toBeNull()
    expect(detectDrop(series([70, 70, 70, 70, 70, 70, 70, 70]))).toBeNull()
  })

  it('берутся 8 последних: старые работы до них не влияют', () => {
    // первые две (100, 100) вне окна; в окне 60×5 → 45×3 — ровно 15
    expect(detectDrop(series([100, 100, 60, 60, 60, 60, 60, 45, 45, 45]))?.text)
      .toBe('было 60 % по 5 работам, стало 45 % по 3 последним')
  })
})

describe('«Просели» — правило Б: последний пробник ниже предыдущего', () => {
  const m = (score: number, unit: 'test' | 'primary' = 'test') => ({ score, unit })

  it('минус ровно 10 тестовых — просел; «пробник: 70 → 60 тестовых баллов»', () => {
    const r = detectDrop(series([], [m(66), m(70), m(60)]))
    expect(r?.text).toBe('пробник: 70 → 60 тестовых баллов')
    expect(r?.bars.map(b => b.recent)).toEqual([false, true, true])
  })

  it('минус 9 — не просел', () => {
    expect(detectDrop(series([], [m(70), m(61)]))).toBeNull()
  })

  it('склонение по последнему числу: 61 тестовый балл, 32 → 22 первичных балла', () => {
    expect(detectDrop(series([], [m(71), m(61)]))?.text).toBe('пробник: 71 → 61 тестовый балл')
    expect(detectDrop(series([], [m(32, 'primary'), m(22, 'primary')]))?.text).toBe('пробник: 32 → 22 первичных балла')
  })

  it('разные шкалы (первичный и тестовый) не сравниваются', () => {
    expect(detectDrop(series([], [m(70, 'test'), m(20, 'primary')]))).toBeNull()
  })

  it('один пробник — данных мало', () => {
    expect(detectDrop(series([], [m(10)]))).toBeNull()
  })

  it('оба правила — одна строка с обеими причинами, столбики — ряд ДЗ', () => {
    const r = detectDrop(series([81, 81, 81, 81, 81, 54, 54, 54], [m(70), m(58)]))
    expect(r?.text).toBe('было 81 % по 5 работам, стало 54 % по 3 последним · пробник: 70 → 58 тестовых баллов')
    expect(r?.bars).toHaveLength(8)
  })

  it('порядок строк — кто сильнее просел, выше', () => {
    const a = { ...series([80, 80, 80, 80, 80, 60, 60, 60]), student_id: 'a', student_name: 'А' }
    const b = { ...series([90, 90, 90, 90, 90, 40, 40, 40]), student_id: 'b', student_name: 'Б' }
    expect(dropRows([a, b]).map(r => r.studentId)).toEqual(['b', 'a'])
  })
})

const od = (o: Partial<OverdueRow>): OverdueRow => ({
  homework_id: 'h13', topic_id: 't13', course_id: 'c1', group_id: 'g1', group_name: '11А', title: 'Отбор корней',
  student_id: 's1', student_name: 'Сафин Данияр', due_date: '2026-09-24', telegram: 'ok', reminded_at: null, ...o,
})

describe('Фраза баннера', () => {
  it('как в макете: работы, просрочка, должники одного ДЗ, просевшие', () => {
    const overdue = ['s1', 's2', 's3', 's4'].map(s => od({ student_id: s }))
    expect(bannerPhrase({ pending: 39, late: 5, overdue, dropped: 2 }))
      .toBe('39 работ ждут проверки, 5 из них просрочены. Четверо не сдали ДЗ «Отбор корней». Двое просели на последних работах.')
  })

  it('пусто — спокойно', () => {
    expect(bannerPhrase({ pending: 0, late: 0, overdue: [], dropped: 0 })).toBe('Всё проверено. Никто не просрочил.')
  })

  it('окончания: 1 работа, 21 работа, 2 работы; одна просрочена; все просрочены', () => {
    expect(bannerPhrase({ pending: 1, late: 0, overdue: [], dropped: 0 })).toBe('1 работа ждёт проверки. Никто не просрочил.')
    expect(bannerPhrase({ pending: 21, late: 1, overdue: [], dropped: 0 })).toMatch(/^21 работа ждёт проверки, 1 из них просрочена\./)
    expect(bannerPhrase({ pending: 2, late: 2, overdue: [], dropped: 0 })).toMatch(/^2 работы ждут проверки, все просрочены\./)
    expect(bannerPhrase({ pending: 1, late: 1, overdue: [], dropped: 0 })).toMatch(/^1 работа ждёт проверки, она просрочена\./)
  })

  it('должники: один ученик по двум ДЗ — «Один ученик не сдал ДЗ к сроку»; 12 и 21 — числом', () => {
    expect(bannerPhrase({ pending: 0, late: 0, overdue: [od({}), od({ homework_id: 'h2', title: 'Векторы' })], dropped: 0 }))
      .toBe('Всё проверено. Один ученик не сдал ДЗ к сроку.')
    const many = (n: number) => Array.from({ length: n }, (_, i) => od({ student_id: `s${i}` }))
    expect(bannerPhrase({ pending: 0, late: 0, overdue: many(12), dropped: 0 })).toBe('Всё проверено. 12 учеников не сдали ДЗ «Отбор корней».')
    expect(bannerPhrase({ pending: 0, late: 0, overdue: many(21), dropped: 0 })).toBe('Всё проверено. 21 ученик не сдал ДЗ «Отбор корней».')
  })

  it('просевший один — «Один ученик просел»', () => {
    expect(bannerPhrase({ pending: 0, late: 0, overdue: [], dropped: 1 }))
      .toBe('Всё проверено. Никто не просрочил. Один ученик просел на последних работах.')
  })
})

describe('«Не сдали к сроку» и «Напомнить всем»', () => {
  it('«вчера» / «срок прошёл 2 дня назад» / «5 дней» / «21 день» — от «сегодня» базы', () => {
    expect(overdueWhen('2026-09-25', '2026-09-26')).toBe('вчера')
    expect(overdueWhen('2026-09-24', '2026-09-26')).toBe('срок прошёл 2 дня назад')
    expect(overdueWhen('2026-09-21', '2026-09-26')).toBe('срок прошёл 5 дней назад')
    expect(overdueWhen('2026-08-31', '2026-09-21')).toBe('срок прошёл 21 день назад')
    // через конец месяца
    expect(overdueWhen('2026-09-30', '2026-10-02')).toBe('срок прошёл 2 дня назад')
  })

  it('подпись кнопки — собирательным числительным', () => {
    expect(remindLabel(4)).toBe('Напомнить всем четверым')
    expect(remindLabel(2)).toBe('Напомнить всем двоим')
    expect(remindLabel(12)).toBe('Напомнить всем 12')
    expect(remindLabel(1)).toBe('Напомнить')
  })

  it('без Telegram не считается: «3 из 4 — нет Telegram: Никитина В.»', () => {
    const rows = [
      od({ student_id: 's1', student_name: 'Сафин Данияр' }),
      od({ student_id: 's2', student_name: 'Ахмадуллин Рустем' }),
      od({ student_id: 's3', student_name: 'Зиннатуллин Артур' }),
      od({ student_id: 's4', student_name: 'Никитина Вера', telegram: 'none', homework_id: 'h2', title: 'Векторы' }),
    ]
    const plan = remindPlan(rows)
    expect(plan.toSend).toBe(3)
    expect(remindLabel(plan.toSend)).toBe('Напомнить всем троим')
    expect(remindNote(plan)).toBe('3 из 4 — нет Telegram: Никитина В.')
  })

  it('после отправки: кнопки нет, «Напомнили в» — по последнему напоминанию; ученик с двумя ДЗ считается один раз', () => {
    const at = '2026-09-26T11:05:00.000Z'
    const rows = [
      od({ student_id: 's1', reminded_at: at }),
      od({ student_id: 's1', homework_id: 'h2', reminded_at: '2026-09-26T10:00:00.000Z' }),
      od({ student_id: 's5', student_name: 'Петров Иван', telegram: 'muted' }),
    ]
    const plan = remindPlan(rows)
    expect(plan).toMatchObject({ students: 2, toSend: 0, reached: 1, lastRemindedAt: at, muted: ['Петров И.'] })
    expect(remindNote(plan)).toBe('1 из 2 — напоминания выключены: Петров И.')
  })

  it('новый долг у уже напомненного ученика — ему снова можно (пара без напоминания)', () => {
    const plan = remindPlan([od({ reminded_at: '2026-09-26T11:05:00Z' }), od({ homework_id: 'h2', reminded_at: null })])
    expect(plan.toSend).toBe(1)
  })

  it('все с Telegram — строки-оговорки нет', () => {
    expect(remindNote(remindPlan([od({})]))).toBe('')
  })
})

const q = (id: string, hw: string, submitted: string, due: string | null, course = 'c1'): QueueRow => ({
  attempt: { id, homework_id: hw, student_id: `st-${id}`, attempt_number: 1, status: 'submitted', submitted_at: submitted, created_at: submitted, updated_at: submitted } as QueueRow['attempt'],
  history: [], homeworkId: hw, homeworkTitle: 'ДЗ', gradeScale: 'five', dueAt: due,
  topicId: `t-${hw}`, topicTitle: `Тема ${hw}`, courseId: course, courseTitle: 'Курс',
})

describe('«На проверке»: по заданию, просрочка — как в очереди', () => {
  it('группировка по ДЗ, «N просрочены» = сдано позже срока, ссылки в очередь задания и на самую давнюю', () => {
    const rows = [
      q('a1', 'h1', '2026-09-20T10:00:00Z', '2026-09-19'),
      q('a2', 'h1', '2026-09-18T10:00:00Z', '2026-09-19'),
      q('a3', 'h1', '2026-09-21T10:00:00Z', '2026-09-19'),
      q('a4', 'h2', '2026-09-22T10:00:00Z', null),
    ]
    const g = homeworkReviewGroups(rows, () => '11А · Профиль')
    const h1 = g.find(x => x.key === 'hw:h1')!
    expect(h1).toMatchObject({ count: 3, late: 2, title: 'Тема h1', groupLine: '11А · Профиль', href: '/homework-queue?topic=t-h1', oldestHref: '/homework-queue?attempt=a2' })
    expect(g.find(x => x.key === 'hw:h2')).toMatchObject({ count: 1, late: 0 })
  })

  it('задания пробников — в общий список; первым — где работа ждёт дольше всех (туда ведёт главная кнопка)', () => {
    const hw = homeworkReviewGroups([q('a1', 'h1', '2026-09-20T10:00:00Z', null)], () => null)
    const mocks = mockReviewGroups([{ mock_exam_id: 'm1', title: 'Пробник №3', group_name: '11А', works: 3, oldest_student_id: 's9', oldest_at: '2026-09-19T08:00:00Z' }])
    const all = reviewGroups(hw, mocks)
    expect(all.map(x => x.key)).toEqual(['mock:m1', 'hw:h1'])
    expect(all[0].oldestHref).toBe('/mock-exams/m1/review/s9')
    expect(all[0].href).toBe('/mock-exams/m1?tab=works')
    expect(hw[0].groupLine).toBe('Курс')
  })
})

describe('Ближайшее и разбор ответа базы', () => {
  it('«чт, 1 октября»; тексты и ссылки строк', () => {
    expect(dayLabel('2026-10-01')).toBe('чт, 1 октября')
    const mock = { kind: 'mock' as const, id: 'm4', topic_id: null, course_id: 'c1', group_name: '11А', title: 'Пробник №4', day: '2026-10-03', time: '10:00' }
    expect(upcomingText(mock)).toBe('Пробник №4 в 10:00')
    expect(upcomingHref(mock)).toBe('/mock-exams/m4')
    const hw = { ...mock, kind: 'homework' as const, id: 'h14', topic_id: 't14', title: 'Отбор корней', time: null }
    expect(upcomingText(hw)).toBe('Срок ДЗ «Отбор корней»')
    expect(upcomingHref(hw)).toBe('/course-program?courseId=c1&materialsTopic=t14')
  })

  it('неполный ответ не роняет экран; проценты приходят строками numeric — становятся числами', () => {
    const h = normalizeHome({ series: [{ student_id: 's', student_name: 'x', course_id: 'c', group_name: null, hw: ['80.00', '70.5'], mocks: [{ score: 70, unit: 'primary' }] }] }, '2026-09-26')
    expect(h.today).toBe('2026-09-26')
    expect(h.overdue).toEqual([])
    expect(h.series[0].hw).toEqual([80, 70.5])
    expect(normalizeHome(null, '2026-09-26').groups).toEqual([])
  })
})
