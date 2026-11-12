import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentBillingSummary, loadStudentBilling } from '../StudentBillingSummary'

const mocks = vi.hoisted(() => ({ subs: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/subscription/api', () => ({ fetchAdminSubscriptions: mocks.subs }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: mocks.select }) } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockReturnValue({ eq: mocks.eq })
  mocks.eq.mockReturnValue({ order: mocks.order })
  mocks.order.mockReturnValue({ limit: mocks.limit })
  mocks.subs.mockResolvedValue([
    { id: 'sub1', student_id: 's1', course_title: 'Физика', status: 'active', has_access: true, access_until: '2099-01-01', source: 'purchase', auto_renew: false },
    { id: 'sub2', student_id: 'other', course_title: 'Чужой курс' },
  ])
  mocks.limit.mockResolvedValue({ data: [
    { id: 'p1', subscription_id: 'sub1', amount_rub: 500, status: 'succeeded', is_test: true, created_at: '2026-11-12' },
    { id: 'p2', subscription_id: 'sub1', amount_rub: 600, status: 'pending', is_test: null, created_at: '2026-11-12' },
  ], error: null })
})
describe('карточка оплаты ученика', () => {
  it('фильтрует платежи по student_id в запросе, подписки по тому же ученику', async () => {
    const data = await loadStudentBilling('s1')
    expect(mocks.eq).toHaveBeenCalledWith('student_id', 's1')
    expect(data.subscriptions).toHaveLength(1)
  })
  it('показывает режимы, доступ и переход к нужному ученику', async () => {
    render(<MemoryRouter><StudentBillingSummary studentId="s1" email="student@example.com" /></MemoryRouter>)
    expect(await screen.findByText('Тестовый')).toBeInTheDocument()
    expect(screen.getByText('Не проверен')).toBeInTheDocument()
    expect(screen.getByText(/Доступ открыт/)).toBeInTheDocument()
    expect(screen.queryByText('Чужой курс')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Управлять/ })).toHaveAttribute('href', '/admin/finance?tab=subs&search=student%40example.com')
  })
  it('ошибка не выглядит как отсутствие платежей', async () => {
    mocks.limit.mockResolvedValue({ data: null, error: { message: 'denied' } })
    render(<MemoryRouter><StudentBillingSummary studentId="s1" email="a@b.ru" /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Платежей пока нет.')).not.toBeInTheDocument()
  })
})
