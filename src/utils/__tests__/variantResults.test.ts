import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  deriveDisplayStatus,
  buildResultSummary,
  DISPLAY_STATUS_LABEL,
  DISPLAY_STATUS_CLASS,
  type VariantResultRow,
} from '../variantResultsUtils'

const PAGE_SRC = readFileSync(
  path.resolve(__dirname, '../../pages/variants/VariantAssignmentsPage.tsx'),
  'utf-8'
)
const HOOK_SRC = readFileSync(
  path.resolve(__dirname, '../../hooks/useVariantResults.ts'),
  'utf-8'
)
const UTILS_SRC = readFileSync(
  path.resolve(__dirname, '../variantResultsUtils.ts'),
  'utf-8'
)

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<VariantResultRow> = {}): VariantResultRow {
  return {
    tvsa_id: 'r1',
    student_id: 's1',
    student_name: 'Иван Иванов',
    group_id: 'g1',
    group_name: 'Группа А',
    assignment_id: 'a1',
    status: 'not_started',
    due_at: null,
    available_from: null,
    started_at: null,
    submitted_at: null,
    completed_at: null,
    attempts_used: 0,
    variant_tasks_count: 10,
    answered_count:      null,
    correct_count:       null,
    score:               null,
    max_score:           null,
    percentage:          null,
    grading_status:      null,
    auto_score:          null,
    manual_review_count: null,
    ...overrides,
  }
}

const NOW = new Date('2026-06-28T12:00:00Z')
const PAST = '2026-06-01T00:00:00Z'
const FUTURE = '2026-07-31T00:00:00Z'

// ─── 1. deriveDisplayStatus ───────────────────────────────────────────────────

describe('deriveDisplayStatus', () => {
  it('not_started with no deadline → not_started', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'not_started' }), NOW)).toBe('not_started')
  })

  it('available with future deadline → not_started', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'available', due_at: FUTURE }), NOW)).toBe('not_started')
  })

  it('in_progress with future deadline → in_progress', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'in_progress', due_at: FUTURE }), NOW)).toBe('in_progress')
  })

  it('submitted → completed (submitted is mapped to completed bucket)', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'submitted' }), NOW)).toBe('completed')
  })

  it('completed → completed', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'completed' }), NOW)).toBe('completed')
  })

  it('cancelled → cancelled', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'cancelled' }), NOW)).toBe('cancelled')
  })

  it('not_started with past deadline → overdue', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'not_started', due_at: PAST }), NOW)).toBe('overdue')
  })

  it('in_progress with past deadline → overdue', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'in_progress', due_at: PAST }), NOW)).toBe('overdue')
  })

  it('completed with past deadline stays completed (not overdue)', () => {
    expect(deriveDisplayStatus(makeRow({ status: 'completed', due_at: PAST }), NOW)).toBe('completed')
  })
})

// ─── 2. buildResultSummary ────────────────────────────────────────────────────

describe('buildResultSummary', () => {
  it('empty rows → all zeros', () => {
    const s = buildResultSummary([], NOW)
    expect(s.total).toBe(0)
    expect(s.not_started).toBe(0)
    expect(s.in_progress).toBe(0)
    expect(s.completed).toBe(0)
    expect(s.overdue).toBe(0)
    expect(s.cancelled).toBe(0)
  })

  it('correctly counts mixed statuses', () => {
    const rows = [
      makeRow({ status: 'not_started' }),
      makeRow({ status: 'in_progress', due_at: FUTURE }),
      makeRow({ status: 'completed' }),
      makeRow({ status: 'submitted' }),
      makeRow({ status: 'not_started', due_at: PAST }),
      makeRow({ status: 'cancelled' }),
    ]
    const s = buildResultSummary(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.not_started).toBe(1)
    expect(s.in_progress).toBe(1)
    expect(s.completed).toBe(2) // completed + submitted
    expect(s.overdue).toBe(1)
    expect(s.cancelled).toBe(1)
  })

  it('total equals sum of all buckets', () => {
    const rows = [makeRow(), makeRow({ status: 'in_progress' }), makeRow({ status: 'cancelled' })]
    const s = buildResultSummary(rows, NOW)
    const parts = s.not_started + s.in_progress + s.completed + s.overdue + s.cancelled
    expect(parts).toBe(s.total)
  })
})

// ─── 3. Status labels and classes ────────────────────────────────────────────

describe('Status labels and classes', () => {
  it('all 5 DisplayStatus keys have labels', () => {
    const keys: (keyof typeof DISPLAY_STATUS_LABEL)[] = ['not_started', 'in_progress', 'completed', 'overdue', 'cancelled']
    for (const k of keys) {
      expect(DISPLAY_STATUS_LABEL[k]).toBeTruthy()
    }
  })

  it('all 5 DisplayStatus keys have CSS classes', () => {
    const keys: (keyof typeof DISPLAY_STATUS_CLASS)[] = ['not_started', 'in_progress', 'completed', 'overdue', 'cancelled']
    for (const k of keys) {
      expect(DISPLAY_STATUS_CLASS[k]).toContain('bg-')
    }
  })

  it('overdue has red style', () => {
    expect(DISPLAY_STATUS_CLASS['overdue']).toContain('red')
  })

  it('completed has green style', () => {
    expect(DISPLAY_STATUS_CLASS['completed']).toContain('green')
  })
})

// ─── 4. Source checks — VariantAssignmentsPage ────────────────────────────────

describe('VariantAssignmentsPage tabs', () => {
  it('tab bar data-testid present', () => {
    expect(PAGE_SRC).toContain('data-testid="variant-tabs"')
  })

  it('assignments tab testId prop present', () => {
    expect(PAGE_SRC).toContain('testId="tab-assignments"')
  })

  it('results tab testId prop present', () => {
    expect(PAGE_SRC).toContain('testId="tab-results"')
  })

  it('assignments panel data-testid present', () => {
    expect(PAGE_SRC).toContain('data-testid="assignments-panel"')
  })

  it('results panel data-testid present', () => {
    expect(PAGE_SRC).toContain('data-testid="results-panel"')
  })

  it('summary stat cards container has data-testid', () => {
    expect(PAGE_SRC).toContain('data-testid="results-summary"')
  })

  it('results table has data-testid', () => {
    expect(PAGE_SRC).toContain('data-testid="results-table"')
  })

  it('results search input has data-testid', () => {
    expect(PAGE_SRC).toContain('data-testid="results-search"')
  })

  it('status filter has data-testid', () => {
    expect(PAGE_SRC).toContain('data-testid="results-status-filter"')
  })

  it('group filter has data-testid', () => {
    expect(PAGE_SRC).toContain('data-testid="results-group-filter"')
  })

  it('uses useVariantResults hook', () => {
    expect(PAGE_SRC).toContain('useVariantResults')
  })

  it('score columns read answered_count from row', () => {
    expect(PAGE_SRC).toContain('answered_count')
  })

  it('score columns read percentage from row', () => {
    expect(PAGE_SRC).toContain('percentage')
  })
})

// ─── 5. Source checks — hook ──────────────────────────────────────────────────

describe('useVariantResults hook', () => {
  it('calls get_variant_results RPC', () => {
    expect(HOOK_SRC).toContain("'get_variant_results'")
  })

  it('passes p_variant_id parameter', () => {
    expect(HOOK_SRC).toContain('p_variant_id')
  })

  it('has refresh function', () => {
    expect(HOOK_SRC).toContain('refresh')
  })

  it('guards on variantId being defined', () => {
    expect(HOOK_SRC).toContain('if (!variantId) return')
  })
})

// ─── 6. Source checks — utils ─────────────────────────────────────────────────

describe('variantResultsUtils exports', () => {
  it('exports deriveDisplayStatus', () => {
    expect(UTILS_SRC).toContain('export function deriveDisplayStatus')
  })

  it('exports buildResultSummary', () => {
    expect(UTILS_SRC).toContain('export function buildResultSummary')
  })

  it('exports DISPLAY_STATUS_LABEL', () => {
    expect(UTILS_SRC).toContain('export const DISPLAY_STATUS_LABEL')
  })

  it('exports DISPLAY_STATUS_CLASS', () => {
    expect(UTILS_SRC).toContain('export const DISPLAY_STATUS_CLASS')
  })

  it('VariantResultRow has score fields', () => {
    expect(UTILS_SRC).toContain('answered_count')
    expect(UTILS_SRC).toContain('percentage')
  })
})
