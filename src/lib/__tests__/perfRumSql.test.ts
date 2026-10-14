/**
 * §291. RUM в базе (PGlite, настоящие миграции §291 — таблицы и функции — поверх
 * заглушек): приём пачки и лимиты, профиль и роль — с сервера, ученик не
 * читает сырьё, сводки только админу, почасовая свёртка и чистка.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, STUBS } from '../../test/sql/migrationChain'

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), KID = U(2), KID2 = U(3)
let db: PGlite

async function as(uid: string | null) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
}
async function val<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, p)
  return Object.values(r.rows[0] ?? {})[0] as T
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await db.query(sql, p); return null } catch (e) {
    const err = e as { message?: string; hint?: string }
    return `${err.hint ?? ''} ${err.message ?? ''}`
  }
}
const ev = (k: string, l: string, ms: number, s?: number) => (s == null ? { k, l, ms, d: 'mobile' } : { k, l, ms, s, d: 'desktop' })
const ingest = (events: unknown[]) => val<number>(`select perf_ingest($1::jsonb)`, [JSON.stringify(events)])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(STUBS, 'utf8'))
  // Таблицы (через MCP) и функции (SQL Editor) применены отдельно — два файла.
  for (const re of [/^\d+_perf_rum_291_a_tables\.sql$/, /^\d+_291_perf_functions\.sql$/]) {
    const name = readdirSync(MIGRATIONS).find((f) => re.test(f))
    if (!name) throw new Error(`Не найдена миграция §291 ${re}`)
    await db.exec(readFileSync(path.join(MIGRATIONS, name), 'utf8'))
  }
  for (const [id, role] of [[ADMIN, 'admin'], [KID, 'student'], [KID2, 'student']] as const) {
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)`, [id, `u${id.slice(-2)}@t.ru`, `Имя${id.slice(-2)}`, role])
  }
}, 60_000)

afterAll(async () => { await db?.close() })

describe('§291 RUM: приём', () => {
  it('аноним — ничего; ученик — пачка с ролью и профилем с сервера; мусор отброшен', async () => {
    await as(null)
    expect(await ingest([ev('route', '/catalog', 120)])).toBe(0)
    await as(KID)
    const n = await ingest([
      ev('route', '/my-course/:id', 850),
      ev('api', 'POST /rest/v1/rpc/student_home_activity', 420, 200),
      ev('nav', 'ttfb /', 90),
      { k: 'route', l: '/x', ms: 'много' },          // не число
      { k: 'evil', l: '/x', ms: 5 },                  // чужой вид
      { k: 'route', l: '', ms: 5 },                   // пустая метка
      { k: 'route', l: '/y', ms: 99999999 },          // зажимается до 600 000
      'строка',
    ])
    expect(n).toBe(4)
    const rows = (await db.query<{ profile_id: string; role: string; ms: number; device: string }>(
      `select profile_id, role, ms, device from perf_events order by id`)).rows
    expect(rows.every((r) => r.profile_id === KID && r.role === 'student')).toBe(true)
    expect(rows.map((r) => r.ms)).toEqual([850, 420, 90, 600000])
    expect(rows[1].device).toBe('desktop')
  })

  it('не больше 200 за вызов; не больше 1 200 за 10 минут на профиль', async () => {
    await as(KID2)
    expect(await ingest(Array.from({ length: 250 }, (_, i) => ev('api', 'GET /rest/v1/topics', i)))).toBe(200)
    for (let i = 0; i < 5; i++) await ingest(Array.from({ length: 200 }, () => ev('api', 'GET /rest/v1/topics', 5)))
    expect(await val(`select count(*)::int from perf_events where profile_id = $1`, [KID2])).toBe(1200)
    expect(await ingest([ev('route', '/catalog', 10)])).toBe(0)
  })

  it('ученик не читает сырьё и агрегаты — ни чужое, ни своё; админ-функции — только админу', async () => {
    await as(KID)
    await db.exec('set role authenticated')
    try {
      expect(await errorOf(`select * from perf_events`)).toContain('permission denied')
      expect(await errorOf(`select * from perf_hourly`)).toContain('permission denied')
    } finally {
      await db.exec('reset role')
    }
    expect(await errorOf(`select admin_perf_summary('route', now() - interval '1 day', now())`)).toContain('ONLY_ADMIN')
    expect(await errorOf(`select admin_perf_recent($1)`, [KID2])).toContain('ONLY_ADMIN')
  })
})

describe('§291 RUM: экран админки', () => {
  it('сводка: p50/p95/кол-во по метке, сортировка по p95; фильтр по ученику', async () => {
    await as(KID)
    await ingest([100, 200, 300, 400, 5000].map((ms) => ev('route', '/homework', ms)))
    await as(ADMIN)
    const all = await val<Array<Record<string, number | string>>>(
      `select admin_perf_summary('route', now() - interval '1 hour', now() + interval '1 minute')`)
    const hw = all.find((r) => r.label === '/homework')!
    expect(hw).toMatchObject({ n: 5, p50: 300, p95: 5000, max: 5000, students: 1 })
    // медленные сверху: p95 по убыванию (первым — /y на 600 000 мс из первого теста)
    const p95s = all.map((r) => Number(r.p95))
    expect(p95s).toEqual([...p95s].sort((a, b) => b - a))
    expect(all[0].label).toBe('/y')
    const mine = await val<unknown[]>(`select admin_perf_summary('api', now() - interval '1 hour', now() + interval '1 minute', $1)`, [KID])
    expect(mine).toHaveLength(1)
    const people = await val<Array<Record<string, unknown>>>(`select admin_perf_people(now() - interval '1 hour', now() + interval '1 minute')`)
    expect(people.map((p) => p.profile_id).sort()).toEqual([KID, KID2].sort())
    const recent = await val<unknown[]>(`select admin_perf_recent($1, 3)`, [KID])
    expect(recent).toHaveLength(3)
  })

  it('свёртка по часам и график: p95 и учеников в час; повторная свёртка — то же', async () => {
    await as(null)
    await db.query(`update perf_events set at = date_trunc('hour', now()) - interval '2 hours' + interval '5 minutes' where label = '/homework'`)
    expect(await val(`select perf_rollup(4)`)).toBeGreaterThan(0)
    const again = await val<number>(`select perf_rollup(4)`)
    expect(again).toBeGreaterThan(0)
    expect(await val(`select count(*)::int from perf_hourly where label = '/homework'`)).toBe(1)
    await as(ADMIN)
    const hours = await val<Array<Record<string, number>>>(
      `select admin_perf_hourly('route', '/homework', now() - interval '1 day', now() + interval '1 minute')`)
    expect(hours).toHaveLength(1)
    // в тот час события были только у одного ученика
    expect(hours[0]).toMatchObject({ n: 5, p95: 5000, students: 1 })
  })

  it('чистка: сырьё старше 60 дней удаляется', async () => {
    await as(null)
    await db.query(`update perf_events set at = now() - interval '61 days' where label = '/homework'`)
    expect(await val(`select perf_cleanup()`)).toBe(5)
  })
})
