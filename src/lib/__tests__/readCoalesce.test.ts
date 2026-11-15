/**
 * 15.11. Одинаковые чтения из базы — один запрос; запись чистит память;
 * токен — часть ключа; отмена одного потребителя не обрывает других.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTENT_TTL_MS, READ_TTL_MS, __readCacheSizeForTests, clearReadCache, coalesceReads, configureReadCache } from '../perf/readCoalesce'

const BASE = 'https://p.supabase.co'
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, apikey: 'anon' })

function deferred() {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>(r => { resolve = r })
  return { promise, resolve }
}

let clock = 1_000
const now = () => clock

beforeEach(() => {
  clearReadCache()
  clock = 1_000
  configureReadCache({ ttlEnabled: () => true })
})

describe('coalesceReads', () => {
  it('одновременные одинаковые GET — один запрос, каждый получает свой читаемый ответ', async () => {
    const d = deferred()
    const base = vi.fn(() => d.promise)
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/group_students?select=group_id&student_id=eq.s1`
    const a = f(url, { method: 'GET', headers: auth('t1') })
    const b = f(url, { method: 'GET', headers: auth('t1') })
    d.resolve(new Response('[{"group_id":"g1"}]', { status: 200 }))
    const [ra, rb] = await Promise.all([a, b])
    expect(base).toHaveBeenCalledTimes(1)
    expect(await ra.json()).toEqual([{ group_id: 'g1' }])
    expect(await rb.json()).toEqual([{ group_id: 'g1' }])
  })

  it('чтение RPC из списка с тем же телом — один запрос; другое тело — отдельный', async () => {
    const base = vi.fn(async () => new Response('{}', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/rpc/get_student_topic_journal`
    await Promise.all([
      f(url, { method: 'POST', body: '{"p_student_id":"s1"}', headers: auth('t1') }),
      f(url, { method: 'POST', body: '{"p_student_id":"s1"}', headers: auth('t1') }),
      f(url, { method: 'POST', body: '{"p_student_id":"s2"}', headers: auth('t1') }),
    ])
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('удачный ответ отдаётся из памяти READ_TTL_MS, потом снова идёт в базу', async () => {
    const base = vi.fn(async () => new Response('[]', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/courses?id=in.(c1)`
    await f(url, { headers: auth('t1') })
    clock += READ_TTL_MS - 1
    await f(url, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(1)
    clock += 2
    await f(url, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('справочные данные курса — минуту, личный прогресс — 5 с', async () => {
    const base = vi.fn(async () => new Response('[]', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const program = `${BASE}/rest/v1/modules?select=id,topics(*)&course_id=eq.c1`
    const progress = `${BASE}/rest/v1/topic_homework_attempts?student_id=eq.s1`
    await f(program, { headers: auth('t1') })
    await f(progress, { headers: auth('t1') })
    clock += READ_TTL_MS + 1
    await f(program, { headers: auth('t1') })
    await f(progress, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(3) // программа из памяти, прогресс — заново
    clock += CONTENT_TTL_MS
    await f(program, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(4)
  })

  it('без включённого кэша (персонал) — только объединение одновременных', async () => {
    configureReadCache({ ttlEnabled: () => false })
    const base = vi.fn(async () => new Response('[]', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/topic_homework_attempts?id=eq.a1`
    await f(url, { headers: auth('t1') })
    await f(url, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('ошибки и 4xx/5xx не запоминаются', async () => {
    const base = vi.fn(async () => new Response('{"code":"PGRST003"}', { status: 504 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/modules?course_id=eq.c1`
    expect((await f(url, { headers: auth('t1') })).status).toBe(504)
    await f(url, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(2)
    expect(__readCacheSizeForTests()).toBe(0)
  })

  it('запись (ответ на задачу, правка таблицы, загрузка) очищает память', async () => {
    const base = vi.fn(async () => new Response('[]', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const read = `${BASE}/rest/v1/topic_autocheck_answers?profile_id=eq.me`
    await f(read, { headers: auth('t1') })
    await f(`${BASE}/rest/v1/rpc/topic_autocheck_check`, { method: 'POST', body: '{"p_task_id":"x"}', headers: auth('t1') })
    await f(read, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(3)
    await f(`${BASE}/rest/v1/topic_section_marks`, { method: 'POST', body: '{}', headers: auth('t1') })
    await f(`${BASE}/storage/v1/object/topic-homework-attempts/a.jpg`, { method: 'POST', body: 'x', headers: auth('t1') })
    await f(read, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(6)
  })

  it('фоновые отметки и обновление токена память не чистят и не объединяются', async () => {
    const base = vi.fn(async () => new Response('[]', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const read = `${BASE}/rest/v1/courses?id=eq.c1`
    await f(read, { headers: auth('t1') })
    await f(`${BASE}/rest/v1/rpc/school_presence_touch`, { method: 'POST', body: '{}', headers: auth('t1') })
    await f(`${BASE}/rest/v1/rpc/school_presence_touch`, { method: 'POST', body: '{}', headers: auth('t1') })
    await f(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: '{}' })
    await f(read, { headers: auth('t1') })
    expect(base).toHaveBeenCalledTimes(4) // чтение 1 раз + 2 отметки + токен
  })

  it('разные токены (другой человек) не делят ответ', async () => {
    const base = vi.fn(async () => new Response('[]', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/profiles?id=eq.u1`
    await Promise.all([f(url, { headers: auth('t1') }), f(url, { headers: auth('t2') })])
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('отмена одного потребителя не обрывает общий запрос другого', async () => {
    const d = deferred()
    const base = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => { expect(init?.signal).toBeUndefined(); return d.promise })
    const f = coalesceReads(base as unknown as typeof fetch, now)
    const url = `${BASE}/rest/v1/topic_homework?topic_id=eq.t1`
    const ctl = new AbortController()
    const a = f(url, { headers: auth('t1'), signal: ctl.signal })
    const b = f(url, { headers: auth('t1') })
    ctl.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    d.resolve(new Response('[{"id":"h1"}]', { status: 200 }))
    expect(await (await b).json()).toEqual([{ id: 'h1' }])
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('GET /auth/v1/user объединяется; storage и realtime проходят как есть', async () => {
    const base = vi.fn(async () => new Response('{}', { status: 200 }))
    const f = coalesceReads(base as unknown as typeof fetch, now)
    await Promise.all([f(`${BASE}/auth/v1/user`, { headers: auth('t1') }), f(`${BASE}/auth/v1/user`, { headers: auth('t1') })])
    expect(base).toHaveBeenCalledTimes(1)
    await f(`${BASE}/storage/v1/object/public/x.svg`)
    await f(`${BASE}/storage/v1/object/public/x.svg`)
    expect(base).toHaveBeenCalledTimes(3)
  })
})
