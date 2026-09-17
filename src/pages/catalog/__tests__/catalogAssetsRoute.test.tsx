import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet } from 'react-router-dom'

/**
 * §195. `/catalog/assets` соседствует с `/catalog/:sectionId`, то есть новый
 * экран легко мог оказаться «разделом каталога с идентификатором assets» —
 * страница открылась бы, показала пустой раздел и никто бы не понял, почему.
 *
 * Роутер ставит статический сегмент выше динамического независимо от порядка
 * объявления, но это свойство библиотеки, а не нашего файла: тест держит его
 * на месте, если маршруты когда-нибудь перетасуют.
 */

vi.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: () => <div><Outlet /></div>,
}))
vi.mock('@/components/auth/RoleGuard', () => ({
  RoleGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/admin/SchoolPresencePublisher', () => ({
  SchoolPresencePublisher: () => null,
}))
vi.mock('@/components/catalog/CatalogAttachMode', () => ({
  CatalogAttachMode: () => <Outlet />,
}))
vi.mock('@/pages/catalog/CatalogAssetsPage', () => ({
  CatalogAssetsPage: () => <div>catalog-assets-marker</div>,
}))
vi.mock('@/pages/catalog/CatalogSectionPage', () => ({
  CatalogSectionPage: () => <div>catalog-section-marker</div>,
}))

import AppRoutes from '@/AppRoutes'

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
}

describe('Маршрут /catalog/assets (§195)', () => {
  it('ведёт на экран картинок, а не на раздел каталога с id «assets»', async () => {
    renderAt('/catalog/assets')
    expect(await screen.findByText('catalog-assets-marker')).toBeInTheDocument()
    expect(screen.queryByText('catalog-section-marker')).not.toBeInTheDocument()
  })

  it('обычный раздел каталога по-прежнему открывается', async () => {
    renderAt('/catalog/section-1')
    expect(await screen.findByText('catalog-section-marker')).toBeInTheDocument()
  })
})
