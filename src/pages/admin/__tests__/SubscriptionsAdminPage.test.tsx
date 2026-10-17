/**
 * §282. Админка подписки: список подписчиков, ручное продление, тарифы
 * (предупреждение «курс станет платным»), режим (выкл/тестировщики/все),
 * тестировщики, промокоды (§287), отказ не-админу.
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
  fetchTesters: vi.fn(),
  addTesterByEmail: vi.fn(),
  removeTester: vi.fn(),
  fetchPromoCodes: vi.fn(),
  createPromo: vi.fn(),
  setPromoActive: vi.fn(),
  fetchPromoRedemptions: vi.fn(),
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
  api.fetchTesters.mockResolvedValue([])
  api.fetchPromoCodes.mockResolvedValue([])
  api.fetchPromoRedemptions.mockResolvedValue([])
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

  it('режим «только тестировщики»: сначала «кому», потом флаг; без подтверждения', async () => {
    api.setFeatureFlag.mockResolvedValue(undefined)
    api.saveSubscriptionSettings.mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    expect(await screen.findByText('Подписка на сайте: выключена')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mode-testers')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('mode-testers'))
    await waitFor(() => expect(api.setFeatureFlag).toHaveBeenCalledWith('subscriptions', true))
    expect(api.saveSubscriptionSettings).toHaveBeenCalledWith({ audience: 'testers' })
    expect(api.saveSubscriptionSettings.mock.invocationCallOrder[0]).toBeLessThan(api.setFeatureFlag.mock.invocationCallOrder[0])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('режим «для всех» — только после подтверждения; отказ — ничего не меняется', async () => {
    api.fetchFeatureFlag.mockResolvedValue(true)
    api.fetchSubscriptionSettings.mockResolvedValue({ offer_url: null, privacy_url: null, parent_consent_url: null, retry_days: [1, 3], audience: 'testers' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    expect(await screen.findByText('Подписка на сайте: только тестировщики')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mode-everyone')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('mode-everyone'))
    expect(confirm).toHaveBeenCalled()
    expect(api.setFeatureFlag).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    api.setFeatureFlag.mockResolvedValue(undefined)
    api.saveSubscriptionSettings.mockResolvedValue(undefined)
    fireEvent.click(screen.getByTestId('mode-everyone'))
    await waitFor(() => expect(api.saveSubscriptionSettings).toHaveBeenCalledWith({ audience: 'everyone' }))
  })

  it('тестировщики: добавить по email, неизвестный email — понятная ошибка', async () => {
    api.addTesterByEmail.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }))
    fireEvent.change(await screen.findByTestId('tester-email'), { target: { value: 'nobody@x.ru' } })
    fireEvent.click(screen.getByTestId('tester-add'))
    expect(await screen.findByText(/не найден/)).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('tester-email'), { target: { value: 'owner@x.ru' } })
    fireEvent.click(screen.getByTestId('tester-add'))
    await waitFor(() => expect(api.addTesterByEmail).toHaveBeenLastCalledWith('owner@x.ru', null))
  })

  it('промокоды: пачка случайных — черновик уходит в admin_promo_create, коды показаны для копирования', async () => {
    api.createPromo.mockResolvedValue({ codes: ['OLYMP-AAAAAAAAAA', 'OLYMP-BBBBBBBBBB'], batch: 'OLYMP-1' })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Промокоды' }))
    fireEvent.change(await screen.findByTestId('promo-kind'), { target: { value: 'free_months' } })
    fireEvent.change(screen.getByTestId('promo-value'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('promo-max'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('promo-how'), { target: { value: 'batch' } })
    fireEvent.change(screen.getByTestId('promo-count'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('promo-create'))
    await waitFor(() => expect(api.createPromo).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'free_months', free_months: 3, percent: null, max_uses: 1, count: 2,
    })))
    expect(await screen.findByTestId('promo-created')).toHaveTextContent('Создано: 2')
  })

  it('промокоды: ошибка формы видна, в базу не уходит; список с «Что даёт» и выключением', async () => {
    api.fetchPromoCodes.mockResolvedValue([{
      id: 'pc1', code: 'HALF3', kind: 'percent', percent: 50, discount_payments: 3, free_days: null, free_months: null,
      course_id: null, course_title: null, tariff_id: null, tariff_title: null, max_uses: 100, used_count: 7,
      valid_from: null, valid_until: null, is_active: true, batch: null, note: 'блогер', created_at: '2026-10-10T09:00:00Z',
      saved_total_rub: 10150,
    }])
    api.setPromoActive.mockResolvedValue(undefined)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Промокоды' }))
    fireEvent.change(await screen.findByTestId('promo-value'), { target: { value: '150' } })
    fireEvent.change(screen.getByTestId('promo-code'), { target: { value: 'X1' } })
    fireEvent.click(screen.getByTestId('promo-create'))
    expect(await screen.findByTestId('promo-form-error')).toHaveTextContent('от 1 до 100')
    expect(api.createPromo).not.toHaveBeenCalled()
    const row = await screen.findByTestId('promo-row')
    expect(row).toHaveTextContent('−50 % на 3 платежа')
    expect(row).toHaveTextContent('7 из 100')
    fireEvent.click(screen.getByTestId('promo-toggle'))
    await waitFor(() => expect(api.setPromoActive).toHaveBeenCalledWith('pc1', false))
  })
})
