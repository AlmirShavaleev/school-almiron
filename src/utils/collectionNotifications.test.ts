// Миграция уехала в supabase/migrations/_legacy при уборке нумерации.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/_legacy/019_collection_notifications.sql', 'utf8')
const worker = readFileSync('supabase/functions/process-notification-queue/index.ts', 'utf8')

describe('collection notification migration', () => {
  it('keeps helper restricted and idempotent', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain("SET search_path TO 'public'")
    expect(migration).toContain('ON CONFLICT (deduplication_key) DO NOTHING')
    expect(migration).toContain('FROM PUBLIC, anon')
    expect(migration).toContain('TO authenticated, service_role')
    for (const status of ['queued', 'duplicate', 'disabled', 'not_connected', 'error']) expect(migration).toContain(`'${status}'`)
  })

  it('queues all events for correct recipients', () => {
    expect(migration).toContain('queue_collection_notification(v_rec.profile_id')
    expect(migration).toContain("'collection_submitted'")
    expect(migration).toContain("'collection_resubmitted'")
    expect(migration).toContain('queue_collection_notification(v_teacher_id')
    expect(migration).toContain("'collection_reviewed'")
    expect(migration).toContain('queue_collection_notification(v_profile_id')
  })

  it('classifies resubmit before upsert and uses submitted_at in dedup', () => {
    const classify = migration.indexOf('v_event_type := CASE WHEN v_existing.id IS NULL')
    expect(migration.indexOf('INSERT INTO task_submissions', classify)).toBeGreaterThan(classify)
    expect(migration).toContain("to_char(v_row.submitted_at AT TIME ZONE 'UTC'")
  })

  it('isolates notification failures in every RPC', () => {
    expect(migration.match(/EXCEPTION WHEN OTHERS THEN NULL;/g)).toHaveLength(4)
  })

  it('preserves guards and excludes unrelated RPCs', () => {
    for (const guard of ['auth_owns_lesson', 'auth_is_assigned_student', 'auth_owns_assignment', 'created_by = auth.uid()']) expect(migration).toContain(guard)
    expect(migration).not.toContain('sync_group_assignment')
    expect(migration).not.toContain('retry_notification')
  })
})

describe('collection worker messages', () => {
  it.each(['collection_assigned', 'collection_submitted', 'collection_resubmitted', 'collection_reviewed'])(
    'handles %s', (event) => expect(worker).toContain(`case '${event}'`),
  )
})
