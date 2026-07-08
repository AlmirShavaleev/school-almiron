import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mergeTeacherScopedHomeworks } from '../useHomeworks'

describe('teacher homework scope', () => {
  it('includes homework created by another teacher when it belongs to a group course', () => {
    const foreignCreatorHomework = { id: 'course-hw', created_by: 'teacher-a', due_date: '2026-07-02' }
    expect(mergeTeacherScopedHomeworks([], [foreignCreatorHomework])).toContainEqual(foreignCreatorHomework)
  })

  it('does not include homework outside own or group-course results', () => {
    const own = { id: 'own', created_by: 'teacher-b' }
    const otherGroup = { id: 'other-group', created_by: 'teacher-c' }
    expect(mergeTeacherScopedHomeworks([own], []).map(hw => hw.id)).toEqual(['own'])
    expect(mergeTeacherScopedHomeworks([own], []).map(hw => hw.id)).not.toContain(otherGroup.id)
  })

  it('deduplicates homework present in both scopes', () => {
    const homework = { id: 'same', due_date: '2026-07-01' }
    expect(mergeTeacherScopedHomeworks([homework], [homework])).toHaveLength(1)
  })

  it('surfaces query errors in both list and review modal', () => {
    const hook = readFileSync('src/hooks/useHomeworks.ts', 'utf8')
    const page = readFileSync('src/pages/HomeworksPage.tsx', 'utf8')
    const modal = readFileSync('src/components/modals/ReviewHomeworkModal.tsx', 'utf8')
    expect(hook).toContain("console.error('Не удалось загрузить домашние задания'")
    expect(page).toContain('role="alert"')
    expect(modal).toContain("console.error('Не удалось загрузить сдачи домашнего задания'")
    expect(modal).toContain('loadError')
  })

  it('scopes submissions to students in the teacher groups', () => {
    const hook = readFileSync('src/hooks/useHomeworks.ts', 'utf8')
    expect(hook).toContain(".select('course_id, group_students(student_id)')")
    expect(hook).toContain(".in('student_id', studentIds)")
  })
})
