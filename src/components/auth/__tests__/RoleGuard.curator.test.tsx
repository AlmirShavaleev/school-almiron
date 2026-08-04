import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { useAuthStore } from '@/store/authStore'
import { resetCuratorshipsCache } from '@/hooks/useMyCuratorships'

/**
 * Вторая, не-ролевая дверь сторожа. Кураторство — назначение поверх аккаунта,
 * поэтому у куратора в профиле стоит `student`, и по `allow` он не проходит.
 *
 * Отдельно проверяем, что дверь НЕ открывается всем ученикам подряд: ошибка
 * здесь пустила бы любого школьника в проверку ДЗ.
 */

let curatorRows: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: curatorRows, error: null }).then(onFulfilled)
      return chain
    },
  },
}))

function renderGuarded(allowCourseCurator: boolean) {
  return render(
    <MemoryRouter initialEntries={['/homework-queue']}>
      <Routes>
        <Route
          path="/homework-queue"
          element={
            <RoleGuard allow={['teacher', 'admin', 'owner']} allowCourseCurator={allowCourseCurator}>
              <div>Очередь проверки</div>
            </RoleGuard>
          }
        />
        <Route path="/dashboard" element={<div>Отправлен на дашборд</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoleGuard и куратор курса', () => {
  beforeEach(() => {
    resetCuratorshipsCache()
    curatorRows = []
    useAuthStore.setState({
      profile: {
        id: 'profile-student',
        email: 'student@example.com',
        full_name: 'Ученик',
        role: 'student',
        created_at: '2026-08-05T00:00:00.000Z',
        updated_at: '2026-08-05T00:00:00.000Z',
      },
      loading: false,
    } as any)
  })

  it('ученик-куратор проходит на страницу проверки ДЗ', async () => {
    curatorRows = [{ course_id: 'c1', courses: { id: 'c1', title: 'Курирую' } }]

    renderGuarded(true)

    expect(await screen.findByText('Очередь проверки')).toBeInTheDocument()
  })

  it('ученик без кураторства уходит на дашборд', async () => {
    renderGuarded(true)

    expect(await screen.findByText('Отправлен на дашборд')).toBeInTheDocument()
  })

  it('без allowCourseCurator дверь закрыта даже куратору', async () => {
    curatorRows = [{ course_id: 'c1', courses: { id: 'c1', title: 'Курирую' } }]

    renderGuarded(false)

    await waitFor(() => expect(screen.getByText('Отправлен на дашборд')).toBeInTheDocument())
  })
})
