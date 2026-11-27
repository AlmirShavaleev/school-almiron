import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [port, snapshotFile] = process.argv.slice(2)
const client = process.env.ALMIRON_TEST_PG_CLIENT
if (!/^\d+$/.test(port ?? '') || !snapshotFile || !client) {
  throw new Error('Usage: ALMIRON_TEST_PG_CLIENT=/path/to/pg/index.js node scripts/test-perf-pg17.mjs LOCAL_PORT SCHEMA_SNAPSHOT')
}
const module = await import(pathToFileURL(client).href)
const { Pool } = module.default ?? module
const pool = new Pool({ host: '127.0.0.1', port: Number(port), user: 'postgres', database: 'almiron_preflight', max: 40 })
const ids = ['21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002']

async function ingest(sender, events, role = 'authenticated') {
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    await connection.query("select set_config('request.jwt.claim.sub', $1, true)", [sender])
    await connection.query(role === 'anon' ? 'set local role anon' : 'set local role authenticated')
    const result = await connection.query('select public.perf_ingest($1) as count', [JSON.stringify(events)])
    await connection.query('COMMIT')
    return result.rows[0].count
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally { connection.release() }
}

try {
  const { rows: [environment] } = await pool.query("select current_setting('server_version_num')::int as version, to_regclass('public.perf_events') as existing")
  assert(environment.version >= 170000 && environment.version < 180000, 'requires PostgreSQL 17')
  assert.equal(environment.existing, null, 'use an empty local test database')
  await pool.query(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid stable language sql
      as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table public.profiles(id uuid primary key, role text);
  `)
  for (const id of ids) await pool.query("insert into public.profiles values ($1, 'student')", [id])
  await pool.query(await readFile(snapshotFile, 'utf8'))
  const legacy = [{ k: 'api', l: 'GET /rest/v1/profiles', ms: 17, s: 200, d: 'desktop' }]
  assert.equal(await ingest(ids[0], legacy), 1)
  const { rows: [acl] } = await pool.query(`
    select
      (select relrowsecurity from pg_class where oid='public.perf_events'::regclass) as rls,
      has_table_privilege('service_role', 'public.perf_events', 'MAINTAIN') as maintain,
      has_function_privilege('anon', 'public.perf_ingest(jsonb)', 'execute') as anon_exec
  `)
  assert.deepEqual(acl, { rls: true, maintain: true, anon_exec: false })
  console.log(`Restored production schema and legacy RPC on PostgreSQL ${environment.version}`)

  await pool.query(await readFile(new URL('../supabase/migrations/20261127170106_perf_asset_failure_diagnostics.sql', import.meta.url), 'utf8'))
  assert.equal(await ingest(ids[0], legacy), 1)
  await assert.rejects(ingest('', legacy, 'anon'), { code: '42501' })
  assert.equal(await ingest('', legacy), 0)
  assert.equal((await pool.query("select has_table_privilege('authenticated','public.perf_ingest_rate','select') as can_read")).rows[0].can_read, false)

  const time = Date.now()
  const diagnostic = ordinal => ({
    k: 'nav', l: 'error asset', ms: 12, d: 'desktop', s: 404,
    client_ms: time + ordinal, build_id: 'synthetic-build', error_type: 'chunk_js',
    resource_url: '/assets/Lesson-Abc12345.js',
    tab_id: `31000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    profile_id: ids[1],
  })
  // Warm independent connections so the measured burst fits inside one refill period.
  const connections = await Promise.all(Array.from({ length: 32 }, () => pool.connect()))
  for (const connection of connections) connection.release()
  await pool.query('truncate public.perf_ingest_rate')
  const started = Date.now()
  const results = await Promise.all(Array.from({ length: 30 }, (_, n) => ingest(ids[0], [diagnostic(n + 1)])))
  assert(Date.now() - started < 5000, 'parallel requests exceeded the refill interval')
  assert.equal(results.filter(result => result === 1).length, 12)
  assert.equal(results.filter(result => result === 0).length, 18)
  assert.equal(await ingest(ids[0], [diagnostic(31)]), 0)
  assert.equal(await ingest(ids[1], [diagnostic(32)]), 1)
  const { rows: [stats] } = await pool.query(`
    select count(*)::int as diagnostics, count(profile_id)::int as linked_profiles, count(role)::int as linked_roles
      from public.perf_events where error_type is not null
  `)
  assert.deepEqual(stats, { diagnostics: 13, linked_profiles: 0, linked_roles: 0 })
  console.log('30 concurrent calls from one sender: 12 accepted, 18 limited; changed tab IDs and a claimed profile did not bypass the limit')
  console.log('A separate authenticated sender had its own budget; unauthenticated callers were rejected')
} finally {
  await pool.end()
}
