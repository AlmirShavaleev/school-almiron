import { beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }))
vi.mock('@/lib/readOnlyMode', () => ({ READ_ONLY_MODE: true }))
import { beginCheckout } from '@/lib/subscription/api'

beforeEach(() => vi.clearAllMocks())

it('оформляет подписку при закрытой сдаче работ', async () => {
  invoke.mockResolvedValue({ data: { confirmation_url: 'https://payment.test/confirm', payment_id: 'p1' }, error: null })
  const form = { email: ' kid@example.ru ', acceptedOffer: true, isMinor: true, parentConsent: true, saveCard: false }
  await expect(beginCheckout('t1', form)).resolves.toMatchObject({ payment_id: 'p1' })
  expect(invoke).toHaveBeenCalledWith('subscription-checkout', {
    body: expect.objectContaining({ tariff_id: 't1', receipt_email: 'kid@example.ru', save_card: false, parent_consent: true }),
  })
})

it('показывает ошибку платёжной функции без выдачи доступа', async () => {
  invoke.mockResolvedValue({ data: null, error: { message: 'HTTP error', context: { json: async () => ({ error: 'Оплата пока не настроена', code: 'NOT_CONFIGURED' }) } } })
  await expect(beginCheckout('t1', { email: 'kid@example.ru', acceptedOffer: true, isMinor: false, parentConsent: false, saveCard: false })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
})
