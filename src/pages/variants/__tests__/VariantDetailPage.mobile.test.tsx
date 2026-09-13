import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VariantDetailPage } from '@/pages/variants/VariantDetailPage'

const OWNER = 'a0000000-0000-4000-8000-000000000002'

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ profile: { id: OWNER, role: 'owner', full_name: 'Владелец' } }),
}))
vi.mock('@/hooks/useVariants', () => ({
  useVariantDetail: () => ({
    variant: {
      id: 'v1', title: 'Тренировочный вариант №1 (ЕГЭ физика, полный, 26 заданий, по демоверсии 2027)',
      description: null, subject: 'physics', exam_type: 'ege', source_type: 'auto', status: 'ready',
      tasks_count: 26, settings: {}, created_by: OWNER, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-11T00:00:00Z',
      created_by_profile: { full_name: 'Владелец', email: 'o@x' },
    },
    items: [], loading: false, error: null,
  }),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('@/components/pdf/VariantPrintPanel', () => ({ VariantPrintPanel: () => null }))
vi.mock('@/components/catalog/CatalogTaskContent', () => ({ CatalogTaskContent: () => null }))

/**
 * Геометрию jsdom не считает — проверяем структуру, из-за которой страница
 * уезжала за экран телефона (§158, аудит №31): ряд кнопок не должен быть
 * flex-shrink-0, крошки — без жёсткого max-w.
 */
describe('VariantDetailPage — ширина на телефоне', () => {
  it('ряд кнопок переносится, а не выталкивает страницу вширь', () => {
    render(<MemoryRouter><VariantDetailPage /></MemoryRouter>)
    const assign = screen.getByRole('button', { name: /Назначить/ })
    const row = assign.parentElement!
    expect(row.className).toContain('flex-wrap')
    expect(row.className).not.toContain('flex-shrink-0')
    expect(row.className).not.toContain('shrink-0')
  })

  it('крошки не имеют жёсткого max-w и умеют сжиматься', () => {
    render(<MemoryRouter><VariantDetailPage /></MemoryRouter>)
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('min-w-0')
    const title = nav.querySelector('span.truncate')!
    expect(title).toBeTruthy()
    expect(title.className).not.toMatch(/max-w-/)
  })
})
