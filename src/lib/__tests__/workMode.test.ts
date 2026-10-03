import { describe, expect, it } from 'vitest'
import { closedTitle, msUntilEnd, parseWorkMode, workGenitive, workHeadline, workModeAllows, workPath } from '@/lib/workMode'
import { SHOW_ALL, afterSubmitLabel, answersVisible, hiddenAfterSubmitNote, parseVariantAnswerFlags } from '@/lib/variantAnswerFlags'

/**
 * §263. Режим работы ученика: что открыто и что закрыто, пока идёт его
 * проверочная/контрольная или пробник; флажки варианта «после сдачи».
 */
const CLOSES = '2026-10-03T06:30:00.000Z' // 09:30 МСК

const timed = parseWorkMode({
  active: true, kind: 'timed', work_kind: 'check', homework_id: 'hw', topic_id: 'topic-1', course_id: 'c', group_id: 'g1',
  title: 'Движение по окружности', opens_at: '2026-10-03T05:45:00.000Z', closes_at: CLOSES, personal: false, server_now: '2026-10-03T06:22:18.000Z',
})!
const mock = parseWorkMode({
  active: true, kind: 'mock', work_kind: 'mock', mock_exam_id: 'm9', group_id: 'g1', title: 'Пробник №9', closes_at: CLOSES,
})!

describe('режим работы: разбор my_work_mode', () => {
  it('работы нет / ответ не тот → null', () => {
    expect(parseWorkMode({ active: false, server_now: CLOSES })).toBeNull()
    expect(parseWorkMode(null)).toBeNull()
    expect(parseWorkMode({ active: true, kind: 'timed', closes_at: CLOSES })).toBeNull()
    expect(parseWorkMode({ active: true, kind: 'mock', closes_at: CLOSES })).toBeNull()
  })
  it('работа по времени и пробник', () => {
    expect(timed).toMatchObject({ kind: 'timed', workKind: 'check', topicId: 'topic-1', homeworkId: 'hw' })
    expect(mock).toMatchObject({ kind: 'mock', mockExamId: 'm9' })
  })
})

describe('что открыто во время работы', () => {
  it('открыта только страница своей работы (с любым groupId в адресе)', () => {
    expect(workModeAllows('/my-course/g1/topic/topic-1', timed)).toBe(true)
    expect(workModeAllows('/my-course/g2/topic/topic-1/', timed)).toBe(true)
    expect(workModeAllows('/my-course/g1/topic/topic-2', timed)).toBe(false)
    expect(workModeAllows('/catalog', timed)).toBe(false)
    expect(workModeAllows('/catalog/sec/topic/topic-1', timed)).toBe(false)
    expect(workModeAllows('/my-course/g1', timed)).toBe(false)
    expect(workModeAllows('/dashboard', timed)).toBe(false)
    expect(workModeAllows('/student/variants/a1', timed)).toBe(false)
    expect(workModeAllows('/my-course/g1/mock/m9', mock)).toBe(true)
    expect(workModeAllows('/my-course/g1/topic/topic-1', mock)).toBe(false)
  })
  it('«Вернуться к работе» ведёт на страницу работы', () => {
    expect(workPath(timed)).toBe('/my-course/g1/topic/topic-1')
    expect(workPath(mock)).toBe('/my-course/g1/mock/m9')
    expect(workPath({ ...timed, groupId: null })).toBe('/my-course')
  })
  it('«<Раздел> закрыт до HH:MM» — с родом раздела', () => {
    expect(closedTitle('Каталог заданий', timed)).toBe('Каталог заданий закрыт до 09:30')
    expect(closedTitle('Главная', timed)).toBe('Главная закрыта до 09:30')
    expect(closedTitle('Достижения', timed)).toBe('Достижения закрыты до 09:30')
    expect(closedTitle(null, timed)).toBe('Раздел закрыт до 09:30')
  })
  it('полоса: «Идёт проверочная/контрольная/пробник», до конца — по серверу', () => {
    expect(workHeadline(timed)).toBe('Идёт проверочная')
    expect(workHeadline({ workKind: 'control' })).toBe('Идёт контрольная')
    expect(workHeadline(mock)).toBe('Идёт пробник')
    expect(workGenitive(timed)).toBe('проверочной')
    expect(msUntilEnd(timed, Date.parse('2026-10-03T06:22:18.000Z'))).toBe(7 * 60e3 + 42e3)
    expect(msUntilEnd(timed, Date.parse('2026-10-03T07:00:00.000Z'))).toBe(0)
  })
})

describe('флажки варианта «после сдачи»', () => {
  it('нет функции / сбой → показывать всё (как до §263)', () => {
    expect(parseVariantAnswerFlags(null)).toEqual(SHOW_ALL)
    expect(parseVariantAnswerFlags({ show_answers: false, show_solutions: true, work_mode: false }))
      .toEqual({ showAnswers: false, showSolutions: true, workMode: false })
  })
  it('что сказать ученику и показывать ли эталон', () => {
    expect(hiddenAfterSubmitNote(SHOW_ALL)).toBeNull()
    expect(answersVisible(SHOW_ALL)).toBe(true)
    const none = { showAnswers: false, showSolutions: false, workMode: false }
    expect(hiddenAfterSubmitNote(none)).toMatch(/не показывает правильные ответы и разбор/)
    expect(answersVisible(none)).toBe(false)
    expect(hiddenAfterSubmitNote({ showAnswers: true, showSolutions: false, workMode: false })).toMatch(/разбор/)
    const work = { showAnswers: true, showSolutions: true, workMode: true }
    expect(hiddenAfterSubmitNote(work)).toMatch(/идёт проверочная/)
    expect(answersVisible(work)).toBe(false)
  })
  it('подпись у выдачи', () => {
    expect(afterSubmitLabel(true, true)).toBe('ответы и разбор')
    expect(afterSubmitLabel(true, false)).toBe('только ответы')
    expect(afterSubmitLabel(false, true)).toBe('только разбор')
    expect(afterSubmitLabel(false, false)).toBe('ничего не показывать')
    expect(afterSubmitLabel(undefined, null)).toBe('ответы и разбор')
  })
})
