import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogPage } from '@/pages/catalog/CatalogPage'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  profile: { id: 'catalog-user', role: 'teacher' },
  useCatalogSections: vi.fn(() => ({ sections: [], loading: false, error: null })),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (state: { profile: typeof mocks.profile }) => unknown) => {
    const state = { profile: mocks.profile }
    return selector ? selector(state) : state
  },
}))
vi.mock('@/hooks/useCatalog', async original => ({
  ...await original<typeof import('@/hooks/useCatalog')>(),
  useCatalogSections: mocks.useCatalogSections,
  useCatalogPhysicsTopicSections: () => ({ sections: [], loading: false, error: null }),
}))
vi.mock('@/hooks/useSubscription', () => ({ useSubscriptionsEnabled: () => ({ enabled: true, loading: false }) }))

function renderCatalog(url = '/catalog') {
  return render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[url]}><CatalogPage /></MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.useCatalogSections.mockClear()
  mocks.profile.role = 'teacher'
})

describe('Вход в каталог заданий', () => {
  it('сразу показывает персоналу оба направления ЕГЭ без запросов', async () => {
    renderCatalog()

    const picker = within(screen.getByRole('navigation', { name: 'Направления каталога' }))
    expect(picker.getAllByRole('link')).toHaveLength(2)
    expect(picker.getByRole('link', { name: 'Математика ЕГЭ' })).toHaveAttribute('href', '/catalog?subject=math&exam=ege')
    expect(picker.getByRole('link', { name: 'Физика ЕГЭ' })).toHaveAttribute('href', '/catalog?subject=physics&exam=ege')
    expect(screen.queryByRole('button', { name: 'Открыть задания' })).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.useCatalogSections).not.toHaveBeenCalled()

    fireEvent.click(picker.getByRole('link', { name: 'Физика ЕГЭ' }))
    expect(await screen.findByRole('heading', { name: 'Физика ЕГЭ' })).toBeVisible()
    expect(mocks.useCatalogSections).toHaveBeenCalledWith('Физика', 'ЕГЭ', 0, true)
    fireEvent.click(screen.getByRole('link', { name: 'Выбрать другое направление' }))
    expect(await screen.findByRole('link', { name: 'Математика ЕГЭ' })).toBeVisible()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('показывает ученику только разрешённые направления ЕГЭ и сохраняет доступ при возврате', async () => {
    mocks.profile.role = 'student'
    mocks.rpc.mockResolvedValue({ data: ['Физика|ЕГЭ', 'Физика|ОГЭ'], error: null })
    renderCatalog()
    const physics = await screen.findByRole('link', { name: 'Физика ЕГЭ' })
    expect(physics).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Математика ЕГЭ' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Физика ОГЭ' })).toBeNull()
    fireEvent.click(physics)
    fireEvent.click(screen.getByRole('link', { name: 'Выбрать другое направление' }))
    expect(await screen.findByRole('link', { name: 'Физика ЕГЭ' })).toBeVisible()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('catalog_subscription_directions', {})
  })

  it.each([
    { data: [], error: null },
    { data: null, error: { hint: 'CATALOG_LOCKED' } },
  ])('сохраняет сообщение, когда у ученика нет доступа (%j)', async response => {
    mocks.profile.role = 'student'
    mocks.rpc.mockResolvedValue(response)
    renderCatalog()
    expect(await screen.findByTestId('catalog-locked')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Направления каталога' })).toBeNull()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('повторяет запрос только по нажатию после ошибки', async () => {
    mocks.profile.role = 'student'
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Связь прервалась' } })
      .mockResolvedValueOnce({ data: ['Физика|ЕГЭ'], error: null })
    renderCatalog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить доступные направления.')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('link', { name: 'Физика ЕГЭ' })).toBeVisible()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('при подборе к уроку сразу открывает направления', () => {
    renderCatalog('/catalog?attachTo=test-topic')
    expect(screen.getByRole('link', { name: 'Математика ЕГЭ' })).toBeVisible()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
