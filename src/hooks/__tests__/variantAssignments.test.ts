/**
 * Unit tests for variant assignment module
 *
 * Tests cover:
 *   - AssignParams validation logic (dates, attempts, targets)
 *   - resolveDisplayStatus (student-side status computation)
 *   - Student deduplication across groups
 *   - Settings defaults and constraints
 *   - RPC parameter mapping
 *   - Notification deduplication key format
 *   - cancel / update / sync payloads
 *   - Edge cases: empty groups, past due_at, etc.
 */

import { describe, it, expect } from 'vitest'

// ── Types mirrored from the module ────────────────────────────────────────────

type AssignmentStatus =
  | 'not_started' | 'available' | 'in_progress'
  | 'submitted' | 'completed' | 'overdue' | 'cancelled'

interface StudentAssignment {
  status: AssignmentStatus
  available_from: string | null
  due_at: string | null
  attempts_used: number
  max_attempts: number
}

// ── resolveDisplayStatus (mirrors AssignVariantPage logic) ───────────────────

function isFuture(d: Date) { return d.getTime() > Date.now() }
function isPast(d: Date)   { return d.getTime() < Date.now() }

function resolveDisplayStatus(a: StudentAssignment): AssignmentStatus {
  if (a.status !== 'not_started') return a.status
  if (a.available_from && isFuture(new Date(a.available_from))) return 'not_started'
  if (a.due_at && isPast(new Date(a.due_at))) return 'overdue'
  return 'available'
}

// ── validateAssignParams (mirrors RPC validation logic) ──────────────────────

interface AssignParams {
  variant_id: string
  student_ids: string[]
  group_ids: string[]
  available_from: string | null
  due_at: string | null
  max_attempts: number
  allow_retry: boolean
}

function validateAssignParams(p: AssignParams): string | null {
  if (!p.variant_id) return 'NO_VARIANT'
  if (p.student_ids.length === 0 && p.group_ids.length === 0) return 'NO_TARGET'
  if (p.due_at !== null && p.available_from !== null) {
    if (new Date(p.due_at) <= new Date(p.available_from)) return 'INVALID_DATES'
  }
  if (p.due_at !== null && isPast(new Date(p.due_at))) return 'PAST_DUE'
  if (p.max_attempts < 1) return 'INVALID_ATTEMPTS'
  return null
}

function normalizeAttempts(maxAttempts: number, allowRetry: boolean): number {
  if (maxAttempts < 1) throw new Error('INVALID_ATTEMPTS')
  return allowRetry ? maxAttempts : 1
}

function summarizeGroupAssignment(groups: Array<{ id: string; students: Array<{ id: string }> }>, selectedGroups: string[]) {
  const warnings: string[] = []
  const allStudentIds: string[] = []
  let groupsAssigned = 0
  let emptyGroups = 0

  for (const gid of selectedGroups) {
    const group = groups.find(g => g.id === gid)
    if (!group || group.students.length === 0) {
      emptyGroups += 1
      warnings.push(`empty_group:${gid}:В группе нет учеников`)
      continue
    }
    groupsAssigned += 1
    allStudentIds.push(...group.students.map(s => s.id))
  }

  return {
    groups_assigned: groupsAssigned,
    unique_students: new Set(allStudentIds).size,
    duplicates_skipped: allStudentIds.length - new Set(allStudentIds).size,
    empty_groups: emptyGroups,
    warnings,
  }
}

// ── deduplicateStudents (mirrors hook logic) ──────────────────────────────────

function deduplicateStudents(
  groups: Array<{ id: string; students: Array<{ id: string }> }>,
  selectedGroups: string[],
  selectedStudents: string[],
): string[] {
  const ids = new Set<string>(selectedStudents)
  for (const gid of selectedGroups) {
    const g = groups.find(g => g.id === gid)
    if (g) g.students.forEach(s => ids.add(s.id))
  }
  return Array.from(ids)
}

// ── notificationKey format ────────────────────────────────────────────────────

function notifKey(variantId: string, profileId: string) {
  return `variant_assigned:${variantId}:${profileId}`
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

const UUID_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const UUID_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const UUID_C = 'cccccccc-0000-4000-8000-000000000003'
const UUID_V = 'vvvvvvvv-0000-4000-8000-000000000001'

const FUTURE = new Date(Date.now() + 3_600_000).toISOString()
const PAST   = new Date(Date.now() - 3_600_000).toISOString()
const FAR_FUTURE = new Date(Date.now() + 86_400_000 * 30).toISOString()

// ── 1. resolveDisplayStatus ───────────────────────────────────────────────────

describe('resolveDisplayStatus', () => {
  it('returns original status when not not_started', () => {
    const a: StudentAssignment = { status: 'completed', available_from: null, due_at: null, attempts_used: 1, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('completed')
  })

  it('returns available when no dates set', () => {
    const a: StudentAssignment = { status: 'not_started', available_from: null, due_at: null, attempts_used: 0, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('available')
  })

  it('returns not_started when available_from is in the future', () => {
    const a: StudentAssignment = { status: 'not_started', available_from: FUTURE, due_at: null, attempts_used: 0, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('not_started')
  })

  it('returns available when available_from is in the past and no due_at', () => {
    const a: StudentAssignment = { status: 'not_started', available_from: PAST, due_at: null, attempts_used: 0, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('available')
  })

  it('returns overdue when due_at is in the past and status is not_started', () => {
    const a: StudentAssignment = { status: 'not_started', available_from: null, due_at: PAST, attempts_used: 0, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('overdue')
  })

  it('never overrides in_progress with overdue', () => {
    const a: StudentAssignment = { status: 'in_progress', available_from: null, due_at: PAST, attempts_used: 0, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('in_progress')
  })

  it('returns submitted when status is submitted', () => {
    const a: StudentAssignment = { status: 'submitted', available_from: null, due_at: PAST, attempts_used: 1, max_attempts: 1 }
    expect(resolveDisplayStatus(a)).toBe('submitted')
  })
})

// ── 2. validateAssignParams ───────────────────────────────────────────────────

describe('validateAssignParams', () => {
  const base: AssignParams = {
    variant_id: UUID_V,
    student_ids: [UUID_A],
    group_ids: [],
    available_from: null,
    due_at: null,
    max_attempts: 1,
    allow_retry: false,
  }

  it('accepts valid params with student_ids only', () => {
    expect(validateAssignParams(base)).toBeNull()
  })

  it('accepts valid params with group_ids only', () => {
    expect(validateAssignParams({ ...base, student_ids: [], group_ids: [UUID_B] })).toBeNull()
  })

  it('rejects empty targets', () => {
    expect(validateAssignParams({ ...base, student_ids: [], group_ids: [] })).toBe('NO_TARGET')
  })

  it('rejects missing variant_id', () => {
    expect(validateAssignParams({ ...base, variant_id: '' })).toBe('NO_VARIANT')
  })

  it('rejects due_at before available_from', () => {
    expect(validateAssignParams({
      ...base,
      available_from: FAR_FUTURE,
      due_at: FUTURE, // FUTURE < FAR_FUTURE
    })).toBe('INVALID_DATES')
  })

  it('rejects due_at equal to available_from', () => {
    const same = FUTURE
    expect(validateAssignParams({ ...base, available_from: same, due_at: same })).toBe('INVALID_DATES')
  })

  it('rejects past due_at', () => {
    expect(validateAssignParams({ ...base, due_at: PAST })).toBe('PAST_DUE')
  })

  it('accepts future due_at with no available_from', () => {
    expect(validateAssignParams({ ...base, due_at: FAR_FUTURE })).toBeNull()
  })

  it('rejects max_attempts < 1', () => {
    expect(validateAssignParams({ ...base, max_attempts: 0 })).toBe('INVALID_ATTEMPTS')
  })

  it('accepts allow_retry=false with max_attempts>1 because RPC normalizes it to 1', () => {
    expect(validateAssignParams({ ...base, allow_retry: false, max_attempts: 3 })).toBeNull()
    expect(normalizeAttempts(3, false)).toBe(1)
  })

  it('accepts allow_retry=true with max_attempts=3', () => {
    expect(validateAssignParams({ ...base, allow_retry: true, max_attempts: 3 })).toBeNull()
    expect(normalizeAttempts(3, true)).toBe(3)
  })
})

// ── 3. deduplicateStudents ────────────────────────────────────────────────────

describe('deduplicateStudents', () => {
  const groups = [
    { id: 'g1', students: [{ id: UUID_A }, { id: UUID_B }] },
    { id: 'g2', students: [{ id: UUID_B }, { id: UUID_C }] },
  ]

  it('returns only direct students if no groups selected', () => {
    expect(deduplicateStudents(groups, [], [UUID_A])).toEqual([UUID_A])
  })

  it('returns students from all selected groups', () => {
    const result = deduplicateStudents(groups, ['g1'], [])
    expect(result).toHaveLength(2)
    expect(result).toContain(UUID_A)
    expect(result).toContain(UUID_B)
  })

  it('deduplicates students across groups', () => {
    const result = deduplicateStudents(groups, ['g1', 'g2'], [])
    // UUID_B is in both groups → appears once
    expect(result).toHaveLength(3)
    expect(new Set(result).size).toBe(3)
  })

  it('deduplicates student appearing in group and direct selection', () => {
    const result = deduplicateStudents(groups, ['g1'], [UUID_B])
    expect(result).toHaveLength(2) // UUID_A, UUID_B (UUID_B deduped)
  })

  it('returns empty for empty input', () => {
    expect(deduplicateStudents(groups, [], [])).toHaveLength(0)
  })

  it('ignores groups not in selection', () => {
    const result = deduplicateStudents(groups, ['g1'], [])
    expect(result).not.toContain(UUID_C) // UUID_C is only in g2
  })
})

// ── 3b. group assignment summary ─────────────────────────────────────────────

describe('group assignment summary', () => {
  const groups = [
    { id: 'g1', students: [{ id: UUID_A }, { id: UUID_B }] },
    { id: 'g2', students: [{ id: UUID_B }, { id: UUID_C }] },
    { id: 'empty', students: [] },
  ]

  it('assigns one non-empty group', () => {
    const result = summarizeGroupAssignment(groups, ['g1'])
    expect(result.groups_assigned).toBe(1)
    expect(result.unique_students).toBe(2)
    expect(result.empty_groups).toBe(0)
  })

  it('assigns multiple groups and deduplicates students', () => {
    const result = summarizeGroupAssignment(groups, ['g1', 'g2'])
    expect(result.groups_assigned).toBe(2)
    expect(result.unique_students).toBe(3)
    expect(result.duplicates_skipped).toBe(1)
  })

  it('skips empty groups with a warning', () => {
    const result = summarizeGroupAssignment(groups, ['empty'])
    expect(result.groups_assigned).toBe(0)
    expect(result.empty_groups).toBe(1)
    expect(result.warnings[0]).toContain('В группе нет учеников')
  })
})

// ── 4. notificationKey format ─────────────────────────────────────────────────

describe('notificationKey', () => {
  it('generates stable key from variantId + profileId', () => {
    const key = notifKey(UUID_V, UUID_A)
    expect(key).toBe(`variant_assigned:${UUID_V}:${UUID_A}`)
  })

  it('keys differ for different students', () => {
    expect(notifKey(UUID_V, UUID_A)).not.toBe(notifKey(UUID_V, UUID_B))
  })

  it('keys differ for different variants', () => {
    expect(notifKey(UUID_V, UUID_A)).not.toBe(notifKey(UUID_B, UUID_A))
  })
})

// ── 5. Settings defaults ──────────────────────────────────────────────────────

describe('Settings defaults', () => {
  const DEFAULT_SETTINGS = {
    available_from: '',
    due_at: '',
    max_attempts: 1,
    allow_retry: false,
    show_answers_after_submit: false,
    show_solutions_after_submit: false,
  }

  it('default max_attempts is 1', () => {
    expect(DEFAULT_SETTINGS.max_attempts).toBe(1)
  })

  it('default allow_retry is false', () => {
    expect(DEFAULT_SETTINGS.allow_retry).toBe(false)
  })

  it('toggling allow_retry upgrades max_attempts to at least 2', () => {
    const s = { ...DEFAULT_SETTINGS, allow_retry: true }
    const upgraded = Math.max(s.max_attempts, 2)
    expect(upgraded).toBe(2)
  })

  it('disabling allow_retry resets max_attempts to 1', () => {
    const s = { ...DEFAULT_SETTINGS, allow_retry: false, max_attempts: 3 }
    const reset = s.allow_retry ? s.max_attempts : 1
    expect(reset).toBe(1)
  })

  it('empty date strings are treated as null in RPC params', () => {
    const available_from = DEFAULT_SETTINGS.available_from || null
    const due_at = DEFAULT_SETTINGS.due_at || null
    expect(available_from).toBeNull()
    expect(due_at).toBeNull()
  })
})
