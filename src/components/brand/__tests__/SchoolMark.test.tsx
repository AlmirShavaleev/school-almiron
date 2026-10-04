import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SchoolMark } from '@/components/brand/SchoolMark'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }) }) },
}))

/**
 * §265. Знак школы «Орбита» вместо шапочки выпускника: в меню — цветной на
 * белой плитке (иконка вкладки — public/favicon.svg, тот же знак).
 */
describe('§265. знак школы «Орбита»', () => {
  beforeEach(() => {
    useAuthStore.setState({
      profile: { id: 'p', email: 't@example.com', full_name: 'Учитель', role: 'teacher', created_at: '', updated_at: '' },
      loading: false,
    } as never)
  })

  it('по умолчанию цветной: синяя «A», оранжевая орбита; без подписи — декоративный', () => {
    render(<SchoolMark />)
    const svg = screen.getByTestId('school-mark')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.querySelector('path')).toHaveAttribute('stroke', '#2F5BEA')
    expect(svg.querySelector('ellipse')).toHaveAttribute('stroke', '#F28C28')
  })

  it('на тёмном фоне — светлые оттенки; с подписью — картинка для читалки', () => {
    render(<SchoolMark tone="dark" title="Школа Almiron" />)
    const svg = screen.getByRole('img', { name: 'Школа Almiron' })
    expect(svg.querySelector('path')).toHaveAttribute('stroke', '#7AA2FF')
  })

  it('в меню рядом с «Школа Almiron» стоит знак, а не шапочка', () => {
    render(<MemoryRouter><Sidebar open onClose={() => {}} /></MemoryRouter>)
    const title = screen.getByText('Школа Almiron')
    // заголовок → блок подписей → строка «плитка + подписи»
    const head = title.parentElement!.parentElement!
    expect(head.querySelector('[data-testid="school-mark"]')).not.toBeNull()
    expect(head.querySelector('.lucide-graduation-cap')).toBeNull()
  })
})
