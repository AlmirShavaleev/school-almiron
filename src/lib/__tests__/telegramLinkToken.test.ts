import { describe, expect, it } from 'vitest'
import { deriveToken, sha256Hex, TOKEN_TTL_MS } from '../../../supabase/functions/_shared/telegramLinkToken'

/**
 * Эти же примитивы дёргает generate-telegram-link (Deno) — тест гоняет их
 * из Vitest/Node, благо Web Crypto (`crypto.subtle`) стандартна в обоих.
 */
describe('telegramLinkToken — reuse mechanics behind "повторное нажатие отдаёт тот же токен"', () => {
  const secret = 'test-service-role-key'

  it('derives the exact same token for the same id — this is what makes reuse safe', async () => {
    const id = 'a1111111-1111-1111-1111-111111111111'
    const first  = await deriveToken(secret, id)
    const second = await deriveToken(secret, id)
    expect(first).toBe(second)
  })

  it('derives a different token for a different id', async () => {
    const tokenA = await deriveToken(secret, 'a1111111-1111-1111-1111-111111111111')
    const tokenB = await deriveToken(secret, 'b2222222-2222-2222-2222-222222222222')
    expect(tokenA).not.toBe(tokenB)
  })

  it('produces a URL-safe token (matches Telegram deep-link payload charset, no padding)', async () => {
    const token = await deriveToken(secret, 'c3333333-3333-3333-3333-333333333333')
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeLessThanOrEqual(64) // предел Telegram на длину /start-payload
  })

  it('sha256Hex of the re-derived token matches the hash the webhook would compute independently', async () => {
    const id = 'd4444444-4444-4444-4444-444444444444'
    const tokenFromFirstRequest  = await deriveToken(secret, id)
    const tokenFromSecondRequest = await deriveToken(secret, id) // «повторное нажатие»
    const storedHash  = await sha256Hex(tokenFromFirstRequest)
    const webhookHash = await sha256Hex(tokenFromSecondRequest) // как бы прислал Telegram
    expect(webhookHash).toBe(storedHash)
  })

  it('TTL is one hour, not fifteen minutes', () => {
    expect(TOKEN_TTL_MS).toBe(60 * 60 * 1000)
  })
})
