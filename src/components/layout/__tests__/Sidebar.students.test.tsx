import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ count: 0 }),
        }),
      }),
    }),
  },
}))

describe('Sidebar student navigation item', () => {
  beforeEach(() => {
    useAuthStore.setState({
      profile: {
        id: 'teacher-profile',
        email: 'teacher@example.com',
        full_name: 'Teacher',
        role: 'teacher',
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
      },
      loading: false,
    } as any)
  })

  it('shows the Ученики item for teacher', async () => {
    render(
      <MemoryRouter>
        <Sidebar open onClose={() => {}} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Ученики')).toBeInTheDocument()
  })
})
