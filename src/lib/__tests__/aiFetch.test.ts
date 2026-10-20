import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AI_TIMEOUT_MESSAGE, aiChatFetch, aiHeaders } from '../../../supabase/functions/check-homework-ai/aiFetch'

// Запрос к модели из четырёх ИИ-функций (письмо ЛК_СРОЧНО_ИИ_через_ретранслятор_Vercel.md, 20.10).
const env = (vars: Record<string, string>) => (name: string) => vars[name]

describe('aiFetch', () => {
  it('X-Relay-Secret — только когда задан AI_RELAY_SECRET', () => {
    expect(aiHeaders('k', env({}))['X-Relay-Secret']).toBeUndefined()
    expect(aiHeaders('k', env({ AI_RELAY_SECRET: '  ' }))['X-Relay-Secret']).toBeUndefined()
    const h = aiHeaders('k', env({ AI_RELAY_SECRET: 's3' }), { 'X-Title': 'School Almiron' })
    expect(h).toMatchObject({ Authorization: 'Bearer k', 'Content-Type': 'application/json', 'X-Relay-Secret': 's3', 'X-Title': 'School Almiron' })
  })

  it('адрес — AI_BASE_URL + /chat/completions, тело JSON, есть таймаут', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response('{}'))
    await aiChatFetch('https://www.almiron.ru/api/ai-relay/', 'k', { a: 1 }, env({ AI_RELAY_SECRET: 's' }), {}, 120_000, f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://www.almiron.ru/api/ai-relay/chat/completions')
    expect(init.body).toBe('{"a":1}')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init.headers).get('x-relay-secret')).toBe('s')
  })

  it('модель не ответила — понятная ошибка для last_error', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
    }))
    await expect(aiChatFetch('https://x', 'k', {}, env({}), {}, 20, f as unknown as typeof fetch)).rejects.toThrow(AI_TIMEOUT_MESSAGE)
  })

  it('во всех четырёх функциях — одинаковая копия файла (в _shared нельзя: деплой -Shared)', () => {
    const root = path.resolve(__dirname, '../../../supabase/functions')
    const read = (fn: string) => readFileSync(path.join(root, fn, 'aiFetch.ts'), 'utf8').replace(/\r\n/g, '\n')
    const base = read('check-homework-ai')
    for (const fn of ['check-mock-exam-ai', 'rewrite-homework-comment', 'student-feedback-ai']) expect(read(fn)).toBe(base)
  })
})
