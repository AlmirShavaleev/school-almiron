import { describe, expect, it } from 'vitest'
import { examGoalLabel, goalBasis, goalProgressLabel, goalTitle, parseRegularGoals, weeklySummaryLabel } from '@/lib/studentGoals'
import { STUDENT_PREF_KEYS, studentPrefsFrom } from '@/lib/studentNotifGroups'

// Цели в два уровня и уведомления ученика (письмо ЛК_стиль_настройки_ученика.md, 16.10).

describe('цели', () => {
  const g = { subject: 'physics' as const, numbers: [3, 7], topicTitles: [] as string[], target: 10 }

  it('подписи целей недели по типам', () => {
    expect(goalTitle({ ...g, kind: 'numbers' })).toBe('Решить 10 задач № 3, 7 · физика')
    expect(goalTitle({ ...g, kind: 'topics', topicTitles: ['Импульс'], target: 1 })).toBe('Пройти тему «Импульс»')
    expect(goalTitle({ ...g, kind: 'topics', topicTitles: ['А', 'Б'], target: 2 })).toBe('Пройти 2 темы курса')
    expect(goalTitle({ ...g, kind: 'tasks', subject: null, target: 21 })).toBe('Решить 21 задачу в тренировке')
    expect(goalTitle({ ...g, kind: 'days', subject: null, target: 4 })).toBe('Заниматься 4 дня в неделю')
  })

  it('прогресс сверх цели не показываем; сводка для преподавателя', () => {
    expect(goalProgressLabel({ progress: 14, target: 10 })).toBe('10 из 10')
    expect(weeklySummaryLabel(1, 3)).toBe('1 из 3')
    expect(weeklySummaryLabel(0, 0)).toBe('нет целей')
  })

  it('цель на экзамен и основание оценки: пробник важнее курса', () => {
    expect(examGoalLabel({ subject: 'physics', goal: 80 })).toBe('Цель: физика 80+')
    expect(goalBasis({ score: 21, max: 32 }, { done: 5, total: 102 })).toBe('последний пробник: 21 из 32 первичных')
    expect(goalBasis(null, { done: 23, total: 102 })).toBe('пройдено 23 из 102 тем курса')
    expect(goalBasis(null, { done: 0, total: 21 })).toBe('пройдено 0 из 21 темы курса')
    expect(goalBasis(null, null)).toBeNull()
  })

  it('ответ базы: неизвестный тип отбрасывается', () => {
    const r = parseRegularGoals([
      { id: 'a', kind: 'days', target: 4, progress: 2, done: false },
      { id: 'b', kind: 'weird', target: 1 },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'a', kind: 'days', target: 4, progress: 2, done: false, subject: null })
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
