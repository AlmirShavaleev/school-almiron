import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentDashboard } from '@/pages/student/StudentDashboard'

/**
 * Тест переписан 2026-08-04 под нынешний кабинет.
 *
 * Прежняя версия кормила четыре хука (`useMyCourseMemberships`,
 * `useStudentHomeworkSummary`, `useMyHomeworkAssignments` и сам
 * `useStudentDashboard`) и ждала тексты «Новое ДЗ», «Доработка ДЗ»,
 * «Срочно сдать!». Компонент давно живёт на ОДНОМ `useStudentDashboard`, а
 * бейджи стали статусами попытки из `ATTEMPT_STATUS_LABEL`. Четыре красных
 * висели бесхозными и ничего не сторожили.
 *
 * Замысел сохранён: кабинет читает живой контур `topic_homework_*`, а не
 * легаси `homeworks`/`homework_submissions`, и различает статусы работ.
 */

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1', full_name: 'Almir Shavaleev' } }),
}))

const useStudentDashboardMock = vi.fn()
vi.mock('@/hooks/useStudentDashboard', () => ({
  useStudentDashboard: (...args: unknown[]) => useStudentDashboardMock(...args),
}))

// Список дел — отдельный хук со своими запросами; его правила проверяются в
// `lib/__tests__/studentTodo.test.ts`, здесь он нужен пустым, чтобы не тянуть
// сеть и не мешать проверкам курсов и статусов.
const useStudentTodoMock = vi.fn()
vi.mock('@/hooks/useStudentTodo', () => ({
  useStudentTodo: (...args: unknown[]) => useStudentTodoMock(...args),
}))

const emptyTodo = {
  overdue: [], returned: [], dueSoon: [], tests: [], newlyOpened: [], checked: [], isClear: true,
}

const baseDashboard = {
  courses: [],
  hwItems: [],
  testItems: [],
  stats: {
    courses: 0,
    hwTotal: 0, hwAccepted: 0, hwWaiting: 0, hwRevision: 0,
    testsAvailable: 0, testsCompleted: 0,
  },
  loading: false,
}

function renderDashboard() {
  return render(<MemoryRouter><StudentDashboard /></MemoryRouter>)
}

const hw = (attemptId: string, hwTitle: string, status: string) => ({
  attemptId, hwTitle, status,
  score: null, gradeScale: null, updatedAt: '2026-08-01T10:00:00Z',
})

describe('StudentDashboard — живой контур topic_homework', () => {
  beforeEach(() => {
    useStudentDashboardMock.mockReturnValue(baseDashboard)
    useStudentTodoMock.mockReturnValue({ todo: emptyTodo, loading: false, error: null })
  })

  it('кабинет спрашивает данные по своему профилю', () => {
    renderDashboard()
    expect(useStudentDashboardMock).toHaveBeenCalledWith('profile-1')
  })

  it('показывает настоящий курс, а не пустой блок', () => {
    useStudentDashboardMock.mockReturnValue({
      ...baseDashboard,
      courses: [{ courseId: 'c1', groupId: 'g1', courseTitle: 'Физика ЕГЭ', subject: 'Физика' }],
      stats: { ...baseDashboard.stats, courses: 1 },
    })
    renderDashboard()

    // «Мои курсы» — это ещё и заголовок плитки статистики, поэтому смотрим на
    // саму карточку курса, а не на заголовок раздела.
    expect(screen.getByText('Физика ЕГЭ')).toBeInTheDocument()
    expect(screen.getByText('Физика')).toBeInTheDocument()
  })

  it('без курсов карточек курсов нет — остаётся только плитка счётчика', () => {
    renderDashboard()
    expect(screen.queryByText('Физика ЕГЭ')).not.toBeInTheDocument()
    // Плитка «Мои курсы» со счётчиком остаётся всегда, раздел с карточками — нет.
    expect(screen.getAllByText('Мои курсы')).toHaveLength(1)
  })

  it('различает статусы работ: «На доработке» не путается с «Принято»', () => {
    useStudentDashboardMock.mockReturnValue({
      ...baseDashboard,
      hwItems: [
        hw('a1', 'Кинематика', 'returned_for_revision'),
        hw('a2', 'Динамика', 'accepted'),
        hw('a3', 'Оптика', 'submitted'),
      ],
      stats: { ...baseDashboard.stats, hwTotal: 3, hwAccepted: 1, hwWaiting: 1, hwRevision: 1 },
    })
    renderDashboard()

    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.getByText('На доработке')).toBeInTheDocument()
    expect(screen.getByText('Принято')).toBeInTheDocument()
    expect(screen.getByText('Отправлено')).toBeInTheDocument()
  })

  it('работы на доработке выносятся отдельным предупреждением', () => {
    useStudentDashboardMock.mockReturnValue({
      ...baseDashboard,
      hwItems: [hw('a1', 'Кинематика', 'returned_for_revision')],
      stats: { ...baseDashboard.stats, hwTotal: 1, hwRevision: 1 },
    })
    renderDashboard()

    // Текст предупреждения, а не бейдж статуса: «На доработке» есть и там, и там.
    expect(screen.getByText(/У вас 1 работа на доработке/)).toBeInTheDocument()
  })

  it('пустой список ДЗ говорит об этом словами, а не пустотой', () => {
    renderDashboard()
    expect(screen.getByText('Домашних заданий пока нет')).toBeInTheDocument()
  })
})
