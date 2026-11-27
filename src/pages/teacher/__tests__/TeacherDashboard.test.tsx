import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'
import type { TeacherHomeData } from '@/lib/teacherHome'

const { useHome, useLive, useActivity, usePeriod, usePresence, useVisits, useSubmissions } = vi.hoisted(() => ({
  useHome: vi.fn(), useLive: vi.fn(), useActivity: vi.fn(), usePeriod: vi.fn(),
  usePresence: vi.fn(), useVisits: vi.fn(), useSubmissions: vi.fn(),
}))
vi.mock('@/hooks/useTeacherHome', () => ({ useTeacherHome: useHome }))
vi.mock('@/hooks/useMyLiveTimedWorks', () => ({ useMyLiveTimedWorks: useLive }))
vi.mock('@/hooks/useTeacherActivity', () => ({ useTeacherActivity: useActivity, useTeacherActivityPeriod: usePeriod }))
vi.mock('@/hooks/useTeacherStudentActivity', () => ({
  useTeacherPresence: usePresence, useTeacherStudentVisits: useVisits,
  useTeacherHomeworkSubmissions: useSubmissions,
}))

const home: TeacherHomeData = {
  upcoming: [{ id: 'exam-1', title: 'Пробник по физике', groupName: '11А', startsAt: '2026-11-27T09:30:00Z' }],
}

const reload = vi.fn()
const data = { home, today: '2026-11-25', loading: false, error: null, reload, courseIds: null, scopeLoading: false }
const renderPage = () => render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)
const week = {
  startsOn: '2026-11-19', endsOn: '2026-11-25',
  visits: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${19 + i}`, value: 2 })),
  submissions: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${19 + i}`, value: 1 })),
}
const asOf = '2026-11-25T08:40:00Z'

describe('Кабинет учителя', () => {
  beforeEach(() => {
    useHome.mockReturnValue(data)
    useLive.mockReturnValue({ works: [], serverNow: null })
    useActivity.mockReturnValue({ data: null, loading: false, failed: false, reload: vi.fn() })
    usePeriod.mockReset().mockReturnValue({ data: null, loading: false, failed: false, reload: vi.fn() })
    usePresence.mockReturnValue({ students: [], loading: false, failed: false, reload: vi.fn() })
    useVisits.mockReset()
    useSubmissions.mockReset()
    reload.mockClear()
  })

  it('показывает ссылку на учеников без сводок по ученикам и группам', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Кабинет учителя' })).toBeInTheDocument()
    expect(screen.getByText('Среда, 25 ноября')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Сводка по ученикам' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'По группам' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ученики' })).toHaveAttribute('href', '/students')
  })

  it('главная без очереди и персональных предупреждений, ближайший пробник открывается из расписания', () => {
    renderPage()
    expect(screen.queryByText(/на проверке|просели|не сдали|напомнить/i)).not.toBeInTheDocument()
    const upcoming = screen.getByRole('link', { name: /Пробник по физике/ })
    expect(upcoming).toHaveAttribute('href', '/mock-exams/exam-1')
    expect(upcoming).toHaveTextContent('27 ноября, 12:30 МСК · 11А')
  })

  it('скрывает пустое расписание', () => {
    useHome.mockReturnValue({ ...data, home: { upcoming: [] } })
    renderPage()
    expect(screen.queryByRole('heading', { name: 'Ближайшие пробники' })).not.toBeInTheDocument()
  })

  it('ошибка загрузки даёт повторить запрос', () => {
    useHome.mockReturnValue({ ...data, home: null, error: 'Не удалось загрузить ближайшие пробники.' })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить ближайшие пробники.')
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
    useActivity.mockReturnValue({
      data: { asOf, enrolled: 20, visitedWeek: 15, week },
      loading: false, failed: false, reload: vi.fn(),
    })
    renderPage()
    expect(useActivity).toHaveBeenCalledWith(['mine'])
    expect(screen.getByTestId('teacher-card-visits-value')).toHaveTextContent('14')
    expect(screen.getByTestId('teacher-card-submissions-value')).toHaveTextContent('7')
    expect(screen.queryByText('Пройденные темы')).not.toBeInTheDocument()
    expect(screen.getByText('15 из 20')).toBeInTheDocument()
    expect(screen.getByText('75 % учеников')).toBeInTheDocument()
    expect(screen.queryByText('Дней с заходом за неделю')).not.toBeInTheDocument()
    expect(useVisits).not.toHaveBeenCalled()
    expect(screen.queryByText('Очередь проверки')).not.toBeInTheDocument()
  })

  it('одним переключателем меняет период и итоги обеих диаграмм', () => {
    useHome.mockReturnValue({ ...data, courseIds: ['mine'] })
    useActivity.mockReturnValue({ data: { asOf, enrolled: 20, visitedWeek: 15, week }, loading: false, failed: false })
    usePeriod.mockImplementation((_courses, days) => {
      if (days === 7) return { data: null }
      const annual = days === 365
      const day = annual ? '2026-08-01' : '2026-11-25'
      return { data: {
        startsOn: annual ? '2025-11-26' : '2026-10-27', endsOn: week.endsOn,
        visits: [{ day, value: annual ? 280 : 35 }],
        submissions: [{ day, value: annual ? 168 : 24 }],
      } }
    })
    renderPage()
    const periods = within(screen.getByRole('group', { name: 'Период графиков' }))
    expect(periods.getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Последние 7 дней · по Москве')).toBeInTheDocument()
    fireEvent.click(periods.getByRole('button', { name: 'Месяц' }))
    expect(usePeriod).toHaveBeenLastCalledWith(['mine'], 30, asOf)
    expect(screen.getByTestId('teacher-card-visits-value')).toHaveTextContent('35')
    expect(screen.getByTestId('teacher-card-submissions-value')).toHaveTextContent('24')
    expect(screen.getByText('Последние 30 дней · по Москве')).toBeInTheDocument()
    fireEvent.click(periods.getByRole('button', { name: 'Год' }))
    expect(usePeriod).toHaveBeenLastCalledWith(['mine'], 365, asOf)
    expect(screen.getByTestId('teacher-card-visits-value')).toHaveTextContent('280')
    expect(screen.getByTestId('teacher-card-submissions-value')).toHaveTextContent('168')
    expect(screen.getByRole('img', { name: /Заходы на платформу по месяцам/ })).toBeInTheDocument()
    expect(screen.getByText('Учёт заходов начался 4 августа 2026 года.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сегодня 1' })).toBeInTheDocument()
    fireEvent.click(periods.getByRole('button', { name: 'Неделя' }))
    expect(screen.getByTestId('teacher-card-visits-value')).toHaveTextContent('14')
    expect(screen.getByTestId('teacher-card-submissions-value')).toHaveTextContent('7')
  })

  it('по нажатию «Сегодня» показывает сегодняшние сдачи с учениками и темами', () => {
    useHome.mockReturnValue({ ...data, courseIds: ['mine'] })
    useActivity.mockReturnValue({
      data: { asOf, enrolled: 2, visitedWeek: 1, week: { ...week, submissions: [{ day: week.endsOn, value: 2 }] } },
      loading: false, failed: false, reload: vi.fn(),
    })
    useSubmissions.mockReturnValue({
      rows: [
        { attempt_id: 'first', full_name: 'Анна Тестова', topic_title: 'Электростатика', submitted_at: '2026-11-25T08:30:00Z' },
        { attempt_id: 'second', full_name: 'Иван Тестов', topic_title: 'Тепловые явления', submitted_at: '2026-11-25T07:15:00Z' },
      ],
      loading: false, failed: false, reload: vi.fn(),
    })
    renderPage()
    expect(useSubmissions).not.toHaveBeenCalled()
    const today = within(screen.getByTestId('teacher-card-submissions')).getByRole('button', { name: 'Сегодня 2' })
    fireEvent.click(today)
    expect(today).toHaveAttribute('aria-expanded', 'true')
    expect(useSubmissions).toHaveBeenCalledWith(['mine'], asOf)
    const rows = within(screen.getByRole('region', { name: 'Сдачи ДЗ сегодня' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Анна ТестоваЭлектростатика11:30 МСК')
    expect(rows[1]).toHaveTextContent('Иван ТестовТепловые явления10:15 МСК')
    fireEvent.click(today)
    expect(screen.queryByRole('region', { name: 'Сдачи ДЗ сегодня' })).not.toBeInTheDocument()
  })

  it('показывает имена учеников онлайн независимо от загрузки графиков', () => {
    useHome.mockReturnValue({ ...data, courseIds: ['mine'] })
    useActivity.mockReturnValue({ data: null, loading: true, failed: false, reload: vi.fn() })
    usePresence.mockReturnValue({
      students: [{ student_id: 'one', full_name: 'Анна Тестова' }, { student_id: 'two', full_name: 'Иван Тестов' }],
      loading: false, failed: false, reload: vi.fn(),
    })
    renderPage()
    expect(usePresence).toHaveBeenCalledWith(['mine'])
    const online = screen.getByRole('region', { name: 'Сейчас на платформе' })
    expect(within(online).getByLabelText('Учеников онлайн')).toHaveTextContent('2')
    expect(within(online).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Анна Тестова', 'Иван Тестов'])
  })

  it('сразу показывает сегодняшних посетителей и позволяет сменить день или открыть неделю', () => {
    useHome.mockReturnValue({ ...data, courseIds: ['mine'] })
    useActivity.mockReturnValue({
      data: { asOf, enrolled: 3, visitedWeek: 2, week },
      loading: false, failed: false, reload: vi.fn(),
    })
    const days = (visits: Record<string, { first_visit_at: string | null; seconds: number | null }>) =>
      Array.from({ length: 7 }, (_, index) => {
        const day = `2026-11-${25 - index}`
        const visit = visits[day]
        return { day, visited: Boolean(visit), first_visit_at: visit?.first_visit_at ?? null, seconds: visit?.seconds ?? null }
      })
    useVisits.mockReturnValue({
      students: [
        { student_id: 'one', full_name: 'Анна Тестова', days: days({
          '2026-11-25': { first_visit_at: '2026-11-25T08:12:00Z', seconds: 3660 },
          '2026-11-23': { first_visit_at: null, seconds: 30 },
        }) },
        { student_id: 'two', full_name: 'Иван Тестов', days: days({
          '2026-11-24': { first_visit_at: '2026-11-24T09:00:00Z', seconds: null },
        }) },
        { student_id: 'three', full_name: 'Пётр Тестов', days: days({}) },
      ],
      loading: false, failed: false, reload: vi.fn(),
    })
    renderPage()
    expect(useVisits).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: /Заходили за 7 дней/ })
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(useVisits).toHaveBeenCalledWith(['mine'])
    const periods = within(screen.getByRole('group', { name: 'Период заходов' }))
    const dailyTable = () => within(screen.getByRole('table', { name: 'Кто заходил в выбранный день' }))
    expect(periods.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true')
    expect(periods.getAllByRole('button')).toHaveLength(8)
    expect(dailyTable().getByRole('rowheader', { name: 'Анна Тестова' })).toBeInTheDocument()
    expect(dailyTable().queryByRole('rowheader', { name: 'Иван Тестов' })).not.toBeInTheDocument()
    expect(dailyTable().getByText('11:12')).toBeInTheDocument()
    expect(dailyTable().getByText('≈ 1 ч 1 мин')).toBeInTheDocument()

    fireEvent.click(periods.getByRole('button', { name: 'Вчера' }))
    expect(dailyTable().getByRole('rowheader', { name: 'Иван Тестов' })).toBeInTheDocument()
    expect(dailyTable().queryByRole('rowheader', { name: 'Анна Тестова' })).not.toBeInTheDocument()
    expect(dailyTable().getByText('12:00')).toBeInTheDocument()
    expect(dailyTable().getByText('—')).toBeInTheDocument()

    fireEvent.click(periods.getByRole('button', { name: 'Позавчера' }))
    expect(dailyTable().getByText('меньше минуты')).toBeInTheDocument()
    fireEvent.click(periods.getAllByRole('button')[6])
    expect(screen.getByText('В этот день никто не заходил.')).toBeInTheDocument()

    fireEvent.click(periods.getByRole('button', { name: 'За неделю' }))
    const weeklyTable = within(screen.getByRole('table', { name: 'Кто заходил за неделю' }))
    expect(weeklyTable.getByRole('row', { name: 'Анна Тестова 2' })).toBeInTheDocument()
    expect(weeklyTable.getByRole('row', { name: 'Иван Тестов 1' })).toBeInTheDocument()
    expect(weeklyTable.queryByRole('rowheader', { name: 'Пётр Тестов' })).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByRole('group', { name: 'Период заходов' })).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true')
  })
})
