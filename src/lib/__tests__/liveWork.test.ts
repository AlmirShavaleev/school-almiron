import { describe, expect, it } from 'vitest'
import {
  awayLabel, canReopen, durationShort, filterCounts, liveBriefNote, liveCounters, liveRows, parseLiveWork,
  parseLiveWorksList, parseMockAway, shouldPoll, statusLabel, studentStatus, workPhase, type LiveStudentRow,
} from '@/lib/liveWork'
import { liveWorkPath, parseSummary, teacherBlocks } from '@/lib/courseAssessments'

/**
 * §263. «Проверочная вживую»: статус ученика, счётчики, фильтры и итог — одно
 * правило по серверному времени. Класс как в макете (окно 08:45–09:30 МСК).
 */
const OPENS = '2026-10-03T05:45:00.000Z' // 08:45 МСК
const CLOSES = '2026-10-03T06:30:00.000Z' // 09:30 МСК
const t = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 9, 3, h - 3, m)).toISOString()
}
const NOW = Date.parse(t('09:22'))
const AFTER = Date.parse(t('09:40'))

function st(name: string, over: Partial<LiveStudentRow> = {}): LiveStudentRow {
  return {
    studentId: name, name, openedAt: null, attemptStatus: null, submittedAt: null, autoSubmitted: false,
    photos: 0, lastPhotoAt: null, awayCount: 0, awaySeconds: 0,
    windowOpensAt: OPENS, windowClosesAt: CLOSES, personal: false, ...over,
  }
}

const CLASS: LiveStudentRow[] = [
  st('Шарипов К.', { openedAt: t('08:46'), attemptStatus: 'submitted', submittedAt: t('09:21'), photos: 3, lastPhotoAt: t('09:20') }),
  st('Газизов И.', { openedAt: t('08:47'), attemptStatus: 'submitted', submittedAt: t('09:24'), photos: 2, lastPhotoAt: t('09:23') }),
  st('Мурин А.', { openedAt: t('08:47'), attemptStatus: 'draft', photos: 2, lastPhotoAt: t('09:19'), awayCount: 2, awaySeconds: 70 }),
  st('Салахиев Н.', { openedAt: t('08:52'), attemptStatus: 'draft', photos: 1, lastPhotoAt: t('09:15') }),
  st('Гильфанов А.', { openedAt: t('08:48'), awayCount: 5, awaySeconds: 240 }),
  st('Мударисов Р.', { openedAt: t('08:47') }),
  // Начал попытку (черновик без фото) без отметки открытия — тоже «пишет».
  st('Хайрутдинов Ю.', { attemptStatus: 'draft' }),
  st('Аминов А.'),
  st('Винокуров М.', { awayCount: 1, awaySeconds: 12 }),
]

describe('статус ученика (§263)', () => {
  it('идёт: сдал / фото есть / пишет без фото / не открывал', () => {
    const s = Object.fromEntries(CLASS.map(x => [x.name, studentStatus(x, NOW)]))
    expect(s).toEqual({
      'Шарипов К.': 'submitted', 'Газизов И.': 'submitted', 'Мурин А.': 'photos', 'Салахиев Н.': 'photos',
      'Гильфанов А.': 'writing', 'Мударисов Р.': 'writing', 'Хайрутдинов Ю.': 'writing',
      'Аминов А.': 'not_opened', 'Винокуров М.': 'not_opened',
    })
  })

  it('после конца: черновик с фото «сдаётся», без фото — «не писал»/«открыл, не сдал»; автосдача — «ушло автоматически»', () => {
    expect(studentStatus(CLASS[2], AFTER)).toBe('sending')
    expect(studentStatus(CLASS[4], AFTER)).toBe('missed')
    expect(statusLabel(CLASS[4], AFTER)).toBe('открыл, не сдал')
    expect(statusLabel(CLASS[7], AFTER)).toBe('не писал')
    const auto = st('Авто', { openedAt: t('08:50'), attemptStatus: 'submitted', autoSubmitted: true, submittedAt: CLOSES, photos: 2 })
    expect(studentStatus(auto, AFTER)).toBe('auto')
    expect(statusLabel(auto, AFTER)).toBe('ушло автоматически 09:30')
    // Проверенная работа — всё равно «сдал»: статус попытки не draft.
    expect(studentStatus(st('Проверен', { attemptStatus: 'accepted', submittedAt: t('09:10') }), AFTER)).toBe('submitted')
  })

  it('личное окно (§240): впереди — «личное время с …», идёт после общего конца — снова «пишет»', () => {
    const later = st('Болел', { personal: true, windowOpensAt: t('10:00'), windowClosesAt: t('10:45') })
    expect(studentStatus(later, AFTER)).toBe('waiting')
    expect(statusLabel(later, AFTER)).toBe('личное время с 10:00')
    const nowLive = st('Болел', { personal: true, windowOpensAt: t('09:35'), windowClosesAt: t('10:20'), openedAt: t('09:36') })
    expect(studentStatus(nowLive, AFTER)).toBe('writing')
    expect(workPhase({ opensAt: OPENS, closesAt: CLOSES, students: [nowLive] }, AFTER)).toBe('live')
  })

  it('подписи строки как в макете', () => {
    expect(statusLabel(CLASS[0], NOW)).toBe('сдал 09:21')
    expect(statusLabel(CLASS[2], NOW)).toBe('фото есть')
    expect(statusLabel(CLASS[4], NOW)).toBe('пишет, фото нет')
    expect(statusLabel(CLASS[7], NOW)).toBe('не открывал')
  })
})

describe('счётчики и фильтры', () => {
  it('идёт: пишут · открыли условие = без фото + с фото + сдали; не открывали отдельно', () => {
    const c = liveCounters(CLASS, NOW)
    expect(c).toMatchObject({ total: 9, opened: 7, noPhoto: 3, photos: 2, submitted: 2, notOpened: 2, away: 3 })
    expect(c.opened).toBe(c.noPhoto + c.photos + c.submitted)
  })

  it('итог после конца: сдал сам / ушло (и уйдёт) автоматически / не писал', () => {
    const c = liveCounters(CLASS, AFTER)
    expect(c).toMatchObject({ self: 2, auto: 2, missed: 5 })
  })

  it('фильтры «Без фото», «Не открывали», «Уходили со страницы» и их числа', () => {
    expect(filterCounts(CLASS, NOW)).toEqual({ all: 9, no_photo: 3, not_opened: 2, away: 3 })
    expect(liveRows(CLASS, 'no_photo', NOW).map(r => r.name)).toEqual(['Гильфанов А.', 'Мударисов Р.', 'Хайрутдинов Ю.'])
    expect(liveRows(CLASS, 'not_opened', NOW).map(r => r.name)).toEqual(['Аминов А.', 'Винокуров М.'])
    expect(liveRows(CLASS, 'away', NOW).map(r => r.name)).toEqual(['Мурин А.', 'Гильфанов А.', 'Винокуров М.'])
    // После конца «не открывали» — это и «не писал» без отметки открытия.
    expect(liveRows(CLASS, 'not_opened', AFTER).map(r => r.name)).toEqual(['Аминов А.', 'Винокуров М.'])
  })

  it('порядок как в макете: сдали → с фото → без фото → не открывали', () => {
    expect(liveRows(CLASS, 'all', NOW).map(r => studentStatus(r, NOW))).toEqual([
      'submitted', 'submitted', 'photos', 'photos', 'writing', 'writing', 'writing', 'not_opened', 'not_opened',
    ])
  })

  it('«Открыть заново» — у не открывавших, не сдавших после конца и с личным временем впереди; у сдавших — нет', () => {
    expect(canReopen(CLASS[7], NOW)).toBe(true)
    expect(canReopen(CLASS[4], NOW)).toBe(false)
    expect(canReopen(CLASS[4], AFTER)).toBe(true)
    expect(canReopen(CLASS[0], AFTER)).toBe(false)
  })
})

describe('уходы, фаза, опрос', () => {
  it('«2 раза · 1 мин 10 с», «5 раз · 4 мин», «—»', () => {
    expect(awayLabel(2, 70)).toBe('2 раза · 1 мин 10 с')
    expect(awayLabel(5, 240)).toBe('5 раз · 4 мин')
    expect(awayLabel(1, 12)).toBe('1 раз · 12 с')
    expect(awayLabel(0, 0)).toBe('—')
    expect(durationShort(59.6)).toBe('1 мин')
  })

  it('фаза по общему окну; без окна — «не назначено»', () => {
    expect(workPhase({ opensAt: OPENS, closesAt: CLOSES, students: [] }, Date.parse(t('08:00')))).toBe('before')
    expect(workPhase({ opensAt: OPENS, closesAt: CLOSES, students: [] }, NOW)).toBe('live')
    expect(workPhase({ opensAt: OPENS, closesAt: CLOSES, students: [] }, AFTER)).toBe('after')
    expect(workPhase({ opensAt: null, closesAt: null, students: [] }, NOW)).toBe('unscheduled')
  })

  it('опрос раз в 15 с — пока идёт; после конца — только пока кто-то «сдаётся»; скрытая вкладка — нет', () => {
    expect(shouldPoll('live', { photos: 0 }, false)).toBe(true)
    expect(shouldPoll('live', { photos: 0 }, true)).toBe(false)
    expect(shouldPoll('after', { photos: 1 }, false)).toBe(true)
    expect(shouldPoll('after', { photos: 0 }, false)).toBe(false)
  })
})

describe('разбор ответов базы', () => {
  it('timed_work_live → данные экрана; мусор → null', () => {
    const w = parseLiveWork({
      homework_id: 'hw', topic_id: 'tp', course_id: 'c', title: 'Движение по окружности', kind: 'check',
      group_name: '10А', opens_at: OPENS, closes_at: CLOSES, server_now: t('09:22'),
      students: [
        { student_id: 's1', full_name: 'Мурин А.', opened_at: t('08:47'), attempt_status: 'draft', photos: '2', last_photo_at: t('09:19'), away_count: 2, away_seconds: 70, window_opens_at: OPENS, window_closes_at: CLOSES, personal: false },
        { full_name: 'без id' },
      ],
    })!
    expect(w.kind).toBe('check')
    expect(w.students).toHaveLength(1)
    expect(w.students[0]).toMatchObject({ name: 'Мурин А.', photos: 2, attemptStatus: 'draft', awayCount: 2 })
    expect(parseLiveWork(null)).toBeNull()
    expect(parseLiveWork({ topic_id: 'x' })).toBeNull()
  })

  it('главная: список идущих работ и подпись строки', () => {
    const list = parseLiveWorksList([
      { homework_id: 'h1', topic_id: 't1', title: 'Движение по окружности', kind: 'check', group_name: '10А', opens_at: OPENS, closes_at: CLOSES, personal_live: 0 },
      { homework_id: 'h2', topic_id: 't2', title: 'Кинематика', kind: 'control', opens_at: t('07:00'), closes_at: t('07:45'), personal_live: 2 },
      { title: 'без id' },
    ])
    expect(list.map(w => w.homeworkId)).toEqual(['h1', 'h2'])
    expect(liveBriefNote(list[0], NOW)).toBe('идёт до 09:30')
    expect(liveBriefNote(list[1], NOW)).toBe('личное время у 2')
    expect(parseLiveWorksList({})).toEqual([])
  })

  it('уходы на пробнике → по ученику', () => {
    expect(parseMockAway([{ student_id: 's7', away_count: 2, away_seconds: 45 }, { away_count: 1 }])).toEqual({ s7: { count: 2, seconds: 45 } })
    expect(parseMockAway(null)).toEqual({})
  })
})

describe('вход «Следить» во вкладке «Проверочные и контрольные»', () => {
  const summary = parseSummary({
    server_now: OPENS, is_template: false, group_id: 'g', group_name: '10А', in_class: 17,
    works: [
      { topic_id: 'k', homework_id: 'hk', kind: 'check', title: 'Движение по окружности', published: true, opens_at: OPENS, closes_at: CLOSES, status: 'live', submitted: 2, pending: 2, reviewed: 0, avg_score: null, writing: 11, personal_live: 0 },
      { topic_id: 'd', homework_id: 'hd', kind: 'control', title: 'Динамика', published: true, opens_at: t('07:00'), closes_at: t('07:45'), status: 'done', submitted: 16, pending: 0, reviewed: 16, avg_score: 4.1, writing: 0, personal_live: 0 },
    ],
    mocks: [],
  })!
  it('идёт — «Следить» ведёт в монитор; проверена — «Работы» и «Итог»', () => {
    const rows = teacherBlocks(summary, NOW).flatMap(b => b.rows)
    expect(rows.find(r => r.title === 'Движение по окружности')!.actions).toEqual([{ kind: 'live', label: 'Следить', to: liveWorkPath('hk') }])
    expect(rows.find(r => r.title === 'Динамика')!.actions.map(a => a.label)).toEqual(['Работы', 'Итог'])
    expect(liveWorkPath('hk')).toBe('/live-work/hk')
  })
})
