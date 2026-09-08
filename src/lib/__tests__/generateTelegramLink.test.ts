import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * generate-telegram-link — Deno edge function, у проекта нет инфраструктуры
 * для его запуска в Vitest. Вместо этого стабим глобальный `Deno` (env +
 * serve перехватывает обработчик вместо реального запуска) и мокаем импорт
 * supabase-js по тому же URL-спецификатору, что использует сама функция —
 * поведение файла не меняется ни на строку, тестируется он как есть.
 */

interface TokenRow {
  id: string
  profile_id: string
  token_hash: string
  expires_at: string
  used_at: string | null
}

let rows: TokenRow[] = []
let rowSeq = 0
let capturedHandler: ((req: Request) => Promise<Response>) | null = null

vi.stubGlobal('Deno', {
  env: {
    get: (key: string) => ({
      SUPABASE_URL: 'https://example.test',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      TELEGRAM_BOT_USERNAME: 'AlmironBot',
    } as Record<string, string>)[key],
  },
  serve: (handler: (req: Request) => Promise<Response>) => { capturedHandler = handler },
})

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({
  createClient: (_url: string, key: string) => {
    if (key === 'anon-key') {
      return { auth: { getUser: async () => ({ data: { user: { id: 'profile-1' } }, error: null }) } }
    }
    // service-role admin client
    return {
      from: (table: string) => {
        if (table !== 'telegram_link_tokens') throw new Error(`unexpected table ${table}`)
        return {
          delete: () => ({
            eq: (_col: string, profileId: string) => ({
              is: (_col2: string, _val: null) => {
                rows = rows.filter(r => !(r.profile_id === profileId && r.used_at === null))
                return Promise.resolve({ error: null })
              },
            }),
          }),
          insert: (row: Omit<TokenRow, 'id' | 'used_at'>) => {
            rows.push({ id: `row-${++rowSeq}`, used_at: null, ...row })
            return Promise.resolve({ error: null })
          },
        }
      },
    }
  },
}))

// Путь собран не литералом нарочно: tsc -b иначе тянет index.ts (Deno,
// esm.sh-импорт) в граф проверки src и падает — сам файл при этом
// сознательно не входит в tsconfig ("tsc --noEmit edge-функции не
// проверяет", см. CLAUDE.md). Vite/Vitest резолвят такой импорт в рантайме
// как обычно, это ограничение только статического анализа typescript.
const EDGE_FUNCTION_PATH = ['..', '..', '..', 'supabase', 'functions', 'generate-telegram-link', 'index.ts'].join('/')

async function invoke(): Promise<{ link: string }> {
  if (!capturedHandler) {
    await import(EDGE_FUNCTION_PATH)
  }
  const req = new Request('https://example.test/generate-telegram-link', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
  })
  const res = await capturedHandler!(req)
  return res.json()
}

describe('generate-telegram-link — repeated clicks do not leave two live tokens', () => {
  beforeEach(() => {
    rows = []
    rowSeq = 0
  })

  it('a single click inserts exactly one row', async () => {
    await invoke()
    expect(rows).toHaveLength(1)
    expect(rows[0].profile_id).toBe('profile-1')
  })

  it('two consecutive clicks (double-press) leave exactly one live row, not two', async () => {
    await invoke()
    await invoke()
    expect(rows).toHaveLength(1)
  })

  it('each click still issues a fresh random token (no reuse) — only the stale row is cleared first', async () => {
    const { link: linkA } = await invoke()
    const { link: linkB } = await invoke()
    expect(linkA).not.toBe(linkB)
    expect(rows).toHaveLength(1)
  })

  it('sets a one-hour expiry, not fifteen minutes', async () => {
    const before = Date.now()
    await invoke()
    const expiresAt = new Date(rows[0].expires_at).getTime()
    const ttlMs = expiresAt - before
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1000)
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5_000)
  })
})
