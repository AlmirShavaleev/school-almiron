import { describe, expect, it } from 'vitest'
import {
  activityLevel, buildCalendar, cellLabel, courseAverage, courseCards, mondayOf, normalizeHomeActivity,
  streakPhrase, weekBarLabel, weekDots, weeklySolved, type HomeActivity,
} from '@/lib/studentHome'
import type { TopicJournalHomework } from '@/lib/topicJournal'

/**
 * §254. Раскладка главной ученика: календарь 12 недель, точки недели,
 * столбики по неделям, карточки курсов. Серию и рекорд считает база
 * (пробы supabase/tests/glavnaya_254) — здесь проверяется, что клиент кладёт
 * её ответ в клетки и недели без своих правил.
 */

// Пятница, 2 октября 2026.
const TODAY = '2026-10-02'

function activity(over: Partial<HomeActivity> = {}): HomeActivity {
  return {
    today: TODAY, from: '2026-07-11', streak: 0, record: 0, visitedToday: false,
    visits: [], solved: [], courses: [], ...over,
  }
}

describe('normalizeHomeActivity', () => {
  it('ответ базы → структура; неполный ответ не роняет', () => {
    const a = normalizeHomeActivity({
      today: '2026-10-02', from: '2026-07-11', streak: 5, record: 12, visited_today: true,
      visits: ['2026-10-01', '2026-10-02', 'мусор'],
      solved: [{ day: '2026-10-01', n: 3, hw: 1, catalog: 2, mock: 0, test: 0 }, { n: 1 }],
      courses: [{ course_id: 'c1', topics_total: 9, topics_done: 4 }, { topics_total: 1 }],
    })!
    expect(a.streak).toBe(5)
    expect(a.visitedToday).toBe(true)
    expect(a.visits).toEqual(['2026-10-01', '2026-10-02'])
    expect(a.solved).toHaveLength(1)
    expect(a.courses).toEqual([{ courseId: 'c1', topicsTotal: 9, topicsDone: 4 }])
    expect(normalizeHomeActivity(null)).toBeNull()
    expect(normalizeHomeActivity({ streak: 3 })).toBeNull()
  })
})

describe('ступени цвета', () => {
  it('0, 1–2, 3–5, 6–9, 10+', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 40].map(activityLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('календарь за 12 недель', () => {
  it('12 колонок по 7 дней пн–вс, последняя — текущая неделя', () => {
    const cal = buildCalendar(activity())
    expect(cal).toHaveLength(12)
    expect(cal.every(col => col.length === 7)).toBe(true)
    expect(cal[0][0].day).toBe('2026-07-13') // понедельник 11 недель назад
    expect(cal[11][0].day).toBe('2026-09-28') // понедельник этой недели
    expect(cal[11][6].day).toBe('2026-10-04') // воскресенье этой недели
  })

  it('будущие дни недели — пустые, сегодня отмечено, задач в будущем не бывает', () => {
    const cal = buildCalendar(activity({ solved: [{ day: '2026-10-03', n: 4, hw: 4, catalog: 0, mock: 0, test: 0 }] }))
    const week = cal[11]
    expect(week.map(c => c.future)).toEqual([false, false, false, false, false, true, true])
    expect(week.filter(c => c.today).map(c => c.day)).toEqual([TODAY])
    expect(week[5].solved).toBe(0)
    expect(week[5].level).toBe(0)
  })

  it('цвет — по задачам дня, подсказка — задачи / заходили без задач / не заходили', () => {
    const cal = buildCalendar(activity({
      visits: ['2026-09-30', '2026-10-01'],
      solved: [{ day: '2026-10-01', n: 5, hw: 2, catalog: 3, mock: 0, test: 0 }, { day: '2026-09-29', n: 12, hw: 0, catalog: 0, mock: 12, test: 0 }],
    }))
    const byDay = new Map(cal.flat().map(c => [c.day, c]))
    expect(byDay.get('2026-10-01')).toMatchObject({ level: 2, label: '1 октября: 5 задач' })
    expect(byDay.get('2026-09-30')).toMatchObject({ level: 0, visited: true, label: '30 сентября: заходили, задач не решали' })
    // Пробник на бумаге: задачи есть, захода нет — цвет есть, серия не при чём.
    expect(byDay.get('2026-09-29')).toMatchObject({ level: 4, visited: false, label: '29 сентября: 12 задач' })
    expect(byDay.get('2026-09-28')!.label).toBe('28 сентября: не заходили')
  })

  it('склоняет: 1 задача, 2 задачи, 11 задач', () => {
    expect(cellLabel({ day: TODAY, visited: true, solved: 1, future: false })).toBe('2 октября: 1 задача')
    expect(cellLabel({ day: TODAY, visited: true, solved: 2, future: false })).toBe('2 октября: 2 задачи')
    expect(cellLabel({ day: TODAY, visited: true, solved: 11, future: false })).toBe('2 октября: 11 задач')
  })

  it('новичок: календарь пустой, но целый', () => {
    const cells = buildCalendar(activity()).flat()
    expect(cells).toHaveLength(84)
    expect(cells.filter(c => !c.future).every(c => c.level === 0 && !c.visited)).toBe(true)
  })
})

describe('точки недели в плашке серии', () => {
  it('пн–вс текущей недели; сегодня ещё не заходил — сегодняшняя точка пустая', () => {
    // Серия 3 (пн–чт… до вчера) приходит из базы; клиент её не пересчитывает.
    expect(weekDots(activity({ visits: ['2026-09-27', '2026-09-28', '2026-09-30', '2026-10-01'] })))
      .toEqual([true, false, true, true, false, false, false])
  })
  it('streakPhrase склоняет', () => {
    expect(streakPhrase(1)).toBe('1 день подряд')
    expect(streakPhrase(3)).toBe('3 дня подряд')
    expect(streakPhrase(5)).toBe('5 дней подряд')
    expect(streakPhrase(21)).toBe('21 день подряд')
  })
})

describe('решено задач по неделям', () => {
  it('10 недель пн–вс, текущая последняя; дни складываются в свою неделю', () => {
    const bars = weeklySolved(activity({
      solved: [
        { day: '2026-09-28', n: 2, hw: 2, catalog: 0, mock: 0, test: 0 },
        { day: '2026-10-02', n: 3, hw: 0, catalog: 3, mock: 0, test: 0 },
        { day: '2026-09-27', n: 7, hw: 0, catalog: 0, mock: 7, test: 0 }, // воскресенье прошлой недели
        { day: '2026-07-01', n: 9, hw: 9, catalog: 0, mock: 0, test: 0 }, // старше 10 недель
      ],
    }))
    expect(bars).toHaveLength(10)
    expect(bars[9]).toMatchObject({ start: '2026-09-28', n: 5, current: true, label: '28 сен' })
    expect(bars[8]).toMatchObject({ start: '2026-09-21', n: 7, current: false })
    expect(bars[0].start).toBe('2026-07-27')
    expect(bars.reduce((s, b) => s + b.n, 0)).toBe(12)
    expect(weekBarLabel(bars[8])).toBe('неделя с 21 сен: 7 задач')
    expect(weekBarLabel(bars[9])).toBe('эта неделя: 5 задач')
  })
  it('понедельник недели', () => {
    expect(mondayOf('2026-10-04')).toBe('2026-09-28')
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
  })
})

describe('«Мои курсы»', () => {
  const row = (over: Partial<TopicJournalHomework>): TopicJournalHomework => ({
    homework_id: 'h', title: 'ДЗ', topic_id: 't', topic_title: 'Тема', module_title: null,
    course_id: 'c1', course_title: 'Физика', due_at: null, grade_scale: 'five', status: 'not_started',
    score: null, comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false, ...over,
  })

  it('средняя по пятибалльной, иначе по стобалльной, без балла — «—»', () => {
    expect(courseAverage([row({ status: 'accepted', score: 4 }), row({ status: 'accepted', score: 5 }), row({ status: 'accepted', score: 90, grade_scale: 'hundred' })])).toBe('4,5')
    expect(courseAverage([row({ status: 'accepted', score: 78, grade_scale: 'hundred' }), row({ status: 'accepted', score: 81, grade_scale: 'hundred' })])).toBe('80/100')
    expect(courseAverage([row({ status: 'accepted', score: null }), row({ status: 'submitted', score: 5 })])).toBe('—')
  })

  it('темы — из базы, ДЗ и оценка — из журнала своего курса', () => {
    const cards = courseCards(
      [{ courseId: 'c1', groupId: 'g1', title: 'Физика', subject: 'physics' }, { courseId: 'c2', groupId: 'g2', title: 'Математика', subject: 'math' }],
      [{ courseId: 'c1', topicsTotal: 52, topicsDone: 9 }],
      [
        row({ homework_id: 'a', status: 'accepted', score: 4 }),
        row({ homework_id: 'b', status: 'returned' }),
        row({ homework_id: 'c', course_id: 'c2', status: 'accepted', score: null, grade_scale: null }),
      ],
    )
    expect(cards[0]).toMatchObject({ topicsDone: 9, topicsTotal: 52, hwAccepted: 1, hwTotal: 2, average: '4,0' })
    expect(cards[1]).toMatchObject({ topicsDone: 0, topicsTotal: 0, hwAccepted: 1, hwTotal: 1, average: '—' })
  })

  it('база не ответила — числа тем не выдумываются', () => {
    const [card] = courseCards([{ courseId: 'c1', groupId: 'g1', title: 'Физика', subject: null }], null, [])
    expect(card.topicsDone).toBeNull()
    expect(card.topicsTotal).toBeNull()
  })
})
