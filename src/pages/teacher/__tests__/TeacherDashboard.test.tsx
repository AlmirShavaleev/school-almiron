import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'
import type { TeacherHomeData } from '@/lib/teacherHome'

const { useHome, useLive, useActivity } = vi.hoisted(() => ({ useHome: vi.fn(), useLive: vi.fn(), useActivity: vi.fn() }))
vi.mock('@/hooks/useTeacherHome', () => ({ useTeacherHome: useHome }))
vi.mock('@/hooks/useMyLiveTimedWorks', () => ({ useMyLiveTimedWorks: useLive }))
vi.mock('@/hooks/useTeacherActivity', () => ({ useTeacherActivity: useActivity }))

const home: TeacherHomeData = {
  students: 21, enrolled: 3, withResult: 14,
  groups: [
    { id: 'g1', name: '11А', courseTitle: 'Физика ЕГЭ', students: 15, enrolled: 2, withResult: 12 },
    { id: 'g2', name: '11Б', courseTitle: 'Математика ЕГЭ', students: 7, enrolled: 1, withResult: 2 },
  ],
  upcoming: [{ id: 'exam-1', title: 'Пробник по физике', groupName: '11А', startsAt: '2026-11-27T09:30:00Z' }],
}

const reload = vi.fn()
const data = { home, today: '2026-11-25', loading: false, error: null, reload, courseIds: null }
const renderPage = () => render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)

describe('Кабинет учителя', () => {
  beforeEach(() => {
    useHome.mockReturnValue(data)
    useLive.mockReturnValue({ works: [], serverNow: null })
    useActivity.mockReturnValue({ data: null, loading: false, failed: false, reload: vi.fn() })
    reload.mockClear()
  })

  it('показывает общую сводку и ссылки на учеников и группы', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Кабинет учителя' })).toBeInTheDocument()
    expect(screen.getByText('Среда, 25 ноября')).toBeInTheDocument()
    const overview = screen.getByRole('region', { name: 'Сводка по ученикам' })
    expect(within(overview).getByText('21')).toBeInTheDocument()
    expect(within(overview).getByText('3')).toBeInTheDocument()
    expect(within(overview).getByText('14')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ученики' })).toHaveAttribute('href', '/students')
    const group = screen.getByRole('link', { name: /11А Физика ЕГЭ/ })
    expect(group).toHaveAttribute('href', '/groups/g1')
    expect(within(group).getByText('15')).toBeInTheDocument()
    expect(within(group).getByText('12')).toBeInTheDocument()
  })

  it('главная без очереди и персональных предупреждений, ближайший пробник открывается из расписания', () => {
    renderPage()
    expect(screen.queryByText(/на проверке|просели|не сдали|напомнить/i)).not.toBeInTheDocument()
    const upcoming = screen.getByRole('link', { name: /Пробник по физике/ })
    expect(upcoming).toHaveAttribute('href', '/mock-exams/exam-1')
    expect(upcoming).toHaveTextContent('27 ноября, 12:30 МСК · 11А')
  })

  it('пустая сводка показывает отсутствие групп и скрывает пустое расписание', () => {
    useHome.mockReturnValue({ ...data, home: { groups: [], students: 0, enrolled: 0, withResult: 0, upcoming: [] } })
    renderPage()
    expect(screen.getByText('Активных учебных групп пока нет.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ближайшие пробники' })).not.toBeInTheDocument()
  })

  it('ошибка загрузки даёт повторить запрос', () => {
    useHome.mockReturnValue({ ...data, home: null, error: 'Не удалось загрузить сводку.' })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить сводку.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('режим учителя показывает монитор только для своих курсов', () => {
    useHome.mockReturnValue({ ...data, courseIds: ['mine'] })
    const work = { topicId: 'topic', kind: 'check', groupName: null, opensAt: null, closesAt: null, personalLive: 1 }
    useLive.mockReturnValue({ works: [
      { ...work, homeworkId: 'w1', courseId: 'mine', title: 'Контрольная своей группы' },
      { ...work, homeworkId: 'w2', courseId: 'others', title: 'Чужая контрольная' },
    ], serverNow: null })
    renderPage()
    expect(screen.getByText('Контрольная своей группы')).toBeInTheDocument()
    expect(screen.queryByText('Чужая контрольная')).not.toBeInTheDocument()
  })

  it('показывает активность своих курсов с недельными итогами и охватом', () => {
    useHome.mockReturnValue({ ...data, courseIds: ['mine'] })
    const series = (value: number) => Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${12 + i}`, value }))
    useActivity.mockReturnValue({
      data: {
        asOf: '2026-11-25T08:00:00Z', online: 2, enrolled: 20, visitedWeek: 15, visitDaysPerVisitor: 2.8,
        visits: series(2), submissions: series(1), completed: series(0),
      },
      loading: false, failed: false, reload: vi.fn(),
    })
    renderPage()
    expect(useActivity).toHaveBeenCalledWith(['mine'])
    expect(screen.getByTestId('teacher-card-visits-value')).toHaveTextContent('14')
    expect(screen.getByTestId('teacher-card-submissions-value')).toHaveTextContent('7')
    expect(screen.getByTestId('teacher-card-completed-value')).toHaveTextContent('0')
    expect(screen.getByText('15 из 20')).toBeInTheDocument()
    expect(screen.getByText('75 % учеников')).toBeInTheDocument()
    expect(screen.queryByText('Очередь проверки')).not.toBeInTheDocument()
  })
})
