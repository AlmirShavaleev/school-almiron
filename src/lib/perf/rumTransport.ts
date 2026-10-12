/**
 * §291. Куда RUM отправляет пачки: RPC `perf_ingest` (обычно) и keepalive-запрос
 * при уходе со страницы (sendBeacon не умеет заголовок авторизации).
 * Токен — из сессии supabase-js; без входа не шлём.
 */
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase'
import type { PerfEvent, RumTransport } from './rum'

let token: string | null = null

// В тестах supabase бывает подменён без auth — RUM молчит, приложение цело.
try {
  supabase.auth.getSession()
    .then(({ data }) => { token = data.session?.access_token ?? null })
    .catch(() => {})
  supabase.auth.onAuthStateChange((_e, session) => { token = session?.access_token ?? null })
} catch {
  token = null
}

export const rumTransport: RumTransport = {
  signedIn: () => !!token,
  send: (events: PerfEvent[]) => Promise.resolve(supabase.rpc('perf_ingest' as never, { p_events: events } as never)),
  sendOnExit: (events: PerfEvent[]) => {
    if (!token) return
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/perf_ingest`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_events: events }),
    }).catch(() => {})
  },
}
