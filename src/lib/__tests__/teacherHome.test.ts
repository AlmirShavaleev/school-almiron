import { describe, expect, it } from 'vitest'
import { teacherHomeData, teacherHomePeriod, type TeacherGroupRow } from '@/lib/teacherHome'

const member = (student_id: string, joined_at: string, is_active = true) => ({ student_id, joined_at, students: { is_active } })
const result = (student_id: string) => ({ student_id })

const NOW = '2026-11-25T08:00:00Z'
const FROM = '2026-10-26T21:00:00Z'
const BEFORE = '2026-10-26T20:59:59Z'
const group = (data: Partial<TeacherGroupRow>): TeacherGroupRow => ({
  id: 'g1', name: '11А', course_id: 'c1', courses: { title: 'Физика' },
  group_students: [], result_exams: [], upcoming_exams: [], ...data,
})

describe('Сводка кабинета учителя', () => {
  it('считает ученика один раз в общих итогах и только действующих участников каждой группы', () => {
    const home = teacherHomeData([
      group({
        group_students: [member('s1', FROM), member('s2', BEFORE), member('s3', NOW, false)],
        result_exams: [{ mock_exam_results: [result('s1'), result('s3'), result('left')] }, { mock_exam_results: [result('s1')] }],
      }),
      group({
        id: 'g2',
        group_students: [member('s1', NOW), member('s4', NOW)],
        result_exams: [{ mock_exam_results: [result('s1'), result('s4')] }],
      }),
    ], FROM, NOW)

    expect(home).toMatchObject({ students: 3, enrolled: 2, withResult: 2 })
    expect(home.groups.map(({ students, enrolled, withResult }) => [students, enrolled, withResult])).toEqual([[2, 1, 1], [2, 2, 2]])
  })

  it('сортирует ближайшие пробники по времени из разных групп', () => {
    const home = teacherHomeData([
      group({ upcoming_exams: [{ id: 'late', title: 'Поздний', starts_at: '2026-11-27T09:30:00Z' }] }),
      group({ id: 'g2', upcoming_exams: [{ id: 'early', title: 'Ранний', starts_at: '2026-11-26T09:30:00Z' }] }),
    ], FROM, NOW)
    expect(home.upcoming.map(exam => exam.id)).toEqual(['early', 'late'])
  })

  it('считает 30 календарных дней по Москве даже на границе суток', () => {
    expect(teacherHomePeriod(new Date('2026-11-24T21:01:00Z'))).toMatchObject({
      today: '2026-11-25', from: '2026-10-26T21:00:00.000Z',
    })
  })
})
