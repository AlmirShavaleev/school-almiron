import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/migrations/010_homework_assignments.sql'), 'utf8')
const createModal = readFileSync(join(root, 'src/components/modals/CreateHomeworkModal.tsx'), 'utf8')
const assignModal = readFileSync(join(root, 'src/components/modals/AssignHomeworkModal.tsx'), 'utf8')

describe('homework assignments phase A migration', () => {
  it('keeps homeworks as a topic-level template without reintroducing group_id', () => {
    expect(migration).toContain('alter table homeworks')
    expect(migration).toContain('add column if not exists instructions')
    expect(migration).toContain('add column if not exists attachments')
    expect(migration).toContain('add column if not exists is_published')
    expect(migration).not.toMatch(/alter table homeworks[\s\S]{0,300}group_id/i)
  })

  it('creates assignment and per-student assignment tables with correct uniqueness', () => {
    expect(migration).toContain('create table if not exists homework_assignments')
    expect(migration).toContain('create table if not exists homework_student_assignments')
    expect(migration).toContain('unique(assignment_id, student_id)')
    expect(migration).not.toContain('unique(homework_id, student_id)')
  })

  it('enforces exactly one assignment target', () => {
    expect(migration).toContain('homework_assignments_exactly_one_target')
    expect(migration).toContain('group_id is not null and student_id is null')
    expect(migration).toContain('group_id is null and student_id is not null')
  })

  it('creates homework items that reference catalog tasks instead of copying them', () => {
    expect(migration).toContain('create table if not exists homework_items')
    expect(migration).toContain('catalog_task_id uuid')
    expect(migration).toContain("item_type in ('catalog_task', 'text', 'file', 'link')")
    expect(migration).toContain('unique(homework_id, position)')
  })

  it('adapts homework_submissions to attempt history without destructive migration', () => {
    expect(migration).toContain('add column if not exists student_assignment_id')
    expect(migration).toContain('add column if not exists attempt_number')
    expect(migration).toContain('add column if not exists text_answer')
    expect(migration).toContain('drop constraint if exists homework_submissions_homework_id_student_id_key')
    expect(migration).toContain('homework_submissions_student_assignment_attempt_key')
    expect(migration).not.toMatch(/drop table homework_submissions/i)
  })

  it('assign_homework validates rights, deduplicates students, and creates notifications', () => {
    expect(migration).toContain('create or replace function assign_homework')
    expect(migration).toContain('not allowed to assign this homework')
    expect(migration).toContain('create temporary table tmp_hw_assign_students')
    expect(migration).toContain('on conflict (student_id) do nothing')
    expect(migration).toContain('insert into notifications')
    expect(migration).toContain('insert into notification_queue')
  })

  it('enables RLS for the new homework tables', () => {
    expect(migration).toContain('alter table homework_assignments enable row level security')
    expect(migration).toContain('alter table homework_student_assignments enable row level security')
    expect(migration).toContain('alter table homework_items enable row level security')
    expect(migration).toContain('alter table homework_submission_files enable row level security')
    expect(migration).toContain('alter table homework_feedback_messages enable row level security')
  })
})

describe('homework assignments phase A UI', () => {
  it('creates homework templates without a required concrete due date', () => {
    expect(createModal).not.toContain("register('due_date')")
    expect(createModal).toContain('due_date:')
    expect(createModal).not.toContain('notifyNewHomework')
  })

  it('assign modal calls the server-side RPC and shows unique student count', () => {
    expect(assignModal).toContain("supabase.rpc('assign_homework'")
    expect(assignModal).toContain('uniqueStudentCount')
    expect(assignModal).toContain('p_group_ids')
    expect(assignModal).toContain('p_student_ids')
    expect(assignModal).toContain('p_due_at')
  })
})
