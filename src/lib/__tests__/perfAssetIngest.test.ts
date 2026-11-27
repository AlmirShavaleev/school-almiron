import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(resolve('supabase/migrations', name), 'utf8')
const person = '10000000-0000-4000-8000-000000000001'
const tab = '20000000-0000-4000-8000-000000000001'
const db = new PGlite()

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles (id uuid primary key, role text);
    insert into public.profiles values ('${person}', 'student');
  `)
  await db.exec(migration('20261012214345_perf_rum_291_a_tables.sql'))
  await db.exec(migration('20261127170106_perf_asset_failure_diagnostics.sql'))
}, 20_000)

afterAll(async () => { await db.close() })

it('ingests anonymous diagnostics, deduplicates retries and preserves the legacy API', async () => {
  const time = Date.now()
  const common = { k: 'nav', ms: 12, d: 'desktop', client_ms: time, build_id: 'build-a', tab_id: tab }
  const valid = { ...common, l: 'error asset', error_type: 'chunk_js', resource_url: '/assets/Lesson-DTw7_tVx.js', s: 404 }
  await db.exec(`select set_config('request.jwt.claim.sub', '${person}', false); set role authenticated;`)
  const batch = [
    valid, valid,
    { ...valid, client_ms: time + 1, resource_url: '/assets/Lesson-DTw7_tVx.js?token=private' },
    { ...common, l: 'error asset', error_type: 'secret answer' },
    { ...common, l: 'error runtime', error_type: 'runtime', resource_url: '/assets/Lesson-DTw7_tVx.js', answer: 'private' },
    { k: 'nav', l: 'error TypeError: user private', ms: 0, d: 'desktop' },
    { k: 'api', l: 'GET /rest/v1/profiles', ms: 17, s: 200, d: 'desktop' },
  ]
  expect((await db.query<{ n: number }>('select public.perf_ingest($1) as n', [JSON.stringify(batch)])).rows[0].n).toBe(5)
  await expect(db.query('select * from public.perf_events')).rejects.toThrow()
  await db.exec('reset role')
  const result = await db.query('select label, profile_id, role, resource_url, error_type, tab_id, status from public.perf_events order by id')
  expect(result.rows).toEqual([
    { label: 'error asset', profile_id: null, role: null, resource_url: '/assets/Lesson-DTw7_tVx.js', error_type: 'chunk_js', tab_id: tab, status: 404 },
    { label: 'error asset', profile_id: null, role: null, resource_url: null, error_type: 'chunk_js', tab_id: tab, status: 404 },
    { label: 'error runtime', profile_id: null, role: null, resource_url: null, error_type: 'runtime', tab_id: tab, status: null },
    { label: 'error legacy', profile_id: person, role: 'student', resource_url: null, error_type: null, tab_id: null, status: null },
    { label: 'GET /rest/v1/profiles', profile_id: person, role: 'student', resource_url: null, error_type: null, tab_id: null, status: 200 },
  ])
  expect(JSON.stringify(result.rows)).not.toContain('private')
})
