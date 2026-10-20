import { describe, expect, it, vi } from 'vitest'
import { handleRelay, relayPath, safeEqual } from '../../../api/_lib/aiRelay'

// Ретранслятор к OpenRouter на Vercel (письмо ЛК_СРОЧНО_ИИ_через_ретранслятор_Vercel.md, 20.10).
const URL_OK = 'https://www.almiron.ru/api/ai-relay/chat/completions'
const SECRET = 'a'.repeat(64)

function req(over: { url?: string; method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Request(over.url ?? URL_OK, {
    method: over.method ?? 'POST',
    headers: { 'x-relay-secret': SECRET, authorization: 'Bearer sk-or-test', 'content-type': 'application/json', ...over.headers },
    body: (over.method ?? 'POST') === 'POST' ? (over.body ?? '{"model":"m","messages":[]}') : undefined,
  })
}

describe('ретранслятор ИИ', () => {
  it('без секрета или с чужим — 403, наверх ничего не уходит', async () => {
    const f = vi.fn()
    expect((await handleRelay(req({ headers: { 'x-relay-secret': '' } }), SECRET, f)).status).toBe(403)
    expect((await handleRelay(req({ headers: { 'x-relay-secret': 'b'.repeat(64) } }), SECRET, f)).status).toBe(403)
    expect(f).not.toHaveBeenCalled()
  })

  it('секрет на Vercel не задан — 503, а не открытый прокси', async () => {
    const f = vi.fn()
    expect((await handleRelay(req(), undefined, f)).status).toBe(503)
    expect(f).not.toHaveBeenCalled()
  })

  it('чужой путь — 404; не POST — 405; без Authorization — 401', async () => {
    const f = vi.fn()
    expect((await handleRelay(req({ url: 'https://www.almiron.ru/api/ai-relay/models' }), SECRET, f)).status).toBe(404)
    expect((await handleRelay(req({ url: 'https://www.almiron.ru/api/ai-relay/../auth/key' }), SECRET, f)).status).toBe(404)
    expect((await handleRelay(req({ method: 'GET' }), SECRET, f)).status).toBe(405)
    expect((await handleRelay(req({ headers: { authorization: '' } }), SECRET, f)).status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('проксирует: адрес OpenRouter, тело и нужные заголовки как есть; секрет наверх не уходит; статус и тело — обратно', async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response('{"error":{"message":"rate"}}', { status: 429, headers: { 'content-type': 'application/json' } }))
    const res = await handleRelay(req({ headers: { 'http-referer': 'https://alminion.ru', 'x-title': 'School Almiron', cookie: 'x=1' } }), SECRET, f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const h = new Headers(init.headers)
    expect(h.get('authorization')).toBe('Bearer sk-or-test')
    expect(h.get('x-title')).toBe('School Almiron')
    expect(h.get('x-relay-secret')).toBeNull()
    expect(h.get('cookie')).toBeNull()
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"model":"m","messages":[]}')
    expect(res.status).toBe(429)
    expect(await res.text()).toBe('{"error":{"message":"rate"}}')
  })

  it('недоступен OpenRouter — 502', async () => {
    const f = vi.fn(async () => { throw new Error('net') })
    expect((await handleRelay(req(), SECRET, f as unknown as typeof fetch)).status).toBe(502)
  })

  it('разбор пути и сравнение секрета', async () => {
    expect(relayPath('https://x/api/ai-relay/chat/completions?y=1')).toBe('chat/completions')
    expect(await safeEqual('abc', 'abc')).toBe(true)
    expect(await safeEqual('abc', 'abd')).toBe(false)
    expect(await safeEqual('abc', 'abcd')).toBe(false)
  })
})
