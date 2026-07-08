import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// ── Source files ───────────────────────────────────────────────────────────────

const ATTEMPT_SRC = readFileSync(
  path.resolve(__dirname, '../../hooks/useVariantAttempt.ts'), 'utf-8'
)
const MANUAL_INPUT_SRC = readFileSync(
  path.resolve(__dirname, '../../components/variant/ManualAnswerInput.tsx'), 'utf-8'
)
const STUDENT_PAGE_SRC = readFileSync(
  path.resolve(__dirname, '../../pages/student/StudentVariantDetailPage.tsx'), 'utf-8'
)
const WORK_HOOK_SRC = readFileSync(
  path.resolve(__dirname, '../../hooks/useVariantStudentWork.ts'), 'utf-8'
)
const WORK_PAGE_SRC = readFileSync(
  path.resolve(__dirname, '../../pages/variants/VariantStudentWorkPage.tsx'), 'utf-8'
)
const UTILS_SRC = readFileSync(
  path.resolve(__dirname, '../variantResultsUtils.ts'), 'utf-8'
)
const APP_SRC = readFileSync(
  path.resolve(__dirname, '../../AppRoutes.tsx'), 'utf-8'
)

// ─── 1. VariantItem includes grading_type ────────────────────────────────────

describe('VariantItem interface', () => {
  it('has grading_type field', () => {
    expect(ATTEMPT_SRC).toContain('grading_type:')
  })

  it('grading_type is auto or manual union', () => {
    expect(ATTEMPT_SRC).toContain("'auto' | 'manual'")
  })
})

// ─── 2. VariantAttemptState includes grading info ────────────────────────────

describe('VariantAttemptState', () => {
  it('has grading_status field', () => {
    expect(ATTEMPT_SRC).toContain('grading_status:')
  })

  it('has manual_review_count field', () => {
    expect(ATTEMPT_SRC).toContain('manual_review_count:')
  })
})

// ─── 3. useVariantAttempt attachment support ─────────────────────────────────

describe('useVariantAttempt hook', () => {
  it('exports addAttachment', () => {
    expect(ATTEMPT_SRC).toContain('addAttachment')
  })

  it('exports removeAttachment', () => {
    expect(ATTEMPT_SRC).toContain('removeAttachment')
  })

  it('loads attachments from test_variant_answer_attachments', () => {
    expect(ATTEMPT_SRC).toContain('test_variant_answer_attachments')
  })

  it('tracks grading_status from submit result', () => {
    expect(ATTEMPT_SRC).toContain('grading_status:')
    expect(ATTEMPT_SRC).toContain('manual_review_count:')
  })

  it('uses db (any cast) for new tables/rpcs', () => {
    expect(ATTEMPT_SRC).toContain('supabase as any')
  })
})

// ─── 4. ManualAnswerInput component ──────────────────────────────────────────

describe('ManualAnswerInput', () => {
  it('exports ManualAnswerInput', () => {
    expect(MANUAL_INPUT_SRC).toContain('export function ManualAnswerInput')
  })

  it('exports AttachmentRecord interface', () => {
    expect(MANUAL_INPUT_SRC).toContain('export interface AttachmentRecord')
  })

  it('has textarea for text solution', () => {
    expect(MANUAL_INPUT_SRC).toContain('<textarea')
  })

  it('has file input for uploads', () => {
    expect(MANUAL_INPUT_SRC).toContain('type="file"')
  })

  it('calls save_answer_attachment RPC', () => {
    expect(MANUAL_INPUT_SRC).toContain('save_answer_attachment')
  })

  it('calls delete_answer_attachment RPC', () => {
    expect(MANUAL_INPUT_SRC).toContain('delete_answer_attachment')
  })

  it('uploads to variant-solutions bucket', () => {
    expect(MANUAL_INPUT_SRC).toContain('variant-solutions')
  })

  it('uses data-testid for manual text area', () => {
    expect(MANUAL_INPUT_SRC).toContain('data-testid={`manual-text-${itemId}`}')
  })

  it('has file size limit check', () => {
    expect(MANUAL_INPUT_SRC).toContain('MAX_MB')
  })

  it('rolls back storage on RPC failure', () => {
    expect(MANUAL_INPUT_SRC).toContain('remove([path])')
  })
})

// ─── 5. StudentVariantDetailPage ─────────────────────────────────────────────

describe('StudentVariantDetailPage', () => {
  it('imports ManualAnswerInput', () => {
    expect(STUDENT_PAGE_SRC).toContain('ManualAnswerInput')
  })

  it('uses ManualAnswerInput for manual tasks', () => {
    expect(STUDENT_PAGE_SRC).toContain("item.grading_type === 'manual'")
  })

  it('shows needs_review banner after submit', () => {
    expect(STUDENT_PAGE_SRC).toContain('needs_review')
  })

  it('shows pending review count', () => {
    expect(STUDENT_PAGE_SRC).toContain('manualRevCount')
  })

  it('shows Ожидает проверки when needs_review', () => {
    expect(STUDENT_PAGE_SRC).toContain('Ожидает проверки')
  })

  it('counts attachments in answeredCount', () => {
    expect(STUDENT_PAGE_SRC).toContain('attachments[item.item_id]')
  })

  it('shows grading_type badge on task', () => {
    expect(STUDENT_PAGE_SRC).toContain('Развёрнутый ответ')
  })
})

// ─── 6. useVariantStudentWork ─────────────────────────────────────────────────

describe('useVariantStudentWork hook', () => {
  it('calls get_student_work_detail RPC', () => {
    expect(WORK_HOOK_SRC).toContain('get_student_work_detail')
  })

  it('calls grade_variant_answer RPC', () => {
    expect(WORK_HOOK_SRC).toContain('grade_variant_answer')
  })

  it('calls finalize_grading RPC', () => {
    expect(WORK_HOOK_SRC).toContain('finalize_grading')
  })

  it('validates score range before saving', () => {
    expect(WORK_HOOK_SRC).toContain('pts < 0 || pts > maxPoints')
  })

  it('has StudentWorkDetail interface', () => {
    expect(WORK_HOOK_SRC).toContain('export interface StudentWorkDetail')
  })

  it('has WorkItem interface', () => {
    expect(WORK_HOOK_SRC).toContain('export interface WorkItem')
  })
})

// ─── 7. VariantStudentWorkPage ────────────────────────────────────────────────

describe('VariantStudentWorkPage', () => {
  it('exports VariantStudentWorkPage', () => {
    expect(WORK_PAGE_SRC).toContain('export function VariantStudentWorkPage')
  })

  it('has finalize button with data-testid', () => {
    expect(WORK_PAGE_SRC).toContain('data-testid="finalize-grading-btn"')
  })

  it('shows grade points input', () => {
    expect(WORK_PAGE_SRC).toContain('data-testid={`grade-points-${item.item_id}`}')
  })

  it('shows grade comment textarea', () => {
    expect(WORK_PAGE_SRC).toContain('data-testid={`grade-comment-${item.item_id}`}')
  })

  it('shows grade save button per item', () => {
    expect(WORK_PAGE_SRC).toContain('data-testid={`grade-save-${item.item_id}`}')
  })

  it('disables grading for already graded work', () => {
    expect(WORK_PAGE_SRC).toContain("work.grading_status === 'graded'")
  })

  it('shows correct answer for auto tasks', () => {
    expect(WORK_PAGE_SRC).toContain('answer_html')
  })

  it('shows grade_criteria_html for manual tasks', () => {
    expect(WORK_PAGE_SRC).toContain('grade_criteria_html')
  })

  it('shows SignedImage for attachments', () => {
    expect(WORK_PAGE_SRC).toContain('SignedImage')
    expect(WORK_PAGE_SRC).toContain('variant-solutions')
  })

  it('finalize disabled while items pending', () => {
    expect(WORK_PAGE_SRC).toContain('canFinalize')
    expect(WORK_PAGE_SRC).toContain('pendingCount')
  })

  it('shows idempotent finalize success message', () => {
    expect(WORK_PAGE_SRC).toContain('finalizeOk')
  })
})

// ─── 8. App.tsx routing ───────────────────────────────────────────────────────

describe('App routing', () => {
  it('has VariantStudentWorkPage route', () => {
    expect(APP_SRC).toContain('VariantStudentWorkPage')
    expect(APP_SRC).toContain('work/:studentAssignmentId')
  })
})

// ─── 9. VariantResultRow has grading fields ───────────────────────────────────

describe('VariantResultRow', () => {
  it('has grading_status', () => {
    expect(UTILS_SRC).toContain('grading_status')
  })

  it('has auto_score', () => {
    expect(UTILS_SRC).toContain('auto_score')
  })

  it('has manual_review_count', () => {
    expect(UTILS_SRC).toContain('manual_review_count')
  })
})

// ─── 10. Security: grading_type manual behavior ───────────────────────────────
// These tests check source-level contracts rather than runtime execution.

describe('Security contracts (source checks)', () => {
  it('grade_variant_answer RPC is called in useVariantStudentWork (not student hook)', () => {
    // Only teacher hook calls grade_variant_answer, not student hook
    expect(WORK_HOOK_SRC).toContain('grade_variant_answer')
    expect(ATTEMPT_SRC).not.toContain('grade_variant_answer')
  })

  it('finalize_grading is called only in teacher hook', () => {
    expect(WORK_HOOK_SRC).toContain('finalize_grading')
    expect(ATTEMPT_SRC).not.toContain('finalize_grading')
    expect(STUDENT_PAGE_SRC).not.toContain('finalize_grading')
  })

  it('student page does not show correct answers (answer_html not read)', () => {
    expect(STUDENT_PAGE_SRC).not.toContain('answer_html')
  })

  it('save_answer_attachment is only in ManualAnswerInput (not teacher hook)', () => {
    expect(MANUAL_INPUT_SRC).toContain('save_answer_attachment')
    expect(WORK_HOOK_SRC).not.toContain('save_answer_attachment')
  })

  it('manual grading form is disabled when work is graded', () => {
    expect(WORK_PAGE_SRC).toContain("work.grading_status === 'graded'")
  })

  it('manual task not auto-set to false — pending_review expected for answered', () => {
    expect(WORK_HOOK_SRC).toContain("'pending_review'")
  })

  it('empty manual task does not require review — not_answered status used', () => {
    expect(WORK_HOOK_SRC).toContain("'not_answered'")
  })

  it('validateScore: cannot set points above max', () => {
    expect(WORK_HOOK_SRC).toContain('pts > maxPoints')
  })

  it('auto score and final score are separate (auto_score field)', () => {
    expect(WORK_HOOK_SRC).toContain('auto_score')
    expect(UTILS_SRC).toContain('auto_score')
  })

  it('percentage is null before review (needs_review)', () => {
    // StudentVariantDetailPage shows 'Ожидает проверки' instead of percentage when needsReview
    expect(STUDENT_PAGE_SRC).toContain('needsReview')
    expect(STUDENT_PAGE_SRC).toContain('Ожидает проверки')
  })
})
