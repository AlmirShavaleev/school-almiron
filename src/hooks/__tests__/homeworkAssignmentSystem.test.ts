/**
 * Etap 4 (v2, post architectural-verification): homework assignment system tests.
 * Covers: status model fix (assignment lifecycle vs per-student progress),
 * no direct student UPDATE, safe task-content RPC, roster snapshot,
 * private storage helpers, and page wiring.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
function read(rel: string) { return readFileSync(join(ROOT, rel), 'utf8') }
function exists(rel: string) { return existsSync(join(ROOT, rel)) }

// ══════════════════════════════════════════════════════════════════════════════
// 1. Types & labels — status model fix
// ══════════════════════════════════════════════════════════════════════════════

describe('assignments types — status model fix', () => {
  const src = read('src/types/assignments.ts')

  it('AssignedStatus is the ASSIGNMENT lifecycle: active/closed/cancelled (not per-student)', () => {
    expect(src).toContain("export type AssignedStatus = 'active' | 'closed' | 'cancelled'")
  })

  it('AssignedStatus no longer reuses per-student values (assigned/submitted/checked)', () => {
    expect(src).not.toContain("'assigned' | 'submitted' | 'checked'")
  })

  it('SubmissionStatus (per-student) is submitted/returned/accepted/rejected', () => {
    expect(src).toContain("export type SubmissionStatus = 'submitted' | 'returned' | 'accepted' | 'rejected'")
  })

  it('DisplaySubmissionStatus adds not_started as a UI-only derived state', () => {
    expect(src).toContain("export type DisplaySubmissionStatus = 'not_started' | SubmissionStatus")
  })

  it('documents that assignment status is never derived from one student', () => {
    expect(src).toContain('NOT any individual')
  })

  it('RosterRow type exists for per-student group breakdown', () => {
    expect(src).toContain('export interface RosterRow')
    expect(src).toContain('status:        DisplaySubmissionStatus')
  })

  it('StudentAssignmentTask type has no answer_html/solution_html fields', () => {
    const block = src.slice(src.indexOf('export interface StudentAssignmentTask'), src.indexOf('export const SUBMISSION_STATUS_LABELS'))
    expect(block).not.toContain('answer_html')
    expect(block).not.toContain('solution_html')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. useAssignments hook — RPC-only writes, no client-side status derivation
// ══════════════════════════════════════════════════════════════════════════════

describe('useAssignments hook', () => {
  const src = read('src/hooks/useAssignments.ts')

  it('create uses create_assignment RPC (atomic + roster snapshot), not raw insert', () => {
    expect(src).toContain("db.rpc('create_assignment'")
    expect(src).not.toContain("db.from('assigned_collections').insert")
  })

  it('submit uses submit_task_solution RPC (not direct insert/update)', () => {
    expect(src).toContain("db.rpc('submit_task_solution'")
  })

  it('grade uses grade_task_submission RPC (not direct update)', () => {
    expect(src).toContain("db.rpc('grade_task_submission'")
  })

  it('student task content comes from get_student_assignment_tasks RPC (safe, no answer/solution)', () => {
    expect(src).toContain("db.rpc('get_student_assignment_tasks'")
  })

  it('teacher roster comes from get_assignment_roster RPC', () => {
    expect(src).toContain("db.rpc('get_assignment_roster'")
  })

  it('student assignment list relies on RLS (no client-side student_id/group_id filter)', () => {
    const studentSection = src.slice(
      src.indexOf('export function useStudentAssignments'),
      src.indexOf('// ── Student: assignment + own submission'),
    )
    expect(studentSection).not.toContain(".eq('student_id'")
    expect(studentSection).not.toContain(".eq('group_id'")
  })

  it('MyAssignmentsPage-facing hook exposes per-student own submissions map (not assignment.status)', () => {
    expect(src).toContain('ownSubmissions')
  })

  it('submission files are stored as private-bucket paths, not public URLs', () => {
    expect(src).toContain("SUBMISSIONS_BUCKET = 'task-submissions'")
    expect(src).toContain('createSignedUrl')
    expect(src).not.toContain('getPublicUrl')
  })

  it('grade RPC restricts status to accepted/rejected/returned at call sites', () => {
    expect(src).toContain("status: 'accepted' | 'rejected' | 'returned'")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. AssignHomeworkPage (teacher UI) — unchanged interface, now backed by RPC
// ══════════════════════════════════════════════════════════════════════════════

describe('AssignHomeworkPage', () => {
  const src = read('src/pages/AssignHomeworkPage.tsx')

  it('lets teacher pick a collection from their own collections', () => {
    expect(src).toContain('useCollections')
    expect(src).toContain('collectionId')
  })

  it('lets teacher pick student OR group (XOR toggle)', () => {
    expect(src).toContain("targetType === 'group'")
    expect(src).toContain("targetType === 'student'")
    expect(src).toContain("student_id: targetType === 'student' ? studentId : null")
    expect(src).toContain("group_id:   targetType === 'group'   ? groupId   : null")
  })

  it('has "Назначить" button wired to useCreateAssignment', () => {
    expect(src).toContain('useCreateAssignment')
    expect(src).toContain('Назначить')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. MyAssignmentsPage (student UI) — status shown is the STUDENT'S OWN progress
// ══════════════════════════════════════════════════════════════════════════════

describe('MyAssignmentsPage', () => {
  const src = read('src/pages/student/MyAssignmentsPage.tsx')

  it('uses useStudentAssignments (RLS-scoped, snapshot-based list)', () => {
    expect(src).toContain('useStudentAssignments')
  })

  it('derives displayed status from ownSubmissions map, NOT assignment.status', () => {
    expect(src).toContain('ownSubmissions.get(a.id)?.status')
    expect(src).toContain("?? 'not_started'")
  })

  it('links to assignment detail page', () => {
    expect(src).toContain('/my-assignments/${a.id}')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. AssignmentDetailPage (student: safe task view, submit, resubmit)
// ══════════════════════════════════════════════════════════════════════════════

describe('AssignmentDetailPage', () => {
  const src = read('src/pages/student/AssignmentDetailPage.tsx')

  it('reuses TaskDisplayCard for rendering (no duplicated statement HTML logic)', () => {
    expect(src).toContain('TaskDisplayCard')
  })

  it('adapter forces has_answer/has_solution to false — RPC never supplies answer/solution content', () => {
    const adapter = src.slice(src.indexOf('function toCatalogTask'), src.indexOf('export function AssignmentDetailPage'))
    expect(adapter).toContain('has_answer: false')
    expect(adapter).toContain('has_solution: false')
    expect(adapter).toContain('answer_html: null')
    expect(adapter).toContain('solution_html: null')
  })

  it('does NOT fetch catalog_tasks directly (no useCatalogTasksBatch) — goes through safe RPC only', () => {
    expect(src).not.toContain('useCatalogTasksBatch')
  })

  it('has per-task answer textarea keyed by catalog_task_id', () => {
    expect(src).toContain('answers[item.catalog_task_id]')
  })

  it('file upload/delete goes through private-bucket helpers, not raw storage.from(homeworks)', () => {
    expect(src).toContain('uploadSubmissionFile')
    expect(src).toContain('deleteSubmissionFile')
    expect(src).not.toContain("storage.from('homeworks')")
  })

  it('resolves signed URLs for attached files (private bucket, no public URL)', () => {
    expect(src).toContain('getSubmissionFileSignedUrl')
  })

  it('submit button calls useSubmitSolution().submit (RPC-only write path)', () => {
    expect(src).toContain('useSubmitSolution')
    expect(src).toContain('submit(id, answers, files)')
  })

  it('editing locked once submitted, EXCEPT when returned (matches allowed resubmit transitions)', () => {
    expect(src).toContain("submission.status !== 'returned'")
    expect(src).toContain('isLocked')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. ReviewSubmissionsPage (teacher: list + filters)
// ══════════════════════════════════════════════════════════════════════════════

describe('ReviewSubmissionsPage', () => {
  const src = read('src/pages/ReviewSubmissionsPage.tsx')

  it('uses useTeacherSubmissions (scoped to own assignments)', () => {
    expect(src).toContain('useTeacherSubmissions')
  })

  it('has status filter with all 4 submission statuses + all', () => {
    expect(src).toContain("'all', 'submitted', 'returned', 'accepted', 'rejected'")
  })

  it('links each row to submission detail page', () => {
    // Было `/review-submissions/${s.id}`, но в коде поле называется
    // submissionId — тест падал независимо от правок каталога/бандла.
    expect(src).toContain('/review-submissions/${s.submissionId}')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. SubmissionDetailPage (teacher: grade + group roster breakdown)
// ══════════════════════════════════════════════════════════════════════════════

describe('SubmissionDetailPage', () => {
  const src = read('src/pages/SubmissionDetailPage.tsx')

  it('shows task statement + student answer per item', () => {
    expect(src).toContain('TaskDisplayCard')
    expect(src).toContain('submission.answers?.[item.catalog_task_id]')
  })

  it('resolves signed URLs for files (private bucket)', () => {
    expect(src).toContain('getSubmissionFileSignedUrl')
  })

  it('shows per-student roster for group assignments (independent of this one submission)', () => {
    expect(src).toContain('useAssignmentRoster')
    expect(src).toContain('isGroupAssignment')
  })

  it('has accept / return / reject actions via useGradeSubmission', () => {
    expect(src).toContain('useGradeSubmission')
    expect(src).toContain("handleGrade('accepted')")
    expect(src).toContain("handleGrade('returned')")
    expect(src).toContain("handleGrade('rejected')")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 8. Routing & role guards
// ══════════════════════════════════════════════════════════════════════════════

describe('App.tsx routing for Etap 4', () => {
  const src = read('src/AppRoutes.tsx')

  it('teacher-only routes: assign-homework, review-submissions', () => {
    expect(src).toContain("path=\"/assign-homework\" element={<RoleGuard allow={['teacher','admin','owner']}>")
    expect(src).toContain("path=\"/review-submissions\" element={<RoleGuard allow={['teacher','admin','owner']}>")
  })

  it('student-only routes: my-assignments', () => {
    expect(src).toContain("path=\"/my-assignments\" element={<RoleGuard allow={['student']}>")
    expect(src).toContain("path=\"/my-assignments/:id\" element={<RoleGuard allow={['student']}>")
  })

  it('curator is NOT granted access to any Etap 4 route', () => {
    const etap4Block = src.slice(src.indexOf('/assign-homework'), src.indexOf('/my-assignments/:id') + 40)
    expect(etap4Block).not.toContain('curator')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9. Etap 1-3 non-regression
// ══════════════════════════════════════════════════════════════════════════════

describe('Etap 1-3 non-regression', () => {
  it('CollectionDetailPage still uses task_collections/task_collection_items as before', () => {
    const src = read('src/pages/CollectionDetailPage.tsx')
    expect(src).toContain('useCollection')
    expect(src).toContain('VariantPrintPanel')
  })

  it('VariantDocument (unified renderer) still uses resolveTaskHtml, answers/explanations intact', () => {
    const src = read('src/components/pdf/VariantDocument.tsx')
    expect(src).toContain('resolveTaskHtml')
    expect(src).toContain('showAnswers')
    expect(src).toContain('showExplanations')
  })

  it('legacy PdfExportModal/PrintDocument/pdfTypes were removed — single PDF renderer only', () => {
    expect(exists('src/components/pdf/PdfExportModal.tsx')).toBe(false)
    expect(exists('src/components/pdf/PrintDocument.tsx')).toBe(false)
    expect(exists('src/components/pdf/pdfTypes.ts')).toBe(false)
  })
})
