import { describe, expect, it } from 'vitest'
import { teacherHomeData, teacherHomePeriod, type TeacherGroupRow } from '@/lib/teacherHome'

const group = (data: Partial<TeacherGroupRow>): TeacherGroupRow => ({
  name: '11А', upcoming_exams: [], ...data,
})

describe('Ближайшие пробники в кабинете учителя', () => {
  it('сортирует ближайшие пробники по времени из разных групп', () => {
    const home = teacherHomeData([
      group({ upcoming_exams: [{ id: 'late', title: 'Поздний', starts_at: '2026-11-27T09:30:00Z' }] }),
      group({ name: '11Б', upcoming_exams: [{ id: 'early', title: 'Ранний', starts_at: '2026-11-26T09:30:00Z' }] }),
    ])
    expect(home.upcoming.map(({ id, groupName }) => [id, groupName])).toEqual([['early', '11Б'], ['late', '11А']])
  })

  it('сохраняет московскую дату и интервал в семь дней', () => {
    expect(teacherHomePeriod(new Date('2026-11-24T21:01:00Z'))).toMatchObject({
      today: '2026-11-25', now: '2026-11-24T21:01:00.000Z', nextWeek: '2026-12-01T21:01:00.000Z',
    })
  })
})
