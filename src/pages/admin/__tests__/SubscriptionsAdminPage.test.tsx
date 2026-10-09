/**
 * §282. Админка подписки: список подписчиков, ручное продление, тарифы
 * (предупреждение «курс станет платным»), флаг, отказ не-админу.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminSubscriptionRow, TariffRow } from '@/lib/subscription/api'

const api = vi.hoisted(() => ({
  fetchAdminSubscriptions: vi.fn(),
  fetchAdminPayments: vi.fn(),
  fetchTariffs: vi.fn(),
  fetchStreamCourses: vi.fn(),
  fetchFeatureFlag: vi.fn(),
  fetchSubscriptionSettings: vi.fn(),
  fetchSubscriptionLog: vi.fn(),
  adminExtend: vi.fn(),
  adminCancel: vi.fn(),
  adminGrant: vi.fn(),
  findStudentByEmail: vi.fn(),
  saveTariff: vi.fn(),
  setFeatureFlag: vi.fn(),
  saveSubscriptionSettings: vi.fn(),
}))
vi.mock('@/lib/subscription/api', async (orig) => ({ ...(await orig<object>()), ...api }))

import { SubscriptionsAdminPage } from '../SubscriptionsAdminPage'
import { SubscriptionError } from '@/lib/subscription/api'

const ROW: AdminSubscriptionRow = {
  id: 's1', student_id: 'st1', profile_id: 'p1', full_name: 'Аня Петрова', email: 'kid@example.ru',
  course_id: 'c1', course_title: 'Курс с подпиской', tariff_title: 'Месяц', status: 'past_due', source: 'purchase',
  has_access: true, current_period_end: '2026-10-10T09:00:00Z', access_until: '2026-10-14T09:00:00Z',
  auto_renew: true, next_charge_at: '2026-10-11T09:00:00Z', charge_attempts: 1, last_charge_error: 'insufficient_funds',
  enrolled: true, paid_total_rub: 2900, created_at: '2026-09-10T09:00:00Z',
}
const TARIFF: TariffRow = {
  id: 't1', course_id: 'c1', title: 'Месяц', description: null, price_rub: 2900, period_months: 1, trial_days: 7,
  is_active: true, sort_order: 0, receipt_vat_code: null, course: { title: 'Курс с подпиской' },
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><SubscriptionsAdminPage /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchAdminSubscriptions.mockResolvedValue([ROW])
  api.fetchAdminPayments.mockResolvedValue([])
  api.fetchTariffs.mockResolvedValue([TARIFF])
  api.fetchStreamCourses.mockResolvedValue([{ id: 'c1', title: 'Курс с подпиской' }, { id: 'c2', title: 'Другой поток' }])
  api.fetchFeatureFlag.mockResolvedValue(false)
  api.fetchSubscriptionSettings.mockResolvedValue({ offer_url: null, privacy_url: null, parent_consent_url: null, retry_days: [1, 3] })
  api.fetchSubscriptionLog.mockResolvedValue([])
})

describe('админка подписки', () => {
  it('подписчик: статус, причина отказа по-русски, оплачено', async () => {
    renderPage()
    const row = await screen.findByTestId('admin-sub-row')
    expect(row).toHaveTextContent('Аня Петрова')
    expect(row).toHaveTextContent('Не удалось списать')
    expect(row).toHaveTextContent('недостаточно средств на карте')
    expect(row).toHaveTextContent('2 900')
  })

  it('ручное продление: дни и причина уходят в admin_subscription_extend', async () => {
    api.adminExtend.mockResolvedValue({})
    vi.spyOn(window, 'prompt').mockReturnValueOnce('14').mockReturnValueOnce('компенсация')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Продлить' }))
    await waitFor(() => expect(api.adminExtend).toHaveBeenCalledWith('s1', 14, 'компенсация'))
  })

  it('не-админ: ошибка базы видна, а не пустой список', async () => {
    api.fetchAdminSubscriptions.mockRejectedValue(new SubscriptionError('Только для администратора', 'ONLY_ADMIN'))
    renderPage()
    expect(await screen.findByText(/Только для администратора/)).toBeInTheDocument()
  })

  it('новый тариф: предупреждение «курс станет платным», без согласия не сохраняется', async () => {
    api.saveTariff.mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Тарифы' }))
    fireEvent.click(await screen.findByTestId('tariff-new'))
    const form = await screen.findByTestId('tariff-form')
    await screen.findByRole('option', { name: 'Другой поток' })
    fireEvent.change(form.querySelector('select')!, { target: { value: 'c2' } })
    fireEvent.change(screen.getByLabelText('Название тарифа'), { target: { value: 'Месяц' } })
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '3500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('платным'))
    expect(api.saveTariff).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(api.saveTariff).toHaveBeenCalledWith(null, expect.objectContaining({ course_id: 'c2', title: 'Месяц', price_rub: 3500, is_active: false })))
  })

  it('флаг: включение только после подтверждения', async () => {
    api.setFeatureFlag.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    expect(await screen.findByText('Подписка на сайте: выключена')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('flag-toggle'))
    await waitFor(() => expect(api.setFeatureFlag).toHaveBeenCalledWith('subscriptions', true))
  })
})
