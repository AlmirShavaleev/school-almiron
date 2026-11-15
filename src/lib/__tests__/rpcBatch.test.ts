/**
 * 15.11. Одновременные чтения RPC — одним rpc_batch; ответы раздаются в формате
 * PostgREST; без функции в базе и при обрыве сети — по одному, как раньше.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_WINDOW_MS, __resetRpcBatchForTests, batchRpc } from '../perf/rpcBatch'
import { READ_RPC } from '../perf/readCoalesce'

const BASE = 'https://p.supabase.co'
const hdr = (t = 't1') => ({ Authorization: `Bearer ${t}`, apikey: 'anon', 'Content-Type': 'application/json' })
const rpc = (fn: string) => `${BASE}/rest/v1/rpc/${fn}`

beforeEach(() => { __resetRpcBatchForTests(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

async function settle() { await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 1) }

describe('batchRpc', () => {
  it('два чтения в одно окно — один rpc_batch; каждому свой статус и тело', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({ p_calls: [{ fn: 'my_subscriptions', args: {} }, { fn: 'my_course_access', args: { p_course_id: 'c1' } }] })
      return new Response(JSON.stringify([{ status: 200, body: { active: true } }, { status: 403, body: { code: '42501', message: 'нет доступа' } }]), { status: 200 })
    })
    const f = batchRpc(base as unknown as typeof fetch)
    const a = f(rpc('my_subscriptions'), { method: 'POST', headers: hdr(), body: '{}' })
    const b = f(rpc('my_course_access'), { method: 'POST', headers: hdr(), body: '{"p_course_id":"c1"}' })
    await settle()
    const [ra, rb] = await Promise.all([a, b])
    expect(base).toHaveBeenCalledTimes(1)
    expect(String(base.mock.calls[0][0])).toBe(rpc('rpc_batch'))
    expect(ra.status).toBe(200)
    expect(await ra.json()).toEqual({ active: true })
    expect(rb.status).toBe(403)
    expect((await rb.json()).code).toBe('42501')
  })

  it('JSON null и скаляры отдаются как у PostgREST', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify([{ status: 200, body: null }, { status: 200, body: true }]), { status: 200 }))
    const f = batchRpc(base as unknown as typeof fetch)
    const a = f(rpc('my_topic_rating'), { method: 'POST', headers: hdr(), body: '{"p_topic_id":"t"}' })
    const b = f(rpc('subscription_enabled'), { method: 'POST', headers: hdr(), body: '{}' })
    await settle()
    expect(await (await a).text()).toBe('null')
    expect(await (await b).json()).toBe(true)
  })

  it('один вызов в окне — уходит как есть, без пакета', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response('{}', { status: 200 }))
    const f = batchRpc(base as unknown as typeof fetch)
    const a = f(rpc('my_work_mode'), { method: 'POST', headers: hdr(), body: '{}' })
    await settle()
    await a
    expect(String(base.mock.calls[0][0])).toBe(rpc('my_work_mode'))
  })

  it('разные входы (токены) не попадают в один пакет', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response('{}', { status: 200 }))
    const f = batchRpc(base as unknown as typeof fetch)
    const a = f(rpc('my_work_mode'), { method: 'POST', headers: hdr('t1'), body: '{}' })
    const b = f(rpc('my_work_mode'), { method: 'POST', headers: hdr('t2'), body: '{}' })
    await settle()
    await Promise.all([a, b])
    expect(base).toHaveBeenCalledTimes(2)
    expect(base.mock.calls.every(c => String(c[0]) === rpc('my_work_mode'))).toBe(true)
  })

  it('не из списка чтения, single() и записи — мимо пакета сразу', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response('{}', { status: 200 }))
    const f = batchRpc(base as unknown as typeof fetch)
    await f(rpc('topic_autocheck_check'), { method: 'POST', headers: hdr(), body: '{}' })
    await f(rpc('my_work_mode'), { method: 'POST', headers: { ...hdr(), Accept: 'application/vnd.pgrst.object+json' }, body: '{}' })
    await f(`${BASE}/rest/v1/topics?id=eq.1`, { headers: hdr() })
    expect(base).toHaveBeenCalledTimes(3)
  })

  it('rpc_batch нет в базе (404) — каждый вызов по одному, пакет выключается', async () => {
    const base = vi.fn(async (u: RequestInfo | URL) =>
      String(u).endsWith('/rpc_batch') ? new Response('{"code":"PGRST202"}', { status: 404 }) : new Response('"ok"', { status: 200 }))
    const f = batchRpc(base as unknown as typeof fetch)
    const a = f(rpc('my_work_mode'), { method: 'POST', headers: hdr(), body: '{}' })
    const b = f(rpc('my_subscriptions'), { method: 'POST', headers: hdr(), body: '{}' })
    await settle()
    expect(await (await a).json()).toBe('ok')
    expect(await (await b).json()).toBe('ok')
    base.mockClear()
    const c = f(rpc('my_work_mode'), { method: 'POST', headers: hdr(), body: '{}' })
    const d = f(rpc('my_subscriptions'), { method: 'POST', headers: hdr(), body: '{}' })
    await settle()
    await Promise.all([c, d])
    expect(base.mock.calls.some(x => String(x[0]).endsWith('/rpc_batch'))).toBe(false)
  })

  it('ошибка пакета целиком (504 пула) — каждому тот же ответ', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response('{"code":"PGRST003"}', { status: 504 }))
    const f = batchRpc(base as unknown as typeof fetch)
    const a = f(rpc('my_work_mode'), { method: 'POST', headers: hdr(), body: '{}' })
    const b = f(rpc('my_subscriptions'), { method: 'POST', headers: hdr(), body: '{}' })
    await settle()
    expect((await a).status).toBe(504)
    expect((await (await b).json()).code).toBe('PGRST003')
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('список функций на клиенте совпадает со списком в миграции rpc_batch', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261115131549_rpc_batch_fix_arg_types.sql'), 'utf8')
    const block = sql.slice(sql.indexOf('v_allowed constant text[] := array['), sql.indexOf('];'))
    const names = [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
    expect(names).toEqual([...READ_RPC].sort())
  })
})
