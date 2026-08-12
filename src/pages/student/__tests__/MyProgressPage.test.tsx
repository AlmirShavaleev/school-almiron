import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MyProgressPage } from '@/pages/student/MyProgressPage'

/**
 * §122. Страница переписана с двух МЁРТВЫХ контуров на живой.
 *
 * Прежний тест описывал Homework V2 (`useStudentHomeworkSummary`,
 * `useMyHomeworkAssignments`) — контур с нулём строк на проде, из-за которого
 * ученик с принятой работой видел сплошные нули. Замысел теста сохранён:
 * страница обязана показывать РЕАЛЬНОЕ состояние работ и не рисовать
 * показателей, под которыми нет источника.
 */

const fromSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { profile: { id: string } }) => unknown) =>
    selector({ profile: { id: 'profile-1' } }),
}))

vi.mock('@/hooks/useStudentProfile', () => ({
  useStudentProfile: () => ({
    data: { target_score: 85, groups: [{ id: 'g1', name: '11А', course_title: 'Физика ЕГЭ' }] },
    loading: false,
  }),
}))

const progress = {
  topics: { done: 3, total: 5, percent: 60 },
  homework: { accepted: 4, submitted: 1, returned: 2, pending: 3, total: 10 },
  averagePercent: 90,
}

vi.mock('@/hooks/useMyProgress', () => ({
  useMyProgress: () => ({ progress, loading: false, error: null }),
}))

vi.mock('@/components/journal/JournalView', () => ({
  JournalView: () => <div>Journal mock</div>,
}))

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

function renderPage() {
  fromSpy.mockImplementation((table: string) => {
    if (table === 'students') return makeChain({ data: { id: 'student-1' }, error: null })
    return makeChain({ data: null, error: null })
  })
  return render(
    <MemoryRouter>
      <MyProgressPage />
    </MemoryRouter>,
  )
}

describe('MyProgressPage — живой контур', () => {
  it('главный показатель — завершённые темы, а не доля разделов', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Темы завершены')).toBeInTheDocument())
    expect(screen.getByTestId('progress-topics')).toHaveTextContent('3 из 5')
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('состояние работ показывает из журнала тем', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Домашние задания')).toBeInTheDocument())
    expect(screen.getByText('на проверке')).toBeInTheDocument()
    expect(screen.getByText('на доработке')).toBeInTheDocument()
    expect(screen.getByText('принято')).toBeInTheDocument()
    expect(screen.getByText('ещё не сдано: 3')).toBeInTheDocument()
  })

  it('мёртвых показателей на странице не осталось', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Темы завершены')).toBeInTheDocument())
    // Посещаемость, пробники и легаси-«Сдача ДЗ» снесены вместе с запросами.
    expect(screen.queryByText('Посещаемость')).not.toBeInTheDocument()
    expect(screen.queryByText('Сдача ДЗ')).not.toBeInTheDocument()
    expect(screen.queryByText(/пробник/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Последние занятия')).not.toBeInTheDocument()
    expect(screen.queryByText('Статусы ДЗ')).not.toBeInTheDocument()
  })

  it('объясняет, из чего складывается завершённость темы', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/отмечены все её разделы и принято домашнее/i)).toBeInTheDocument())
  })
})

describe('MyProgressPage — плитка без источника не рисуется', () => {
  it('без принятых работ с оценкой среднего балла нет', async () => {
    progress.averagePercent = null as unknown as number
    renderPage()

    await waitFor(() => expect(screen.getByText('Темы завершены')).toBeInTheDocument())
    expect(screen.queryByText('по принятым работам')).not.toBeInTheDocument()
    progress.averagePercent = 90
  })
})
