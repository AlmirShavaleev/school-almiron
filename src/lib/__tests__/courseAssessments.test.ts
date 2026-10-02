/**
 * §241. Раздел «Контрольные, самостоятельные и пробники» — поведение чистой
 * логики: группировка по типам и порядок, сводки блоков, правило троих
 * (сравнение приходит от базы только при ≥ 3 других; «0 %» не пишем),
 * «+N к прошлому», точки графика, таблица учителя.
 *
 * §259: в разделе ученика — только ожидающие (`pendingItems`); модуль, где все
 * темы — работы по времени, снова виден (`studentProgramModules`), в модулях с
 * уроками работ нет.
 */
import { describe, expect, it } from 'vitest'
import {
  assessmentBlocks, assessmentItems, blockSummary, chartAriaLabel, dateColumn, formatNumber, groupStanding,
  liveItems, mockChartPoints, parseMyAssessments, parseSummary, prevDelta, readCollapsed, rowView, storeCollapsed,
  teacherBlocks, untilLabel, workPhase, pendingItems, studentProgramModules, isWorksOnlyModule, worksCountLabel,
  workWhenLabel, workWhenShort,
  type AssessmentWork, type AssessmentMock, type MyAssessments,
} from '@/lib/courseAssessments'

// Пятница, 2 октября 2026, 10:10 по Москве.
const NOW = Date.parse('2026-10-02T07:10:00Z')
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const DAY = 24 * 60

function work(p: Partial<AssessmentWork> & { topic_id: string; title: string }): AssessmentWork {
  return {
    homework_id: `hw-${p.topic_id}`, kind: 'control', module_id: 'm1', module_title: 'Работы', topic_open: true,
    available_from: null, grade_scale: 'five', opens_at: null, closes_at: null, personal: false, status: 'none',
    submitted_at: null, reviewed_at: null, score: null, tasks: null, group: null, ...p,
  }
}

function mock(p: Partial<AssessmentMock> & { id: string; title: string; starts_at: string }): AssessmentMock {
  const ends = new Date(Date.parse(p.starts_at) + 235 * 60_000).toISOString()
  const photos = new Date(Date.parse(p.starts_at) + 250 * 60_000).toISOString()
  return {
    ends_at: ends, photos_until: photos, duration_minutes: 235, submitted_at: null, has_work: false, notified: false,
    score: null, max_score: null, server_now: at(0), ...p,
  }
}

const DATA: MyAssessments = {
  serverNow: at(0),
  works: [
    work({ topic_id: 'k', title: 'Кинематика', opens_at: at(-10), closes_at: at(35), status: 'draft' }),
    work({ topic_id: 'trig', title: 'Тригонометрия', opens_at: at(-13 * DAY), closes_at: at(-13 * DAY + 45), status: 'submitted', submitted_at: at(-13 * DAY + 30) }),
    work({
      topic_id: 'der', title: 'Производные', kind: 'check', opens_at: at(-10 * DAY), closes_at: at(-10 * DAY + 40), status: 'reviewed', score: 5,
      tasks: [{ no: '1', verdict: 'correct' }, { no: '2', verdict: 'correct' }, { no: '3', verdict: 'partial' }, { no: '4', verdict: 'wrong' }],
      group: { avg: 4.1, count: 16, submitted: 16, in_group: 18, better_pct: 70, best: false },
    }),
    work({ topic_id: 'log', title: 'Логарифмы', kind: 'check', opens_at: at(-20 * DAY), closes_at: at(-20 * DAY + 40), status: 'none' }),
    work({ topic_id: 'none', title: 'Без времени', kind: 'check' }),
  ],
  mocks: [
    mock({ id: 'm1', title: 'Пробник №1', starts_at: at(-34 * DAY), notified: true, has_work: true, score: 52, max_score: 100, primary_score: 12, primary_max: 32, group: { avg: 55, count: 12, better_pct: null, best: false } }),
    mock({ id: 'm2', title: 'Пробник №2', starts_at: at(-27 * DAY), notified: true, has_work: true, score: 61, max_score: 100, primary_score: 15, primary_max: 32, prev_score: 52, group: null }),
    mock({ id: 'm4', title: 'Пробник №4', starts_at: at(-6 * DAY), notified: true, has_work: true, score: 72, max_score: 100, primary_score: 18, primary_max: 32, prev_score: 61, group: { avg: 63, count: 14, better_pct: 70, best: false } }),
    mock({ id: 'm5', title: 'Пробник №5', starts_at: at(3 * DAY) }),
    mock({ id: 'm3', title: 'Пробник №3', starts_at: at(-13 * DAY), has_work: true, submitted_at: at(-13 * DAY + 100) }),
  ],
}

describe('группировка и порядок', () => {
  const items = assessmentItems(DATA, NOW)
  const blocks = assessmentBlocks(items, NOW)

  it('блоки по типам в постоянном порядке: пробники, контрольные, проверочные', () => {
    expect(blocks.map(b => b.key)).toEqual(['mock', 'control', 'check'])
    expect(blocks.map(b => b.title)).toEqual(['Пробники', 'Контрольные', 'Проверочные и самостоятельные'])
  })

  it('внутри блока — по дате, новые (и будущие) сверху; без даты — в конце', () => {
    expect(blocks[0].items.map(i => i.key)).toEqual(['mock:m5', 'mock:m4', 'mock:m3', 'mock:m2', 'mock:m1'])
    expect(blocks[2].items.map(i => i.key)).toEqual(['work:der', 'work:log', 'work:none'])
  })

  it('пустого блока нет', () => {
    const onlyMocks = assessmentBlocks(assessmentItems({ ...DATA, works: [] }, NOW), NOW)
    expect(onlyMocks.map(b => b.key)).toEqual(['mock'])
  })

  it('идущая работа — отдельно, первой та, что закроется раньше', () => {
    const live = liveItems(assessmentItems({
      ...DATA,
      mocks: [...DATA.mocks, mock({ id: 'run', title: 'Идёт', starts_at: at(-30) })],
    }, NOW))
    expect(live.map(i => i.key)).toEqual(['work:k', 'mock:run'])
  })

  it('состояние работы по времени: до, идёт, сдано, проверено, не сдано, без времени', () => {
    const w = (p: Partial<AssessmentWork>) => workPhase({ status: 'none', opens_at: null, closes_at: null, ...p }, NOW)
    expect(w({})).toBe('unscheduled')
    expect(w({ opens_at: at(60), closes_at: at(100) })).toBe('before')
    expect(w({ opens_at: at(-5), closes_at: at(40) })).toBe('live')
    expect(w({ opens_at: at(-100), closes_at: at(-50) })).toBe('missed')
    expect(w({ opens_at: at(-100), closes_at: at(-50), status: 'draft' })).toBe('missed')
    expect(w({ status: 'auto_submitted', opens_at: at(-100), closes_at: at(-50) })).toBe('sent')
    expect(w({ status: 'reviewed' })).toBe('reviewed')
  })
})

describe('сводки блоков', () => {
  const blocks = assessmentBlocks(assessmentItems(DATA, NOW), NOW)
  it('пробники: последний итог, средний группы последнего, ждёт проверки', () => {
    expect(blocks[0].summary).toBe('последний 72 · средний по группе 63 · ждёт проверки 1')
  })
  it('контрольные: идёт и ждёт проверки', () => {
    expect(blocks[1].summary).toBe('идёт 1 · ждёт проверки 1')
  })
  it('проверочные: средняя оценка и группа', () => {
    expect(blocks[2].summary).toBe('средняя оценка 5 · группа 4,1')
  })
  it('ничего не прошло — «ближайшая …»', () => {
    const items = assessmentItems({ ...DATA, mocks: [], works: [work({ topic_id: 'f', title: 'F', kind: 'check', opens_at: at(3 * DAY), closes_at: at(3 * DAY + 40) })] }, NOW)
    expect(blockSummary('check', items, NOW)).toBe('ближайшая 5 окт')
  })
})

describe('строка', () => {
  const byKey = new Map(assessmentItems(DATA, NOW).map(i => [i.key, i]))
  it('пробник с итогом: вторичный справа, первичный и «лучше N % группы» в подписи; открывается листом', () => {
    const i = byKey.get('mock:m4')!
    expect(i.hasResult).toBe(true)
    const v = rowView(i, NOW)
    expect(v.result).toEqual({ kind: 'score', value: '72', caption: 'вторичный' })
    expect(v.sub).toBe('первичный 18 из 32 · лучше 70 % группы')
    expect(v.date).toBe('26 сент')
  })
  it('будущий пробник: «через 3 дня», день недели и длительность', () => {
    const v = rowView(byKey.get('mock:m5')!, NOW)
    expect(v.result).toEqual({ kind: 'text', text: 'через 3 дня', tone: 'muted' })
    expect(v.sub).toBe('пн, 10:10 · 3 ч 55 мин')
    expect(byKey.get('mock:m5')!.hasResult).toBe(false)
  })
  it('сданный пробник без отправленного итога — «ждёт проверки»', () => {
    expect(rowView(byKey.get('mock:m3')!, NOW).result).toEqual({ kind: 'text', text: 'ждёт проверки', tone: 'wait' })
  })
  it('КР сдана — «ждёт проверки», подпись «сдано в …»', () => {
    const v = rowView(byKey.get('work:trig')!, NOW)
    expect(v.result).toEqual({ kind: 'text', text: 'ждёт проверки', tone: 'wait' })
    expect(v.sub).toBe('сдано в 10:40')
  })
  it('проверочная проверена: оценка, «верно 2 из 4 · частично 1», место в группе', () => {
    const v = rowView(byKey.get('work:der')!, NOW)
    expect(v.result).toEqual({ kind: 'score', value: '5', caption: 'оценка', tone: 'ok' })
    expect(v.sub).toBe('верно 2 из 4 · частично 1 · лучше 70 % группы')
  })
  it('окно закрылось без работы — «не сдано»', () => {
    expect(rowView(byKey.get('work:log')!, NOW).result).toEqual({ kind: 'text', text: 'не сдано', tone: 'miss' })
  })
  it('идёт — «идёт» и сколько осталось', () => {
    const v = rowView(byKey.get('work:k')!, NOW)
    expect(v.result).toEqual({ kind: 'text', text: 'идёт', tone: 'live' })
    expect(v.sub).toBe('10:00–10:45 · осталось 35 мин')
    expect(v.date).toBe('сегодня')
  })
  it('стобалльная — «из 100» без цвета', () => {
    const i = assessmentItems({ ...DATA, mocks: [], works: [work({ topic_id: 'h', title: 'H', status: 'reviewed', score: 80, grade_scale: 'hundred' })] }, NOW)[0]
    expect(rowView(i, NOW).result).toEqual({ kind: 'score', value: '80', caption: 'из 100', tone: undefined })
  })
})

describe('правило троих и «+N к прошлому»', () => {
  it('сравнения нет, если база его не прислала', () => {
    expect(groupStanding(null)).toBeNull()
  })
  it('«0 %» не пишем — ни из ответа, ни здесь', () => {
    expect(groupStanding({ avg: 4, count: 4, better_pct: 0, best: false })).toBeNull()
    const parsed = parseMyAssessments({ server_now: at(0), works: [{ topic_id: 't', kind: 'check', status: 'reviewed', score: 3, group: { avg: 4, count: 4, better_pct: 0, best: false } }], mocks: [] })
    expect(parsed!.works[0].group!.better_pct).toBeNull()
  })
  it('лучший — словами', () => {
    expect(groupStanding({ avg: 4, count: 4, better_pct: 100, best: true })).toBe('лучший результат в группе')
  })
  it('разница с прошлым пробником со знаком', () => {
    expect(prevDelta(72, 58)).toBe('+14 к прошлому')
    expect(prevDelta(55, 58)).toBe('−3 к прошлому')
    expect(prevDelta(58, 58)).toBe('как в прошлый раз')
    expect(prevDelta(58, null)).toBeNull()
  })
})

describe('график', () => {
  it('точки — только пробники с отправленным итогом, от старых к новым; средний — где он есть', () => {
    const pts = mockChartPoints(DATA.mocks, NOW)
    expect(pts.map(p => [p.id, p.you, p.group])).toEqual([['m1', 52, 55], ['m2', 61, null], ['m4', 72, 63]])
  })
  it('подпись для скринридера — с числами', () => {
    const label = chartAriaLabel(mockChartPoints(DATA.mocks, NOW))
    expect(label).toContain('Пробник №4 (26 сент) — 72')
    expect(label).toContain('средний по группе: Пробник №1 — 55, Пробник №4 — 63')
  })
})

describe('§259: раздел ученика — только ожидающие', () => {
  it('работа до начала и идущая — да; сдана, проверена, пропущена, без времени — нет', () => {
    const keys = pendingItems(assessmentItems({ ...DATA, mocks: [] }, NOW)).map(i => `${i.key}:${i.phase}`)
    expect(keys).toEqual(['work:k:live'])
    const more = pendingItems(assessmentItems({
      serverNow: at(0), mocks: [],
      works: [
        work({ topic_id: 'b', title: 'До начала', opens_at: at(60), closes_at: at(105) }),
        work({ topic_id: 's', title: 'Сдана в окне', opens_at: at(-10), closes_at: at(35), status: 'submitted', submitted_at: at(-2) }),
        work({ topic_id: 'u', title: 'Без времени' }),
      ],
    }, NOW)).map(i => i.key)
    expect(more).toEqual(['work:b'])
  })

  it('пробник до начала и идущий — да; сдан, время вышло, на проверке, пропущен, с итогом — нет', () => {
    const phases = (m: AssessmentMock) => pendingItems(assessmentItems({ serverNow: at(0), works: [], mocks: [m] }, NOW)).map(i => i.phase)
    expect(phases(mock({ id: 'u', title: 'Скоро', starts_at: at(3 * DAY) }))).toEqual(['upcoming'])
    expect(phases(mock({ id: 'o', title: 'Идёт', starts_at: at(-30) }))).toEqual(['open'])
    expect(phases(mock({ id: 's', title: 'Сдан', starts_at: at(-30), submitted_at: at(-5) }))).toEqual([])
    expect(phases(mock({ id: 't', title: 'Время вышло', starts_at: at(-240) }))).toEqual([])
    expect(phases(mock({ id: 'c', title: 'Проверка', starts_at: at(-13 * DAY), has_work: true }))).toEqual([])
    expect(phases(mock({ id: 'mi', title: 'Пропущен', starts_at: at(-13 * DAY) }))).toEqual([])
    expect(phases(mock({ id: 'r', title: 'Итог', starts_at: at(-6 * DAY), notified: true, score: 72 }))).toEqual([])
  })

  it('всё прошло — пусто (раздела нет)', () => {
    const past = { ...DATA, works: DATA.works.filter(w => w.topic_id !== 'k'), mocks: DATA.mocks.filter(m => m.id !== 'm5') }
    expect(pendingItems(assessmentItems(past, NOW))).toEqual([])
  })

  it('блоки из ожидающих: без результатов, сводка — «идёт» или «ближайшая»', () => {
    const blocks = assessmentBlocks(pendingItems(assessmentItems(DATA, NOW)), NOW)
    expect(blocks.map(b => [b.key, b.items.map(i => i.key), b.summary])).toEqual([
      ['mock', ['mock:m5'], 'ближайший 5 окт'],
      ['control', ['work:k'], 'идёт 1'],
    ])
  })
})

describe('§259: модули программы у ученика', () => {
  const t = (id: string, kind?: string) => ({ id, kind })
  const mods = [
    { id: 'a', topics: [t('1', 'lesson'), t('2', 'control')] },
    { id: 'kr', topics: [t('3', 'control'), t('4', 'check')] },
    { id: 'empty', topics: [] as { id: string; kind?: string }[] },
    { id: 'old', topics: [t('5')] },
  ]

  it('модуль только из работ — модуль работ; пустой и смешанный — нет', () => {
    expect(mods.map(isWorksOnlyModule)).toEqual([false, true, false, false])
  })

  it('модуль работ остаётся целиком; в смешанном работ нет; остальные — те же объекты', () => {
    const out = studentProgramModules(mods, true)
    expect(out.map(m => m.id)).toEqual(['a', 'kr', 'empty', 'old'])
    expect(out[0].topics.map(x => x.id)).toEqual(['1'])
    expect(out[1]).toBe(mods[1])
    expect(out[2]).toBe(mods[2])
    expect(out[3]).toBe(mods[3])
  })

  it('без данных раздела (RPC нет) — список как есть', () => {
    const out = studentProgramModules(mods, false)
    expect(out.map(m => m.topics.length)).toEqual([2, 2, 0, 1])
  })

  it('счётчики модуля не пересчитываются: у смешанного модуля — прежние', () => {
    const counters = { openTopics: 2, totalTopics: 2, homeworkAvailable: 0, homeworkSubmitted: 0 }
    const [a] = studentProgramModules([{ id: 'a', topics: [t('1', 'lesson'), t('2', 'control')], counters }], true)
    expect(a.counters).toBe(counters)
    expect(a.topics).toHaveLength(1)
  })

  it('подписи: «2 работы», когда — по Москве, без оценок', () => {
    expect([1, 2, 5, 11, 21].map(worksCountLabel)).toEqual(['1 работа', '2 работы', '5 работ', '11 работ', '21 работа'])
    expect(workWhenLabel({ opens_at: '2026-10-03T05:45:00Z', closes_at: '2026-10-03T06:30:00Z', personal: false })).toBe('сб 3 окт, 08:45–09:30')
    expect(workWhenLabel({ opens_at: '2026-10-03T05:45:00Z', closes_at: '2026-10-03T06:30:00Z', personal: true })).toBe('сб 3 окт, 08:45–09:30 · личное время')
    expect(workWhenLabel({ opens_at: null, closes_at: null, personal: false })).toBeNull()
    expect(workWhenLabel(undefined)).toBeNull()
    expect(workWhenShort({ opens_at: '2026-10-03T05:45:00Z' })).toBe('3 окт, 08:45')
  })
})

describe('свёрнутые блоки', () => {
  it('запоминаются и читаются; сломанное хранилище не роняет', () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    storeCollapsed(s, 'g1', new Set(['mock']))
    expect([...readCollapsed(s, 'g1')]).toEqual(['mock'])
    expect([...readCollapsed(s, 'g2')]).toEqual([])
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readCollapsed(broken, 'g1').size).toBe(0)
    expect(() => storeCollapsed(broken, 'g1', new Set(['check']))).not.toThrow()
  })
})

describe('слова', () => {
  it('числа, даты и «когда»', () => {
    expect(formatNumber(4.1)).toBe('4,1')
    expect(formatNumber(4)).toBe('4')
    expect(formatNumber(3.84)).toBe('3,8')
    expect(dateColumn(at(DAY), NOW)).toBe('завтра')
    expect(dateColumn(at(-DAY), NOW)).toBe('вчера')
    expect(untilLabel(at(30), NOW)).toBe('через 30 мин')
    expect(untilLabel(at(DAY), NOW)).toBe('завтра в 10:10')
    expect(untilLabel(at(5 * DAY), NOW)).toBe('через 5 дней')
  })
})

describe('учитель: сводка по классу', () => {
  const summary = parseSummary({
    server_now: at(0), is_template: false, group_id: 'g', group_name: '11А', in_class: 18,
    works: [
      { topic_id: 'k', kind: 'control', title: 'Кинематика', published: true, opens_at: at(-10), closes_at: at(35), status: 'live', submitted: 3, pending: 3, reviewed: 0, avg_score: null, writing: 14, personal_live: 0 },
      { topic_id: 'tr', kind: 'control', title: 'Тригонометрия', published: true, opens_at: at(-13 * DAY), closes_at: at(-13 * DAY + 45), status: 'review', submitted: 17, pending: 5, reviewed: 12, avg_score: 3.84, writing: 0, personal_live: 1 },
      { topic_id: 'der', kind: 'check', title: 'Производные', published: true, opens_at: at(-10 * DAY), closes_at: at(-10 * DAY + 40), status: 'done', submitted: 16, pending: 0, reviewed: 16, avg_score: 4.1, writing: 0, personal_live: 0 },
      { topic_id: 'plan', kind: 'check', title: 'План', published: true, opens_at: at(DAY), closes_at: at(DAY + 40), status: 'planned', submitted: 0, pending: 0, reviewed: 0, avg_score: null, writing: 0, personal_live: 0 },
    ],
    mocks: [
      { id: 'p5', title: 'Пробник №5', template_id: 't', starts_at: at(3 * DAY), ends_at: at(3 * DAY + 235), status: 'planned', submitted: 0, pending: 0, avg_score: null, writing: 0, in_group: 18 },
      { id: 'p4', title: 'Пробник №4', template_id: 't', starts_at: at(-6 * DAY), ends_at: at(-6 * DAY + 235), status: 'done', submitted: 14, pending: 0, avg_score: 63, writing: 0, in_group: 18 },
    ],
  })!

  it('три блока, заголовки со сводкой', () => {
    const blocks = teacherBlocks(summary, NOW)
    expect(blocks.map(b => `${b.title} · ${b.count}${b.summary ? ` · ${b.summary}` : ''}`)).toEqual([
      'Пробники · 2 · средний последнего 63',
      'Контрольные · 2 · ждут проверки 8',
      'Проверочные и самостоятельные · 2',
    ])
  })

  it('статусы, «сдали X из Y», средний и кнопки', () => {
    const rows = teacherBlocks(summary, NOW).flatMap(b => b.rows)
    const by = (t: string) => rows.find(r => r.title === t)!
    expect(by('Кинематика')).toMatchObject({ status: { text: 'идёт · пишут 14', tone: 'live' }, submitted: '3 из 18', avg: '—', when: 'сегодня, 10:00–10:45' })
    expect(by('Кинематика').actions).toEqual([{ kind: 'works', label: 'Кто пишет', topicId: 'k' }])
    expect(by('Тригонометрия')).toMatchObject({ status: { text: 'проверить 5', tone: 'check' }, submitted: '17 из 18', avg: '3,8', note: 'личное время у 1' })
    expect(by('Тригонометрия').actions).toEqual([{ kind: 'queue', label: 'Проверка', topicId: 'tr' }])
    expect(by('Производные')).toMatchObject({ status: { text: 'проверена', tone: 'done' }, avg: '4,1' })
    expect(by('План')).toMatchObject({ status: { text: 'запланирована' }, submitted: '—' })
    expect(by('План').actions[0]).toMatchObject({ kind: 'topic', label: 'Окно темы' })
    expect(by('Пробник №5').actions).toEqual([{ kind: 'mock', label: 'Настройка', to: '/mock-exams/p5?tab=setup' }])
    expect(by('Пробник №4')).toMatchObject({ status: { text: 'проверен' }, submitted: '14 из 18', avg: '63' })
    expect(by('Пробник №4').actions).toEqual([{ kind: 'mock', label: 'Таблица', to: '/mock-exams/p4?tab=table' }])
  })

  it('идущий пробник — «Кто пишет» ведёт в монитор', () => {
    const s = { ...summary, mocks: [{ ...summary.mocks[0], status: 'live' as const, writing: 11 }] }
    const row = teacherBlocks(s, NOW)[0].rows[0]
    expect(row.status.text).toBe('идёт · пишут 11')
    expect(row.actions).toEqual([{ kind: 'mock', label: 'Кто пишет', to: '/mock-exams/p5?tab=works' }])
  })

  it('шаблон курса: только список работ, без статистики', () => {
    const s = { ...summary, isTemplate: true, mocks: [] }
    const blocks = teacherBlocks(s, NOW)
    expect(blocks.every(b => b.summary === '')).toBe(true)
    const r = blocks.flatMap(b => b.rows)[0]
    expect(r).toMatchObject({ when: '—', submitted: '—', avg: '—' })
    expect(r.actions).toEqual([{ kind: 'topic', label: 'Окно темы', topicId: r.key.replace('work:', '') }])
  })
})
