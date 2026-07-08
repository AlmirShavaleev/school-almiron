/**
 * Lifecycle for disposable PDF-export E2E fixtures (task collections).
 *
 * IMPORTANT: this project has no separate staging Supabase project — E2E
 * tests run against the same instance as VITE_SUPABASE_URL in .env. There is
 * no service role key checked into the repo or used here; every operation
 * below goes through the regular anon client + a real authenticated session
 * (physics@demo.ru), so it is bound by the same RLS policies as the app.
 * Destructive cleanup is therefore double-guarded:
 *   1. Only rows whose title starts with the `[E2E]` marker are ever deleted.
 *   2. The Supabase project ref extracted from SUPABASE_URL must match the
 *      single ref this fixture set is allowed to run against (see
 *      ALLOWED_PROJECT_REF below) — a safety net if this repo is ever pointed
 *      at a different/real production project.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// This runs as a plain Node script (Playwright global setup/teardown), not
// through Vite — VITE_SUPABASE_URL/ANON_KEY aren't in process.env unless we
// load .env ourselves. No new dependency: just a minimal KEY=VALUE parser,
// and it never overrides a value already set in the environment.
function loadDotEnvOnce() {
  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key || key.startsWith('#') || process.env[key] !== undefined) continue
    process.env[key] = line.slice(eq + 1).trim()
  }
}
loadDotEnvOnce()

export const E2E_PREFIX = '[E2E]'

// The only Supabase project this destructive fixture lifecycle is allowed to
// touch. If VITE_SUPABASE_URL ever points elsewhere (e.g. a real separate
// production project), createFixture/deleteFixture refuse to run.
const ALLOWED_PROJECT_REF = 'kthfozyfruorwjhvvsbw'

function getProjectRef(url: string): string {
  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (!match) throw new Error(`Cannot parse Supabase project ref from URL: ${url}`)
  return match[1]
}

function assertAllowedProject() {
  const url = process.env.VITE_SUPABASE_URL
  if (!url) throw new Error('VITE_SUPABASE_URL is not set — cannot run PDF E2E fixtures')
  const ref = getProjectRef(url)
  if (ref !== ALLOWED_PROJECT_REF) {
    throw new Error(
      `Refusing to run PDF E2E fixture lifecycle against project "${ref}" — ` +
      `only "${ALLOWED_PROJECT_REF}" is allow-listed. If this is intentional, ` +
      `update ALLOWED_PROJECT_REF in e2e/pdf-fixtures.ts.`,
    )
  }
}

let client: SupabaseClient | null = null

async function getClient(): Promise<SupabaseClient> {
  assertAllowedProject()
  if (client) return client

  const url = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set — cannot run PDF E2E fixtures')

  // Regular anon client — same key the browser app uses. No service role.
  const c = createClient(url, anonKey)
  const { error } = await c.auth.signInWithPassword({
    email:    'physics@demo.ru',
    password: 'demo123',
  })
  if (error) throw new Error(`PDF E2E fixture auth failed: ${error.message}`)

  client = c
  return c
}

export interface FixtureSpec {
  /** Title without the [E2E] prefix — it is added automatically. */
  title:    string
  subject:  'Математика' | 'Физика'
  workType: string
  taskIds:  string[]
}

export interface CreatedFixture {
  id:    string
  title: string
}

/** Creates one [E2E]-prefixed collection via the same RPC the app itself uses. */
export async function createFixture(spec: FixtureSpec): Promise<CreatedFixture> {
  const c = await getClient()
  const title = spec.title.startsWith(E2E_PREFIX) ? spec.title : `${E2E_PREFIX} ${spec.title}`

  const { data, error } = await c.rpc('save_collection_atomic', {
    p_collection_id: null,
    p_title:         title,
    p_description:   'Disposable PDF E2E fixture — safe to delete',
    p_subject:       spec.subject,
    p_work_type:     spec.workType,
    p_items:         spec.taskIds.map((id, idx) => ({
      catalog_task_id: id,
      position:        idx + 1,
      custom_number:   null,
    })),
  })
  if (error) throw new Error(`Failed to create PDF E2E fixture "${title}": ${error.message}`)

  return { id: data as string, title }
}

/**
 * Deletes a fixture collection — refuses unless its title is confirmed to
 * carry the [E2E] marker (fetched fresh from the DB, not trusted from the
 * caller), so a bad ID can never take out real user data.
 */
export async function deleteFixture(id: string): Promise<'deleted' | 'skipped_not_e2e' | 'already_gone'> {
  const c = await getClient()

  const { data: row, error: fetchError } = await c
    .from('task_collections')
    .select('id, title')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) throw new Error(`Failed to look up fixture ${id} before delete: ${fetchError.message}`)
  if (!row) return 'already_gone'
  if (!row.title.startsWith(E2E_PREFIX)) return 'skipped_not_e2e'

  // ON DELETE CASCADE on task_collection_items.collection_id — no need to
  // delete items separately.
  const { error: deleteError } = await c.from('task_collections').delete().eq('id', id)
  if (deleteError) throw new Error(`Failed to delete fixture ${id}: ${deleteError.message}`)

  return 'deleted'
}

/** Best-effort cleanup for a list of IDs — never throws, logs failures. */
export async function deleteFixtures(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      const result = await deleteFixture(id)
      console.log(`[pdf-fixtures] cleanup ${id}: ${result}`)
    } catch (err) {
      // Cleanup must not abort mid-list just because one row failed —
      // log and keep going so a single flaky delete doesn't leak the rest.
      console.error(`[pdf-fixtures] cleanup ${id} FAILED:`, err)
    }
  }
}
