import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_STUDENT_SORT, PERIOD_KEY, VIEW_KEY,
  formatAgo, formatDelta, formatDuration, formatScore, nextSort, parseStatsSummary, parseStudentsStats,
  parseTopicStudents, parseTopicsStats, percent, pickAvg, prevPeriodLabel, readPeriod, readView, savePref,
  sortStudents, type StudentStatsRow,
} from '@/lib/courseStats'

const TODAY = '2026-09-29'

describe('formatAgo — «Был в курсе»', () => {
  it('сегодня / N дней назад со склонением и цвет по давности', () => {
    expect(formatAgo('2026-09-29', TODAY)).toMatchObject({ text: 'сегодня', tone: 'ok' })
    expect(formatAgo('2026-09-28', TODAY)).toMatchObject({ text: '1 день назад', tone: 'ok' })
    expect(formatAgo('2026-09-27', TODAY)).toMatchObject({ text: '2 дня назад', tone: 'ok' })
    expect(formatAgo('2026-09-26', TODAY)).toMatchObject({ text: '3 дня назад', tone: 'mid' })
    expect(formatAgo('2026-09-24', TODAY)).toMatchObject({ text: '5 дней назад', tone: 'mid' })
    expect(formatAgo('2026-09-22', TODAY)).toMatchObject({ text: '7 дней назад', tone: 'bad' })
    expect(formatAgo('2026-09-08', TODAY)).toMatchObject({ text: '21 день назад', tone: 'bad' })
    expect(formatAgo('2026-09-18', TODAY)).toMatchObject({ text: '11 дней назад' })
  })
  it('ни разу — «не заходил», красным', () => {
    expect(formatAgo(null, TODAY)).toEqual({ text: 'не заходил', tone: 'bad', days: null })
  })
  it('переход через месяц считается по календарю', () => {
    expect(formatAgo('2026-08-31', '2026-09-01').text).toBe('1 день назад')
  })
})

describe('formatDuration — время видео', () => {
  it('минуты и часы как в макете', () => {
    expect(formatDuration(0)).toBe('0 мин')
    expect(formatDuration(30)).toBe('< 1 мин')
    expect(formatDuration(12 * 60)).toBe('12 мин')
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe('3 ч 20 м')
    expect(formatDuration(11 * 3600 + 5 * 60)).toBe('11 ч 05 м')
    expect(formatDuration(59 * 60 + 50)).toBe('1 ч 00 м')
  })
})

describe('средний балл', () => {
  it('пятибалльная — с запятой, стобалльная — целым', () => {
    expect(formatScore(4.25, 'five')).toBe('4,3')
    expect(formatScore(4, 'five')).toBe('4,0')
    expect(formatScore(70.4, 'hundred')).toBe('70')
    expect(formatScore(null, 'five')).toBe('—')
  })
  it('у ученика пятибалльный важнее стобалльного', () => {
    expect(pickAvg(4.5, 80)).toEqual({ value: 4.5, scale: 'five' })
    expect(pickAvg(null, 80)).toEqual({ value: 80, scale: 'hundred' })
    expect(pickAvg(null, null)).toEqual({ value: null, scale: null })
  })
})

describe('разница к прошлому периоду', () => {
  it('подпись и знак', () => {
    expect(prevPeriodLabel('7d')).toBe('к прошлой неделе')
    expect(prevPeriodLabel('30d')).toBe('к прошлым 30 дням')
    expect(prevPeriodLabel('all')).toBeNull()
    expect(formatDelta(18)).toBe('+18')
    expect(formatDelta(-3)).toBe('−3')
    expect(formatDelta(0)).toBe('0')
  })
  it('доля для полоски без деления на ноль', () => {
    expect(percent(9, 11)).toBe(82)
    expect(percent(3, 0)).toBe(0)
  })
})

const row = (p: Partial<StudentStatsRow> & { fullName: string }): StudentStatsRow => ({
  studentId: p.fullName, lastDay: null, days: 0, filesOpened: 0, filesTotal: 40, videoSeconds: 0,
  hw7: 0, hw30: 0, hwDone: 0, hwTotal: 14, avgFive: null, avgHundred: null, debts: 0, mockScore: null, ...p,
})
const ROWS = [
  row({ fullName: 'Абрамова Екатерина', lastDay: '2026-09-29', videoSeconds: 5700, avgFive: 4.8, mockScore: 78 }),
  row({ fullName: 'Петров Илья', lastDay: '2026-09-13', avgFive: 3.0, mockScore: 41, debts: 8 }),
  row({ fullName: 'Федоров Лев', lastDay: '2026-09-17', mockScore: null, debts: 6 }),
  row({ fullName: 'Новенький Ян', lastDay: null }),
  row({ fullName: 'Васильев Дмитрий', lastDay: '2026-09-28', videoSeconds: 4800, avgHundred: 90, mockScore: 71 }),
]
const names = (rows: StudentStatsRow[]) => rows.map(r => r.fullName.split(' ')[0])

describe('сортировка таблицы класса', () => {
  it('по умолчанию дольше всех не заходившие сверху, «ни разу» — первым', () => {
    expect(names(sortStudents(ROWS, DEFAULT_STUDENT_SORT, TODAY))).toEqual(['Новенький', 'Петров', 'Федоров', 'Васильев', 'Абрамова'])
  })
  it('повторное нажатие переворачивает, новый столбец — «больше сверху», имя — по алфавиту', () => {
    const s1 = nextSort(DEFAULT_STUDENT_SORT, 'last')
    expect(s1).toEqual({ key: 'last', dir: 'asc' })
    expect(names(sortStudents(ROWS, s1, TODAY))[0]).toBe('Абрамова')
    expect(nextSort(s1, 'video')).toEqual({ key: 'video', dir: 'desc' })
    expect(names(sortStudents(ROWS, { key: 'video', dir: 'desc' }, TODAY)).slice(0, 2)).toEqual(['Абрамова', 'Васильев'])
    expect(nextSort(s1, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(names(sortStudents(ROWS, { key: 'name', dir: 'asc' }, TODAY))).toEqual(['Абрамова', 'Васильев', 'Новенький', 'Петров', 'Федоров'])
  })
  it('пустые (нет оценок, не писал пробник) внизу в обе стороны', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const byMock = names(sortStudents(ROWS, { key: 'mock', dir }, TODAY))
      expect(byMock.slice(-2).sort()).toEqual(['Новенький', 'Федоров'])
    }
    // средний: стобалльный 90 сравнивается как 4,5 из пяти
    expect(names(sortStudents(ROWS, { key: 'avg', dir: 'desc' }, TODAY)).slice(0, 3)).toEqual(['Абрамова', 'Васильев', 'Петров'])
  })
})

describe('разбор ответов RPC', () => {
  it('сводка: числа из строк, дни по порядку, пустой ответ — null', () => {
    const s = parseStatsSummary({
      period: '30d', from: '2026-08-31', to: TODAY, in_class: 11, active: '10', views: 248, views_prev: 208,
      video_seconds: 39900, video_done: 31, submitted: 52, accepted: 47, returned: 4, pending: 1,
      pending_oldest_at: '2026-09-27T09:00:00Z', avg_five: '4.20', avg_five_count: 47, avg_hundred: null, avg_hundred_count: 0,
      days: [{ day: '2026-09-29', active: 8 }, { day: '2026-09-28', active: 5 }],
      quiet: [{ student_id: 's1', full_name: 'Петров Илья', last_day: null }], no_hw_14: [],
    })
    expect(s).toMatchObject({ period: '30d', active: 10, avgFive: 4.2, viewsPrev: 208, avgHundred: null })
    expect(s!.days.map(d => d.day)).toEqual(['2026-09-28', '2026-09-29'])
    expect(s!.quiet[0]).toEqual({ student_id: 's1', full_name: 'Петров Илья', last_day: null })
    expect(parseStatsSummary(null)).toBeNull()
    expect(parseStatsSummary({ views: 1 })).toBeNull()
  })
  it('темы — по id; ученики темы — только известные состояния', () => {
    const t = parseTopicsStats({ period: 'all', in_class: 4, topics: [{ topic_id: 't1', opened: 3, videos: 1, video_done: 2, hw: true, grade_scale: 'five', submitted: 2, avg_score: '5.00', pending: 1, timed: false }] })
    expect(t!.byTopic.t1).toMatchObject({ opened: 3, videoDone: 2, hw: true, avgScore: 5, pending: 1 })
    const r = parseTopicStudents({ rows: [
      { student_id: 's1', full_name: 'А', opened: true, video: 'done', hw_status: 'accepted', score: 5 },
      { student_id: 's2', full_name: 'Б', opened: false, video: null, hw_status: 'weird' },
    ] })
    expect(r).toEqual([
      expect.objectContaining({ studentId: 's1', video: 'done', hw: 'accepted', score: 5 }),
      expect.objectContaining({ studentId: 's2', video: null, hw: null, score: null }),
    ])
  })
  it('ученики: пробник группы и строки', () => {
    const s = parseStudentsStats({ period: '7d', to: TODAY, in_class: 1, mock: { id: 'm', title: 'Пробник №2', max_score: 100 },
      rows: [{ student_id: 's', full_name: 'Ученик', last_day: '2026-09-28', files_opened: 4, files_total: 5, mock_score: null }] })
    expect(s!.mock).toEqual({ id: 'm', title: 'Пробник №2', maxScore: 100 })
    expect(s!.rows[0]).toMatchObject({ lastDay: '2026-09-28', filesOpened: 4, filesTotal: 5, mockScore: null, days: 0 })
  })
})

describe('запомненные период и разрез', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
  it('читает и пишет localStorage', () => {
    expect(readPeriod()).toBe('7d')
    expect(readView()).toBe('topics')
    savePref(PERIOD_KEY, '30d')
    savePref(VIEW_KEY, 'students')
    expect(readPeriod()).toBe('30d')
    expect(readView()).toBe('students')
    localStorage.setItem(PERIOD_KEY, 'мусор')
    expect(readPeriod()).toBe('7d')
  })
  it('запрещённое хранилище не роняет экран', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(readPeriod()).toBe('7d')
    expect(readView()).toBe('topics')
    expect(() => savePref(PERIOD_KEY, 'all')).not.toThrow()
  })
})
