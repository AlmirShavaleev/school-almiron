import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * §200. Список вариантов: строка открывает вариант целиком, а не только по
 * «глазику». Проверяем ровно то, что здесь ломается: строка открывает,
 * «удалить» удаляет и НЕ открывает, клавиатура открывает.
 *
 * Данные и запись — на моках хуков: экран к базе не ходит, а поведение цели
 * клика от источника списка не зависит.
 */

const VARIANTS = [
  {
    id: 'v-1', title: 'Пробник №1', description: null, subject: 'math', exam_type: 'ege',
    status: 'ready' as const, created_by: 'p-1', settings: { sections: [], generation_mode: 'random' as const },
    tasks_count: 12, created_at: '2026-09-01T09:00:00.000Z', updated_at: '2026-09-10T09:00:00.000Z',
  },
  {
    id: 'v-2', title: 'Черновик по физике', description: null, subject: 'physics', exam_type: 'oge',
    status: 'draft' as const, created_by: 'p-1', settings: { sections: [], generation_mode: 'random' as const },
    tasks_count: 5, created_at: '2026-09-02T09:00:00.000Z', updated_at: '2026-09-11T09:00:00.000Z',
  },
]

const deleteVariant = vi.fn(async () => true)

vi.mock('@/hooks/useVariants', () => ({
  useVariants: () => ({
    variants: VARIANTS,
    loading: false,
    error: null,
    reload: vi.fn(),
    deleteVariant,
  }),
}))

vi.mock('@/hooks/useVariantAutoBuild', () => ({
  useVariantPassCounts: () => ({}),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ profile: { id: 'p-1', role: 'owner', full_name: 'Владелец' } }),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { VariantsListPage } from '@/pages/variants/VariantsListPage'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/variants']}>
      <VariantsListPage />
      <LocationProbe />
    </MemoryRouter>
  )
}

const here = () => screen.getByTestId('location').textContent
const row = (title: string) => screen.getByRole('link', { name: `Открыть вариант «${title}»` })

describe('VariantsListPage — строка как цель клика (§200)', () => {
  beforeEach(() => {
    deleteVariant.mockClear()
  })

  it('клик по строке открывает вариант', () => {
    renderPage()

    fireEvent.click(row('Пробник №1'))

    expect(here()).toBe('/variants/v-1')
  })

  it('Enter на строке открывает вариант', () => {
    renderPage()

    fireEvent.keyDown(row('Черновик по физике'), { key: 'Enter' })

    expect(here()).toBe('/variants/v-2')
  })

  it('«Удалить» удаляет и не открывает вариант', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[0])

    expect(deleteVariant).toHaveBeenCalledWith('v-1')
    expect(here()).toBe('/variants')
    confirmSpy.mockRestore()
  })

  it('«Редактировать» ведёт в конструктор, а не в просмотр', () => {
    renderPage()

    fireEvent.click(screen.getAllByRole('button', { name: 'Редактировать' })[0])

    expect(here()).toBe('/variant-builder/v-1')
  })

  it('клик по строке ничего не удаляет', () => {
    renderPage()

    fireEvent.click(row('Пробник №1'))

    expect(deleteVariant).not.toHaveBeenCalled()
  })
})
