/**
 * Etap 6: unified student journal. Source-inspection + logic tests
 * matching project convention (see lessonMaterialsSecurity.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getDisplayHomeworkStatus, isSubmittedOnTime, type JournalAssignment } from '@/types/journal'

const ROOT = process.cwd()
function read(rel: string) { return readFileSync(join(ROOT, rel), 'utf8') }

function makeAssignment(overrides: Partial<JournalAssignment> = {}): JournalAssignment {
  return {
    source: 'collection',
    assigned_id: 'a1', collection_id: 'c1', collection_title: 'Test',
    lesson_id: null, topic_id: null, due_date: null, created_at: '2026-01-01T00:00:00Z',
    assignment_status: 'active', submission_id: null, submission_status: null,
    submitted_at: null, reviewed_at: null, score: null, max_score: null, teacher_comment: null,
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. getDisplayHomeworkStatus — computed, never persisted
// ══════════════════════════════════════════════════════════════════════════════

describe('getDisplayHomeworkStatus', () => {
  it('no due date, no submission → not_started (never overdue without a due date)', () => {
    expect(getDisplayHomeworkStatus(makeAssignment())).toBe('not_started')
  })

  it('due date in the past, no submission → overdue', () => {
    expect(getDisplayHomeworkStatus(makeAssignment({ due_date: '2020-01-01T00:00:00Z' }))).toBe('overdue')
  })

  it('due date in the future, no submission → not_started', () => {
    expect(getDisplayHomeworkStatus(makeAssignment({ due_date: '2099-01-01T00:00:00Z' }))).toBe('not_started')
  })

  it('submission exists → mirrors submission_status regardless of due date', () => {
    expect(getDisplayHomeworkStatus(makeAssignment({ due_date: '2020-01-01T00:00:00Z', submission_status: 'submitted' }))).toBe('submitted')
    expect(getDisplayHomeworkStatus(makeAssignment({ submission_status: 'accepted' }))).toBe('accepted')
    expect(getDisplayHomeworkStatus(makeAssignment({ submission_status: 'returned' }))).toBe('returned')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. isSubmittedOnTime — never guesses when data is missing
// ══════════════════════════════════════════════════════════════════════════════

describe('isSubmittedOnTime', () => {
  it('no due date → null (insufficient data, never guess)', () => {
    expect(isSubmittedOnTime(makeAssignment({ submitted_at: '2026-01-01T00:00:00Z' }))).toBeNull()
  })

  it('no submission → null', () => {
    expect(isSubmittedOnTime(makeAssignment({ due_date: '2026-01-01T00:00:00Z' }))).toBeNull()
  })

  it('submitted before due date → true', () => {
    expect(isSubmittedOnTime(makeAssignment({ due_date: '2026-01-10T00:00:00Z', submitted_at: '2026-01-05T00:00:00Z' }))).toBe(true)
  })

  it('submitted after due date → false', () => {
    expect(isSubmittedOnTime(makeAssignment({ due_date: '2026-01-01T00:00:00Z', submitted_at: '2026-01-05T00:00:00Z' }))).toBe(false)
  })

  it('submitted exactly at due date → true (<=, not <)', () => {
    const t = '2026-01-01T00:00:00Z'
    expect(isSubmittedOnTime(makeAssignment({ due_date: t, submitted_at: t }))).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. useStudentJournal — reads via RPC only, never a raw table select
// ══════════════════════════════════════════════════════════════════════════════

describe('useStudentJournal hook', () => {
  const src = read('src/hooks/useStudentJournal.ts')

  it('reads via get_student_journal RPC', () => {
    expect(src).toContain("db.rpc('get_student_journal'")
  })

  it('never does a raw table select (all access goes through the security-definer RPC)', () => {
    expect(src).not.toContain(".from('")
  })

  it('periodToRange never invents a range for "all" (both bounds null, RPC applies no filter)', () => {
    expect(src).toContain("if (period === 'custom')")
    expect(src).toContain('return { from: null, to: null }')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. JournalView — shared component, role-gated hrefs, no teacher_notes rendering
// ══════════════════════════════════════════════════════════════════════════════

describe('JournalView shared component', () => {
  const src = read('src/components/journal/JournalView.tsx')

  it('never references teacher_notes (not part of the journal payload at all)', () => {
    expect(src).not.toContain('teacher_notes')
  })

  // Блок заданий больше не живёт в JournalView: он вынесен в TopicJournalSection
  // (новый контур). Параметризуется только ссылка на занятие.
  it('is parameterized by lessonHref so teacher and student pages reuse one component', () => {
    expect(src).toContain('lessonHref: (lessonId: string) => string')
    expect(src).not.toContain('assignmentHref')
  })

  it('блок заданий берётся из нового контура (topic_homework + topic_tests)', () => {
    expect(src).toContain('<TopicJournalSection')
    expect(src).not.toContain('HomeworkV2JournalSection')
  })

  it('shows the explicit empty-state message for trend data rather than a fake zero-line', () => {
    expect(src).toContain('Пока недостаточно данных для отображения динамики')
  })

  it('never renders a fabricated percentage for avg_score (raw number only)', () => {
    expect(src).not.toContain('avg_score}%')
  })

  it('renders "недостаточно данных" when attendance_pct is null instead of showing 0%', () => {
    expect(src).toContain('недостаточно данных')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Cross-navigation reuses existing Etap4/5 routes — no duplicate submission pages
// ══════════════════════════════════════════════════════════════════════════════

describe('journal cross-navigation reuses existing routes', () => {
  // Ссылки на легаси-сдачи из журнала убраны вместе с блоком заданий Homework V2:
  // ДЗ и тесты теперь показывает TopicJournalSection, переход — на страницу темы.
  it('журнал больше не ведёт на легаси-страницы сдач', () => {
    expect(read('src/pages/StudentJournalPage.tsx')).not.toContain('/review-submissions/')
    expect(read('src/pages/student/MyProgressPage.tsx')).not.toContain('/my-assignments/${a.assigned_id}')
  })

  it('both pages link lessons to the existing /lessons/:id route', () => {
    expect(read('src/pages/StudentJournalPage.tsx')).toContain('/lessons/${lessonId}')
    expect(read('src/pages/student/MyProgressPage.tsx')).toContain('/lessons/${lessonId}')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. Route security — teacher journal route excludes curator/parent, student self-only
// ══════════════════════════════════════════════════════════════════════════════

describe('journal route access in App.tsx', () => {
  const src = read('src/AppRoutes.tsx')

  it('/students/:studentId/journal is restricted to teacher/admin/owner (curator excluded)', () => {
    const block = src.slice(src.indexOf('/students/:studentId/journal'), src.indexOf('/students/:studentId/journal') + 150)
    expect(block).toContain("allow={['teacher','admin','owner']}")
    expect(block).not.toContain('curator')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. get_student_journal RPC — formula verification via source inspection
//    (SQL migration checked into supabase/migrations/016_student_journal.sql)
// ══════════════════════════════════════════════════════════════════════════════

describe('get_student_journal RPC formulas (016_student_journal.sql)', () => {
  const sql = read('supabase/migrations/_legacy/016_student_journal.sql')

  it('validates p_student_id and period ordering before any role check', () => {
    expect(sql).toContain("RAISE EXCEPTION 'p_student_id is required'")
    expect(sql).toContain("RAISE EXCEPTION 'Invalid period: date_from is after date_to'")
  })

  it('subject cascade: lesson subject derived from group->course, never guessed from lesson title text', () => {
    expect(sql).toContain("CASE c.subject::text WHEN 'physics' THEN 'Физика' WHEN 'math' THEN 'Математика'")
    expect(sql).not.toContain('title ILIKE')
    expect(sql).not.toContain("title LIKE")
  })

  it('subject filter cascades to scoped_lessons (drives lessons_json, att_calc AND trend_json — one filter, one scope)', () => {
    const scopedLessonsBlock = sql.slice(sql.indexOf('scoped_lessons AS'), sql.indexOf('lesson_att AS'))
    expect(scopedLessonsBlock).toContain('p_subject IS NULL OR subject_label = p_subject')
    // att_calc and trend both read FROM scoped_lessons, not raw_lessons or the unfiltered lessons table
    expect(sql).toContain('FROM scoped_lessons sl LEFT JOIN lesson_att la')
    expect(sql.match(/FROM scoped_lessons sl WHERE sl\.status = 'completed'/g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('subject filter cascades to scoped_assignments (drives assignments_json, hw_calc AND trend submitted/accepted)', () => {
    const scopedAssignmentsBlock = sql.slice(sql.indexOf('scoped_assignments AS'), sql.indexOf('own_submissions AS'))
    expect(scopedAssignmentsBlock).toContain('p_subject IS NULL OR tc.subject = p_subject')
    // trend's submitted/accepted counts join through scoped_assignments, not raw own_submissions —
    // this is the fix for the bug where the chart ignored the subject filter
    expect(sql).toContain('FROM scoped_assignments sa JOIN own_submissions os ON os.assigned_id = sa.id WHERE date_trunc')
  })

  it('attendance denominator = present + late + absent; excused is tracked but excluded from both attended and missed', () => {
    const block = sql.slice(sql.indexOf('att_calc AS'), sql.indexOf('hw_calc AS'))
    expect(block).toContain("la.status = 'present'")
    expect(block).toContain("la.status = 'late'")
    expect(block).toContain("la.status = 'absent'")
    expect(block).toContain("la.status = 'excused'")
    expect(sql).toContain("'attended', ac.present_n + ac.late_n, 'missed', ac.absent_n")
    expect(sql).toContain('ac.present_n + ac.late_n + ac.absent_n')
  })

  it('attendance counts only completed lessons, never scheduled/cancelled (future/cancelled excluded)', () => {
    const block = sql.slice(sql.indexOf('att_calc AS'), sql.indexOf('hw_calc AS'))
    // every FILTER clause requires status = completed
    const filters = block.match(/FILTER \(WHERE ([^)]+)\)/g) || []
    expect(filters.length).toBeGreaterThan(0)
    filters.forEach(f => expect(f).toContain("sl.status = 'completed'"))
  })

  it('a completed lesson with no attendance row is excluded from the denominator (never fabricated as missed)', () => {
    // la.status is NULL for a completed lesson with no attendance row; it matches
    // none of the present/late/absent/excused filters, so it contributes to no bucket
    const block = sql.slice(sql.indexOf('att_calc AS'), sql.indexOf('hw_calc AS'))
    expect(block).toContain('LEFT JOIN lesson_att la')
  })

  it('overdue = due date passed AND no submission at all (never re-flagged once any submission exists)', () => {
    const block = sql.slice(sql.indexOf('hw_calc AS'), sql.indexOf('weeks AS'))
    expect(block).toContain("sa.due_date < now() AND os.id IS NULL) AS overdue_n")
    expect(block).not.toContain('os.submitted_at > sa.due_date) AS overdue_n')
  })

  it('on-time is judged only against the current submitted_at (no resubmission history claimed)', () => {
    const block = sql.slice(sql.indexOf('hw_calc AS'), sql.indexOf('weeks AS'))
    expect(block).toContain('os.submitted_at IS NOT NULL AND os.submitted_at <= sa.due_date) AS on_time_n')
  })

  it('avg_score only counts accepted/rejected submissions with a non-null score (never submitted/returned/not_started)', () => {
    const block = sql.slice(sql.indexOf('hw_calc AS'), sql.indexOf('weeks AS'))
    expect(block).toContain("avg(os.score) FILTER (WHERE os.score IS NOT NULL AND os.status IN ('accepted', 'rejected')) AS avg_score")
    expect(block).not.toContain("os.status IN ('submitted'")
    expect(block).not.toContain("os.status IN ('returned'")
  })

  it('avg_score is a raw rounded number, never converted to a percentage', () => {
    expect(sql).toContain("'avg_score', CASE WHEN hc.scored_n > 0 THEN round(hc.avg_score, 2) ELSE NULL END")
    expect(sql).not.toContain('avg_score * 100')
  })

  it('teacher_notes is never selected anywhere in the RPC', () => {
    expect(sql).not.toContain('teacher_notes')
  })

  it('anon is explicitly revoked on both functions (direct-grant bug from Etap 4/5 does not recur)', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION get_student_journal(uuid, timestamptz, timestamptz, text) FROM anon')
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION auth_teacher_has_student(uuid) FROM anon')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 8. JournalView UI — attendance breakdown, subject filter, avg_score wording
// ══════════════════════════════════════════════════════════════════════════════

describe('JournalView UI — attendance breakdown and subject filter', () => {
  const src = read('src/components/journal/JournalView.tsx')

  it('shows present/late/absent/excused counts separately for the teacher', () => {
    expect(src).toContain('summary.present_count')
    expect(src).toContain('summary.late_count')
    expect(src).toContain('summary.absent_count')
    expect(src).toContain('summary.excused_count')
  })

  it('has a subject filter selector limited to the closed two-subject domain', () => {
    expect(src).toContain('SUBJECT_OPTIONS')
    expect(src).toContain("value: 'Физика'")
    expect(src).toContain("value: 'Математика'")
  })

  // avg_score легаси-заданий из JournalView убран: средний балл считается по
  // принятым ДЗ нового контура и живёт в TopicJournalSection, отдельно по шкалам.
  it('никакого avg_score легаси-заданий в занятиях не осталось', () => {
    expect(src).not.toContain('avg_score')
  })

  it('passes the subject filter into useStudentJournal so the RPC (not client-side filtering) scopes the data', () => {
    expect(src).toContain('useStudentJournal(studentId, period, undefined, undefined, subject || null)')
  })
})
