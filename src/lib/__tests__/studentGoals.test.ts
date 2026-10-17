import { describe, expect, it } from 'vitest'
import {
  examGoalLabel, goalBasis, parseGoalNumbers, parseWeeklyGoals, weeklyGoalTitle, weeklyProgressLabel, weeklySummaryLabel,
} from '@/lib/studentGoals'
import { STUDENT_PREF_KEYS, studentPrefsFrom } from '@/lib/studentNotifGroups'

// Цели в два уровня и уведомления ученика (письмо ЛК_стиль_настройки_ученика.md, правка 16.10 17:45).

describe('цели недели (ставит сам ученик)', () => {
  it('подписи трёх стандартных целей', () => {
    expect(weeklyGoalTitle('days', 4)).toBe('Заходить на платформу 4 дня в неделю')
    expect(weeklyGoalTitle('days', 5)).toBe('Заходить на платформу 5 дней в неделю')
    expect(weeklyGoalTitle('topics', 3)).toBe('Пройти 3 темы за неделю')
    expect(weeklyGoalTitle('tasks', 20)).toBe('Решить 20 задач в тренировке')
  })

  it('прогресс «3 из 5 дней»; сверх цели не показываем', () => {
    expect(weeklyProgressLabel({ kind: 'days', progress: 3, target: 5 })).toBe('3 из 5 дней')
    expect(weeklyProgressLabel({ kind: 'topics', progress: 1, target: 2 })).toBe('1 из 2 тем')
    expect(weeklyProgressLabel({ kind: 'tasks', progress: 40, target: 30 })).toBe('30 из 30 задач')
    expect(weeklySummaryLabel(1, 3)).toBe('1 из 3')
    // Ученик целей не ставил — в колонке пусто (письмо 16.10 17:45).
    expect(weeklySummaryLabel(0, 0)).toBe('')
  })

  it('числа целей — только из стандартного набора', () => {
    expect(parseGoalNumbers({ days: 4, topics: 7, tasks: 30 })).toEqual({ days: 4, topics: null, tasks: 30 })
    expect(parseWeeklyGoals([{ kind: 'days', target: 4, progress: 2, done: false }, { kind: 'weird' }])).toHaveLength(1)
  })
})

describe('цель на экзамен (ставит ученик)', () => {
  it('«Цель: физика 80+» и основание: пробник важнее курса', () => {
    expect(examGoalLabel({ subject: 'physics', goal: 80 })).toBe('Цель: физика 80+')
    expect(goalBasis({ score: 21, max: 32 }, { done: 5, total: 102 })).toBe('последний пробник: 21 из 32 первичных')
    expect(goalBasis(null, { done: 23, total: 102 })).toBe('пройдено 23 из 102 тем курса')
    expect(goalBasis(null, { done: 0, total: 21 })).toBe('пройдено 0 из 21 темы курса')
    expect(goalBasis(null, null)).toBeNull()
  })
})

describe('уведомления ученика', () => {
  it('нет занятий, достижений, «платежей» и почтового переключателя', () => {
    for (const k of ['lesson', 'lesson_changed', 'badge', 'payment', 'email']) expect(STUDENT_PREF_KEYS).not.toContain(k)
    expect(STUDENT_PREF_KEYS).toEqual(expect.arrayContaining(['homework', 'checked', 'overdue', 'remind_mock_tomorrow', 'telegram_variant_assignments']))
  })

  it('нет строки настроек — всё включено; сохранённое «выкл» читается', () => {
    expect(studentPrefsFrom(null).homework).toBe(true)
    expect(studentPrefsFrom({ homework: false }).homework).toBe(false)
  })
})
