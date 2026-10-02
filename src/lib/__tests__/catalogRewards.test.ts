import { describe, expect, it } from 'vitest'
import {
  awardChips, checkErrorText, forecastChangeText, milestoneView, normalizeCatalogRules, normalizeCheckResult,
  normalizeDailyTask, normalizePracticeState, normalizeWeeklyGoal, numbersText, toastText, totalAward,
  weeklyProgressText, zoneRangeText, zoneRule, ZONE_LABEL,
} from '@/lib/catalogRewards'

/**
 * §256. Каталог поднимает прогноз — клиентская часть. Все числа (пороги
 * зон, награды, вехи) приходят из базы (`catalog_reward_rules`), вердикт и
 * зону номера считает база; здесь проверяется, что клиент честно показывает
 * ровно то, что она ответила, и не держит своих порогов.
 */
const RULES_RAW = {
  window_days: 60, low: 0.4, high: 0.7, daily_task: 10, weekly_goal: 40, weekly_target: 10, checks_per_minute: 30,
  zones: [
    { key: 'growth', per_task: 5, milestones: [{ at: 20, bonus: 50 }, { at: 10, bonus: 30 }, { at: 30, bonus: 80 }] },
    { key: 'progress', per_task: 3, milestones: [{ at: 10, bonus: 20 }, { at: 20, bonus: 30 }, { at: 30, bonus: 40 }] },
    { key: 'confident', per_task: 1, milestones: [{ at: 10, bonus: 5 }, { at: 20, bonus: 5 }, { at: 30, bonus: 5 }] },
    { key: 'unknown', per_task: 99 },
  ],
}
const RULES = normalizeCatalogRules(RULES_RAW)!

describe('правила наград — из ответа базы', () => {
  it('разбор: зоны по таблице владельца, вехи по порядку, лишнее отброшено', () => {
    expect(RULES.zones.map(z => [z.key, z.perTask])).toEqual([['growth', 5], ['progress', 3], ['confident', 1]])
    expect(RULES.zones[0].milestones).toEqual([{ at: 10, bonus: 30 }, { at: 20, bonus: 50 }, { at: 30, bonus: 80 }])
    expect([RULES.dailyTask, RULES.weeklyGoal, RULES.windowDays]).toEqual([10, 40, 60])
    expect(normalizeCatalogRules(null)).toBeNull()
    expect(normalizeCatalogRules({ zones: [] })).toBeNull()
  })

  it('границы 40 % / 70 % — подписи из порогов базы; поменяли в базе — поменялась подпись', () => {
    expect(zoneRangeText(RULES, 'growth')).toBe('верно меньше 40 %')
    expect(zoneRangeText(RULES, 'progress')).toBe('40–70 %')
    expect(zoneRangeText(RULES, 'confident')).toBe('больше 70 %')
    expect(zoneRangeText({ low: 0.35, high: 0.8 }, 'progress')).toBe('35–80 %')
    expect(ZONE_LABEL).toEqual({ growth: 'зона роста', progress: 'в процессе', confident: 'уверенно' })
  })
})

describe('вехи 10 / 20 / 30', () => {
  const growth = zoneRule(RULES, 'growth')
  it('до первой вехи: «3 из 10 → бонус +30», доля пути', () => {
    const v = milestoneView(growth, 3)
    expect(v).toMatchObject({ next: 10, bonus: 30, text: '3 из 10 → бонус +30' })
    expect(v.ratio).toBeCloseTo(0.3, 9)
    expect(v.ticks.map(t => t.reached)).toEqual([false, false, false])
  })
  it('после вехи 10 путь считается от неё: 15 → «15 из 20 → бонус +50», половина пути', () => {
    const v = milestoneView(growth, 15)
    expect(v).toMatchObject({ next: 20, bonus: 50, text: '15 из 20 → бонус +50' })
    expect(v.ratio).toBeCloseTo(0.5, 9)
    expect(v.ticks.map(t => t.reached)).toEqual([true, false, false])
  })
  it('ровно на вехе — она пройдена; все пройдены — «34 задачи — все вехи пройдены»', () => {
    expect(milestoneView(growth, 10).ticks[0].reached).toBe(true)
    expect(milestoneView(growth, 10).next).toBe(20)
    expect(milestoneView(growth, 34)).toMatchObject({ next: null, ratio: 1, text: '34 задачи — все вехи пройдены' })
  })
  it('бонус вехи — по зоне номера сейчас: «уверенно» +5', () => {
    expect(milestoneView(zoneRule(RULES, 'confident'), 2).text).toBe('2 из 10 → бонус +5')
    expect(milestoneView(zoneRule(RULES, 'progress'), 12).text).toBe('12 из 20 → бонус +30')
  })
})

describe('ответ проверки', () => {
  const counted = normalizeCheckResult({
    verdict: 'correct', already_solved: false, counted: true, revealed_before: false, subject: 'math', n: 6,
    zone: 'growth', share: 0.25, points: 5, solved: 10, milestone_bonus: 30, daily_bonus: 10, weekly_bonus: 0,
    weekly: { progress: 4, target: 10 }, answer_html: '<p>7</p>',
  })!

  it('верно и засчитано: фишки «+5 баллов школы», веха, задача дня; сумма', () => {
    expect(awardChips(counted)).toEqual(['+5 баллов школы', '10 задач по №6 · +30', 'задача дня +10'])
    expect(totalAward(counted)).toBe(45)
    expect(counted.weekly).toEqual({ progress: 4, target: 10 })
    expect(counted.answerHtml).toBe('<p>7</p>')
  })

  it('неверно / раскрыт / повтор — ни баллов, ни фишек', () => {
    const wrong = normalizeCheckResult({ verdict: 'wrong', counted: false, points: 0, answer_html: null })!
    expect(awardChips(wrong)).toEqual([])
    expect(wrong.answerHtml).toBeNull()
    const revealed = normalizeCheckResult({ verdict: 'correct', counted: false, revealed_before: true, points: 0 })!
    expect(revealed.revealedBefore).toBe(true)
    expect(awardChips(revealed)).toEqual([])
    const again = normalizeCheckResult({ verdict: 'correct', already_solved: true, counted: false })!
    expect(again.alreadySolved).toBe(true)
    expect(totalAward(again)).toBe(0)
    expect(normalizeCheckResult({ verdict: 'maybe' })).toBeNull()
  })

  it('«+1 к прогнозу»: целое — округлённо, меньше 1 — с запятой, данных мало — «засчитано в прогноз»', () => {
    expect(forecastChangeText({ ready: true, delta: 1.2, score: 56 })).toBe('+1 к прогнозу')
    expect(forecastChangeText({ ready: true, delta: 0.46, score: 56 })).toBe('+0,5 к прогнозу')
    expect(forecastChangeText({ ready: true, delta: 0.01, score: 56 })).toBe('засчитано в прогноз')
    expect(forecastChangeText({ ready: false, delta: 0, score: 20 })).toBe('засчитано в прогноз')
  })

  it('тост: «+45 баллов школы · задача дня решена · прогноз 56»', () => {
    expect(toastText(counted, { ready: true, delta: 1, score: 55.6 })).toBe('+45 баллов школы · задача дня решена · прогноз 56')
    expect(toastText(counted, null)).toBe('+45 баллов школы · задача дня решена')
  })

  it('ошибки базы — по-человечески (лимит, непроверяемая, пусто)', () => {
    expect(checkErrorText('RATE_LIMIT: не больше 30 проверок в минуту')).toBe('Слишком много проверок подряд — подождите минуту')
    expect(checkErrorText('NOT_CHECKABLE: …')).toBe('У этой задачи нет короткого ответа для проверки')
    expect(checkErrorText('EMPTY_ANSWER: …')).toBe('Введите ответ')
    expect(checkErrorText('сеть')).toBe('Не удалось проверить ответ. Попробуйте ещё раз')
  })
})

describe('состояние страницы каталога', () => {
  it('номер, зона, задачи; незнакомая зона — «зона роста»', () => {
    const s = normalizePracticeState({
      rules: RULES_RAW,
      number: { subject: 'math', n: 6, title: 'Простейшие уравнения', zone: 'growth', share: 0.25, solved: 3 },
      tasks: [
        { task_id: 't1', checkable: true, attempts: 2, last_verdict: 'wrong', solved: false, counted: false, revealed: true },
        { task_id: 't2', checkable: false },
        { nope: 1 },
      ],
    })!
    expect(s.number).toMatchObject({ n: 6, zone: 'growth', solved: 3 })
    expect(s.tasks.t1).toMatchObject({ checkable: true, attempts: 2, lastVerdict: 'wrong', revealed: true })
    expect(s.tasks.t2.checkable).toBe(false)
    expect(Object.keys(s.tasks)).toEqual(['t1', 't2'])
    expect(normalizePracticeState({ number: { subject: 'math', n: 4, zone: '???' } })!.number!.zone).toBe('growth')
  })
})

describe('задача дня и цель недели', () => {
  it('задача дня: номер, зона, условие и картинки; без задачи — null', () => {
    const d = normalizeDailyTask({
      day: '2026-10-02', subject: 'math', n: 6, zone: 'growth', bonus: 10, section_id: 's6', title: 'Простейшие уравнения',
      task: { id: 't2', statement_html: '<p>log</p>', subject: 'Математика', exam_type: 'ЕГЭ', assets: [{ id: 'a1', storage_path: 'x/y.png', position: 1 }] },
      attempts: 1, revealed: false, solved: true, done: true,
    })!
    expect(d).toMatchObject({ n: 6, bonus: 10, sectionId: 's6', solved: true, done: true })
    expect(d.task!.assets[0]).toMatchObject({ id: 'a1', storage_path: 'x/y.png' })
    expect(normalizeDailyTask({ day: '2026-10-02', subject: 'math', task: null })).toBeNull()
  })

  it('цель недели: «3 из 10 решено», выполнена — «10 из 10 — бонус +40 получен!»', () => {
    const raw = { week_start: '2026-09-28', week_end: '2026-10-04', subject: 'math', numbers: [6, 7], sections: [{ n: 6, section_id: 's6' }], target: 10, progress: 3, bonus: 40 }
    const g = normalizeWeeklyGoal(raw)!
    expect(weeklyProgressText(g)).toBe('3 из 10 решено')
    expect(g.done).toBe(false)
    const done = normalizeWeeklyGoal({ ...raw, progress: 12 })!
    expect(done.done).toBe(true)
    expect(weeklyProgressText(done)).toBe('10 из 10 — бонус +40 получен!')
    expect(numbersText(g.numbers)).toBe('№6 и №7')
    expect(normalizeWeeklyGoal({ ...raw, numbers: null })).toBeNull()
  })
})
