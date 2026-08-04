import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'
import { resetCuratorshipsCache } from '@/hooks/useMyCuratorships'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * Ученик-куратор входит как ученик — меню рисуется его ролью, и раздать
 * пункты кураторства через `roles` невозможно: там `student`. Проверяем, что
 * вход в кураторство появляется по строке `course_curators`, а не по роли, и
 * что обычному ученику он не показывается.
 */

const STUDENT_ID = 'profile-student'

let curatorRows: Array<Record<string, unknown>> = []

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'course_curators') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.then = (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: curatorRows, error: null }).then(onFulfilled)
        return chain
      }
      // Бейджи сайдбара: считалка, до которой тесту дела нет.
      return {
        select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }),
      }
    },
  },
}))

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar open onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('Sidebar: вход в кураторство', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCuratorshipsCache()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
    curatorRows = []
    useAuthStore.setState({
      profile: {
        id: STUDENT_ID,
        email: 'student@example.com',
        full_name: 'Ученик',
        role: 'student',
        created_at: '2026-08-05T00:00:00.000Z',
        updated_at: '2026-08-05T00:00:00.000Z',
      },
      loading: false,
    } as any)
  })

  it('у ученика-куратора появляется раздел «Курирую» с проверкой ДЗ', async () => {
    curatorRows = [{ course_id: 'c1', courses: { id: 'c1', title: 'Курирую' } }]

    renderSidebar()

    expect(await screen.findByText('Курирую')).toBeInTheDocument()
    expect(screen.getByText('Проверка ДЗ')).toBeInTheDocument()
    expect(screen.getByText('Программа курса')).toBeInTheDocument()
    // Ученические пункты никуда не делись: кураторство их не заменяет.
    expect(screen.getByText('Мой кабинет')).toBeInTheDocument()
  })

  it('обычному ученику раздела нет', async () => {
    renderSidebar()

    expect(await screen.findByText('Мой кабинет')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Курирую')).not.toBeInTheDocument())
    expect(screen.queryByText('Проверка ДЗ')).not.toBeInTheDocument()
  })

  it('куратор не получает учительский кабинет и админские пункты', async () => {
    curatorRows = [{ course_id: 'c1', courses: { id: 'c1', title: 'Курирую' } }]

    renderSidebar()

    await screen.findByText('Курирую')
    expect(screen.queryByText('Кабинет учителя')).not.toBeInTheDocument()
    expect(screen.queryByText('Панель админа')).not.toBeInTheDocument()
    expect(screen.queryByText('Тесты')).not.toBeInTheDocument()
  })
})
