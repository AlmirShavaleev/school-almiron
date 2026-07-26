import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CourseSelector } from '@/components/CourseSelector'
import type { MyCourseMembership } from '@/hooks/useMyCourseMemberships'

const singleCourse: MyCourseMembership[] = [
  {
    courseId: 'course-1',
    title: 'Физика ЕГЭ',
    subject: 'physics',
    examType: 'ege',
    groups: [{ groupId: 'group-1', groupTitle: 'Индивидуально · Иван', groupType: 'individual' }],
    primaryGroupId: 'group-1',
  },
]

const twoCourses: MyCourseMembership[] = [
  ...singleCourse,
  {
    courseId: 'course-2',
    title: 'Математика ЕГЭ',
    subject: 'math',
    examType: 'ege',
    groups: [{ groupId: 'group-2', groupTitle: 'Группа выходного дня', groupType: 'group' }],
    primaryGroupId: 'group-2',
  },
]

describe('CourseSelector', () => {
  it('renders nothing when there are no memberships', () => {
    const { container } = render(<CourseSelector courses={[]} onOpenGroup={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a compact clickable card for a single course/group and opens it', () => {
    const onOpenGroup = vi.fn()
    render(<CourseSelector courses={singleCourse} onOpenGroup={onOpenGroup} />)

    expect(screen.getByText('Физика ЕГЭ')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Физика ЕГЭ'))
    expect(onOpenGroup).toHaveBeenCalledWith('group-1')
  })

  it('deduplicates by course and opens the correct group from the dropdown', () => {
    const onOpenGroup = vi.fn()
    render(<CourseSelector courses={twoCourses} onOpenGroup={onOpenGroup} />)

    expect(screen.getByText(/2 курса · 2 групп/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/2 курса · 2 групп/))

    expect(screen.getByText('Физика ЕГЭ')).toBeInTheDocument()
    expect(screen.getByText('Математика ЕГЭ')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Группа выходного дня'))
    expect(onOpenGroup).toHaveBeenCalledWith('group-2')
  })
})
