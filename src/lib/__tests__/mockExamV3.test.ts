/**
 * §228. Пробник v3: статусы работ, статус пробника, вывод, «следующая»,
 * проверка по номерам, таймлайн формы, раздел ученика.
 */
import { describe, expect, it } from 'vitest'
import {
  assignProblems, deltaToPrevious, examStage, keyToPoints, markCounts, missingNote, mskMoment, mskParts,
  nextToReview, notifyCheckedIds, readiness, reviewPosition, reviewTotals, shortName, statusLook, studentTimeline,
  taskMark, untilLabel, windowOf, workRows, worksSummary, type WorkInput,
} from '@/lib/mockExamV3'

const TPL = { max_points: [1, 1, 1, 2, 3], part1_last: 3, score_scale: null }
const MIN = 60_000
const T0 = Date.parse('2026-10-03T07:00:00.000Z') // 10:00 МСК
const WIN = windowOf({ starts_at: new Date(T0).toISOString(), duration_minutes: 235, photo_grace_minutes: 15 })
const AFTER = T0 + 5 * 60 * MIN

function w(id: string, name: string, over: Partial<WorkInput> = {}): WorkInput {
  return { id, name, profileId: `p-${id}`, points: [null, null, null, null, null], auto: [false, false, false, false, false], sheet: null, photos: 0, result: null, ...over }
}
const sent = (score: number, p1: number, p2: number) => ({
  student_id: 'x', score, part1_score: p1, part2_score: p2,
  notified_at: '2026-10-03T12:00:00Z', notified_score: score, notified_part1_score: p1, notified_part2_score: p2,
})
const ready = (score: number, p1: number, p2: number) => ({ ...sent(score, p1, p2), notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null })

describe('окно', () => {
  it('конец = начало + длительность, фото — ещё 15 минут', () => {
    expect(WIN.ends_at).toBe('2026-10-03T10:55:00.000Z')
    expect(WIN.photos_until).toBe('2026-10-03T11:10:00.000Z')
    expect(windowOf({ starts_at: null })).toEqual({ starts_at: null, ends_at: null, photos_until: null })
  })
})

describe('статус работы — «проверено» = балл по каждому номеру', () => {
  const sheet = { answers: ['1', '2', ''], submitted_at: new Date(T0 + 200 * MIN).toISOString() }
  it('первая часть поставлена ключом, вторая не тронута — «ждёт проверки», а не «частично»', () => {
    const [r] = workRows([w('a', 'Гарипов Тимур', { sheet, photos: 4, points: [1, 1, 0, null, null], auto: [true, true, true, false, false] })], TPL, WIN, AFTER)
    expect(r.status).toBe('waiting')
    expect(r.p1).toEqual({ got: 2, of: 3 })
    expect(r.p2).toBeNull()
    expect(statusLook(r).label).toBe('ждёт проверки')
  })
  it('во второй части есть балл, но не по всем — «проверено частично · №5 не оценено»', () => {
    const [r] = workRows([w('a', 'А', { sheet, points: [1, 1, 0, 2, null], auto: [true, true, true, false, false] })], TPL, WIN, AFTER)
    expect(r.status).toBe('partial')
    expect(statusLook(r)).toMatchObject({ label: 'проверено частично', note: '№5 не оценено', mark: 'part' })
    expect(r.canNotifyOne).toBe(false)
  })
  it('ручная правка первой части тоже делает работу «частично проверенной»', () => {
    const [r] = workRows([w('a', 'А', { sheet, points: [1, 0, 0, null, null], auto: [true, false, true, false, false] })], TPL, WIN, AFTER)
    expect(r.status).toBe('partial')
  })
  it('все номера — «проверено»; «Уведомить» одному — пока итог не отправлен', () => {
    const [r] = workRows([w('a', 'А', { sheet, points: [1, 1, 0, 2, 1], result: ready(5, 2, 3) })], TPL, WIN, AFTER)
    expect(r.status).toBe('checked')
    expect(r.canNotifyOne).toBe(true)
    const [s] = workRows([w('a', 'А', { sheet, points: [1, 1, 0, 2, 1], result: sent(5, 2, 3) })], TPL, WIN, AFTER)
    expect(s.canNotifyOne).toBe(false)
    expect(s.notify.kind).toBe('sent')
    const [c] = workRows([w('a', 'А', { sheet, points: [1, 1, 0, 2, 1], result: { ...sent(4, 2, 2), score: 5, part2_score: 3 } })], TPL, WIN, AFTER)
    expect(c.notify.kind).toBe('changed')
    expect(c.canNotifyOne).toBe(true)
  })
  it('без учётной записи «Уведомить» недоступно', () => {
    const [r] = workRows([w('a', 'А', { profileId: null, sheet, points: [1, 1, 0, 2, 1], result: ready(5, 2, 3) })], TPL, WIN, AFTER)
    expect(r.canNotifyOne).toBe(false)
  })
  it('окно закрыто, ничего не пришло — «не писал»; пустой бланк «открыл и ушёл» — тоже', () => {
    const rows = workRows([w('a', 'А'), w('b', 'Б', { sheet: { answers: ['', '', ''], submitted_at: null } })], TPL, WIN, AFTER)
    expect(rows.map(r => r.status)).toEqual(['absent', 'absent'])
  })
  it('во время окна: открывал — «пишет сейчас», нет — «не заходил», сдал — «ждёт проверки»', () => {
    const during = T0 + 60 * MIN
    const rows = workRows([
      w('a', 'А', { sheet: { answers: [null, null, null], submitted_at: null } }),
      w('b', 'Б'),
      w('c', 'В', { sheet: { answers: ['1', null, null], submitted_at: new Date(T0 + 30 * MIN).toISOString() } }),
    ], TPL, WIN, during)
    expect(rows.map(r => r.status)).toEqual(['writing', 'not_opened', 'waiting'])
  })
  it('до начала — «ещё не начался»; пробник без окна и без баллов — «баллов нет»', () => {
    expect(workRows([w('a', 'А')], TPL, WIN, T0 - MIN)[0].status).toBe('not_started')
    expect(workRows([w('a', 'А')], TPL, null, AFTER)[0].status).toBe('empty')
  })
})

describe('статус пробника и вывод', () => {
  const sheet = { answers: ['1'], submitted_at: new Date(T0 + 100 * MIN).toISOString() }
  const rowsAt = (now: number, list: WorkInput[]) => workRows(list, TPL, WIN, now)
  it('черновик → назначен → идёт (вместе с догрузкой фото) → проверка → отправлено', () => {
    expect(examStage(null, [], AFTER)).toBe('draft')
    expect(examStage(WIN, [], T0 - MIN)).toBe('scheduled')
    expect(examStage(WIN, [], T0 + MIN)).toBe('running')
    expect(examStage(WIN, [], T0 + 240 * MIN)).toBe('running')
    const checking = rowsAt(AFTER, [w('a', 'А', { sheet }), w('b', 'Б', { sheet, points: [1, 1, 1, 2, 3], result: sent(8, 3, 5) })])
    expect(examStage(WIN, checking, AFTER)).toBe('checking')
    const done = rowsAt(AFTER, [w('a', 'А'), w('b', 'Б', { sheet, points: [1, 1, 1, 2, 3], result: sent(8, 3, 5) })])
    expect(examStage(WIN, done, AFTER)).toBe('sent')
  })
  it('«Сдали 2 из 3, проверено 1. Ждут проверки 1 работа. Не писал: Зайцев Р.»', () => {
    const rows = rowsAt(AFTER, [
      w('a', 'Гарипов Тимур', { sheet }),
      w('b', 'Белов Артём', { sheet, points: [1, 1, 1, 2, 3], result: ready(8, 3, 5) }),
      w('c', 'Зайцев Роман'),
    ])
    expect(worksSummary('checking', rows, WIN, '11А')).toBe('Сдали 2 из 3, проверено 1. Ждут проверки 1 работа. Не писал: Зайцев Р.')
  })
  it('всё проверено — «осталось уведомить N»', () => {
    const rows = rowsAt(AFTER, [w('b', 'Белов Артём', { sheet, points: [1, 1, 1, 2, 3], result: ready(8, 3, 5) })])
    expect(worksSummary('checking', rows, WIN, '11А')).toContain('Все работы проверены — осталось уведомить 1.')
  })
  it('назначен — дата, время и группа', () => {
    expect(worksSummary('scheduled', rowsAt(T0 - MIN, [w('a', 'А'), w('b', 'Б')]), WIN, '11А')).toBe('Назначен на 3 октября, 10:00 (МСК) · группа 11А, 2 ученика.')
  })
  it('короткое имя', () => {
    expect(shortName('Зайцев Роман Петрович')).toBe('Зайцев Р.')
    expect(shortName('Зайцев')).toBe('Зайцев')
  })
})

describe('«Следующая работа», «работа N из M», «Уведомить всех проверенных»', () => {
  const sheet = { answers: ['1'], submitted_at: new Date(T0 + 100 * MIN).toISOString() }
  const rows = workRows([
    w('a', 'А', { sheet }),
    w('b', 'Б', { sheet, points: [1, 1, 1, 2, 3], result: ready(8, 3, 5) }),
    w('c', 'В'),
    w('d', 'Г', { sheet, points: [1, 1, 1, 2, null] }),
    w('e', 'Д', { sheet, points: [1, 1, 1, 2, 3], result: sent(8, 3, 5) }),
  ], TPL, WIN, AFTER)
  it('следующая непроверенная после открытой, по кругу, себя не предлагает', () => {
    expect(nextToReview(rows, null)?.id).toBe('a')
    expect(nextToReview(rows, 'a')?.id).toBe('d')
    expect(nextToReview(rows, 'd')?.id).toBe('a')
    expect(nextToReview(rows, 'b')?.id).toBe('d')
    expect(nextToReview(rows.filter(r => r.id !== 'd'), 'a')).toBeNull()
  })
  it('позиция — среди работ, которые можно проверять («не писал» не считается)', () => {
    expect(reviewPosition(rows, 'd')).toEqual({ n: 3, of: 4 })
    expect(reviewPosition(rows, 'c')).toBeNull()
  })
  it('уведомить всех проверенных — только проверенные с неотправленным итогом', () => {
    expect(notifyCheckedIds(rows)).toEqual(['b'])
  })
})

describe('проверка работы', () => {
  it('метка номера: нет балла — не сверено, 0 — неверно, максимум — верно, иначе частично', () => {
    expect([taskMark(null, 3), taskMark(0, 3), taskMark(3, 3), taskMark(2, 3)]).toEqual(['unk', 'bad', 'ok', 'part'])
    expect(markCounts([1, 0, null, 1, 3], TPL.max_points)).toMatchObject({ ok: 2, bad: 1, unk: 1, part: 1 })
  })
  it('итог и «ещё не оценено»', () => {
    expect(missingNote([1, 1, 1, 2, null], 5)).toBe('№5 ещё не оценено')
    expect(missingNote([1, null, 1, null, null], 5)).toBe('№2, №4, №5 ещё не оценены')
    expect(missingNote([1, 1, 1, 2, 3], 5)).toBe('все номера оценены')
    expect(reviewTotals([1, 1, 0, 2, null], { ...TPL, score_scale: [0, 5, 10, 15, 20, 25, 30, 35, 40] })).toEqual({ primary: 4, test: 20, of: 8, complete: false })
  })
  it('цифра ставит балл, только если не больше максимума', () => {
    expect(keyToPoints('2', 3)).toBe(2)
    expect(keyToPoints('4', 3)).toBeNull()
    expect(keyToPoints('a', 3)).toBeNull()
  })
})

describe('форма «Новый пробник»', () => {
  it('дата и время по Москве', () => {
    expect(mskMoment('2026-10-03', '10:00')).toBe('2026-10-03T07:00:00.000Z')
    expect(mskMoment('2026-10-03', '')).toBeNull()
    expect(mskParts('2026-10-03T07:00:00.000Z')).toEqual({ date: '2026-10-03', time: '10:00' })
  })
  it('таймлайн: за час, начало, конец бланка, фото, «потом»', () => {
    const t = studentTimeline('2026-10-03T07:00:00.000Z', 235, 15, T0 - 24 * 60 * MIN)
    expect(t.map(i => `${i.at} ${i.text}`)).toEqual([
      '09:00 Telegram: «Через час — пробник»',
      '10:00 Открываются условие и бланк. Telegram: «Пробник начался»',
      '13:55 Бланк закрывается',
      '14:10 Последний срок догрузить фото',
      'потом Вы проверяете → ученик видит баллы, ключ и решение',
    ])
    expect(t.some(i => i.skipped)).toBe(false)
  })
  it('те же правила, что у триггера §224: меньше часа — «за час» не уйдёт; время прошло — и «начался» тоже', () => {
    const soon = studentTimeline('2026-10-03T07:00:00.000Z', 240, 15, T0 - 40 * MIN)
    expect(soon[0].skipped).toContain('меньше часа')
    expect(soon[1].skipped).toBeUndefined()
    const past = studentTimeline('2026-10-03T07:00:00.000Z', 240, 15, T0 + MIN)
    expect(past[1].skipped).toContain('не уйдёт')
    expect(past[1].text).not.toContain('Telegram')
  })
  it('чек-лист: решение — «можно позже», пустой ключ — не ошибка', () => {
    const r = readiness({ groups: 2, startsIso: 'x', hasCondition: true, hasSolution: false, keyFilled: 11, keyTotal: 12 })
    expect(r.map(i => i.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'later'])
    expect(r[0].text).toBe('Групп: 2 — будет 2 пробника')
    expect(r[3].text).toContain('11 из 12')
  })
  it('«Назначить» требует время; черновик — нет', () => {
    const base = { title: 'П', templateId: 't', groups: 1, startsIso: null, durationOk: true }
    expect(assignProblems({ ...base, draft: false })).toEqual(['Нужны дата и время начала'])
    expect(assignProblems({ ...base, draft: true })).toEqual([])
    expect(assignProblems({ ...base, groups: 0, draft: true })).toEqual(['Выберите группу'])
  })
})

describe('ученик: «Пробники»', () => {
  const list = [
    { id: '1', group: 'g', starts_at: '2026-09-01T07:00:00Z', score: 70 },
    { id: '2', group: 'g', starts_at: '2026-09-20T07:00:00Z', score: 78 },
    { id: '3', group: 'h', starts_at: '2026-09-25T07:00:00Z', score: 50 },
    { id: '4', group: 'g', starts_at: '2026-09-27T07:00:00Z', score: null },
  ]
  it('разница — с прошлым пробником той же группы, у которого итог виден', () => {
    expect(deltaToPrevious(list, '2')).toBe(8)
    expect(deltaToPrevious(list, '1')).toBeNull()
    expect(deltaToPrevious(list, '3')).toBeNull()
    expect(deltaToPrevious(list, '4')).toBeNull()
  })
  it('«через 6 дней», «через 3 ч», «через 40 мин»', () => {
    expect(untilLabel(6 * 24 * 60 * MIN + 5 * MIN)).toBe('через 6 дней')
    expect(untilLabel(3 * 60 * MIN + 5 * MIN)).toBe('через 3 ч')
    expect(untilLabel(40 * MIN)).toBe('через 40 мин')
  })
})
