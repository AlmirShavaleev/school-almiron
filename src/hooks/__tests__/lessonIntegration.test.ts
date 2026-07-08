/**
 * Etap 5: lesson integration tests (materials, summary, homework-from-lesson).
 * Source-inspection style, matching project convention (see homeworkAssignmentSystem.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
function read(rel: string) { return readFileSync(join(ROOT, rel), 'utf8') }

// ══════════════════════════════════════════════════════════════════════════════
// 1. Types
// ══════════════════════════════════════════════════════════════════════════════

describe('lessons types', () => {
  const src = read('src/types/lessons.ts')

  it('LessonSummary documents that teacher_notes is server-nulled for non-owners', () => {
    expect(src).toContain('teacher_notes is nulled server-side')
  })

  it('MaterialType has file/link/recording/board/note', () => {
    expect(src).toContain("export type MaterialType = 'file' | 'link' | 'recording' | 'board' | 'note'")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. useLessonSummary — safe RPC only, never raw table select for teacher_notes
// ══════════════════════════════════════════════════════════════════════════════

describe('useLessonSummary hook', () => {
  const src = read('src/hooks/useLessonSummary.ts')

  it('reads via get_lesson_summary RPC (server nulls teacher_notes for students)', () => {
    expect(src).toContain("db.rpc('get_lesson_summary'")
  })

  it('writes via save_lesson_summary RPC (not raw update)', () => {
    expect(src).toContain("db.rpc('save_lesson_summary'")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. LessonSummaryCard — hides teacher_notes from student in the UI too (defense in depth)
// ══════════════════════════════════════════════════════════════════════════════

describe('LessonSummaryCard', () => {
  const src = read('src/components/lessons/LessonSummaryCard.tsx')

  it('renders teacher_notes only when canEdit is true', () => {
    expect(src).toContain('{canEdit && summary.teacher_notes &&')
  })

  it('has a single save action (no field-by-field autosave)', () => {
    expect(src).toContain('handleSave')
    expect(src).toContain('Сохранить')
  })

  it('separates internal note from student-visible feedback field', () => {
    expect(src).toContain('teacher_notes')
    expect(src).toContain('student_feedback')
    expect(src).toContain('Внутренняя заметка')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. useLessonMaterials / storage — private bucket, signed URLs only
// ══════════════════════════════════════════════════════════════════════════════

describe('useLessonMaterials hook', () => {
  const src = read('src/hooks/useLessonMaterials.ts')

  it('uses private lesson-materials bucket', () => {
    expect(src).toContain("const BUCKET = 'lesson-materials'")
  })

  it('resolves signed URLs, never public URLs', () => {
    expect(src).toContain('createSignedUrl')
    expect(src).not.toContain('getPublicUrl')
  })

  it('path convention is {lesson_id}/{uploader_profile_id}/{filename}', () => {
    expect(src).toContain('`${lessonId}/${uploaderProfileId}/')
  })
})

describe('LessonMaterialsCard', () => {
  const src = read('src/components/lessons/LessonMaterialsCard.tsx')

  it('supports link/file/recording/board/note types', () => {
    expect(src).toContain("['link', 'recording', 'board', 'note', 'file']")
  })

  it('has an is_visible_to_student toggle when adding material', () => {
    expect(src).toContain('is_visible_to_student')
    expect(src).toContain('Видно ученику')
  })

  it('only shows delete control when canEdit (teacher)', () => {
    expect(src).toContain('{canEdit && (')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Homework-from-lesson: auto-derives recipient, no second assignment mechanism
// ══════════════════════════════════════════════════════════════════════════════

describe('useAssignLessonHomework / useLessonHomework', () => {
  const src = read('src/hooks/useAssignments.ts')

  it('assign_lesson_homework RPC receives no student_id/group_id from client (server derives from lesson)', () => {
    const block = src.slice(src.indexOf('export function useAssignLessonHomework'), src.indexOf('export function useLessonHomework'))
    expect(block).toContain("db.rpc('assign_lesson_homework'")
    expect(block).not.toContain('p_student_id')
    expect(block).not.toContain('p_group_id')
  })

  it('surfaces duplicate-assignment as a distinct flag for explicit confirmation', () => {
    expect(src).toContain('isDuplicate')
    expect(src).toContain("err.message.includes('DUPLICATE')")
  })

  it('lesson homework query filters by lesson_id (the new nullable link)', () => {
    const block = src.slice(src.indexOf('export function useLessonHomework'))
    expect(block).toContain(".eq('lesson_id', lessonId)")
  })
})

describe('AssignLessonHomeworkModal', () => {
  const src = read('src/components/lessons/AssignLessonHomeworkModal.tsx')

  it('lets teacher pick an existing collection', () => {
    expect(src).toContain('useCollections')
  })

  it('"Собрать новую подборку" persists lesson context via a dedicated draft key, not the cart', () => {
    expect(src).toContain('setLessonHomeworkDraftContext')
    expect(src).toContain("navigate('/catalog')")
  })

  it('shows duplicate-confirmation UI distinct from generic errors', () => {
    expect(src).toContain('isDuplicate')
    expect(src).toContain('Всё равно назначить ещё раз')
  })

  it('does not collect student_id/group_id from the teacher (auto-derived server-side)', () => {
    expect(src).not.toContain('studentId')
    expect(src).not.toContain('groupId')
  })
})

describe('lessonHomeworkDraft util — separate from cart', () => {
  const src = read('src/utils/lessonHomeworkDraft.ts')

  it('uses a distinct localStorage key from the cart store', () => {
    expect(src).toContain("'almiron:lesson-homework-draft-context'")
    expect(src).not.toContain('almiron-cart')
  })

  it('survives reload (localStorage, not component state)', () => {
    expect(src).toContain('localStorage.setItem')
    expect(src).toContain('localStorage.getItem')
  })
})

describe('CartPage — lesson-return wiring does not affect the plain cart flow', () => {
  const src = read('src/pages/CartPage.tsx')

  it('checks lesson draft context only after a successful save, falls back to normal /collections/:id', () => {
    expect(src).toContain('getLessonHomeworkDraftContext()')
    expect(src).toContain("navigate(`/collections/${id}`)")
    expect(src).toContain('assignCollection=')
  })

  it('clears the draft context once consumed (no stale redirect on next normal save)', () => {
    expect(src).toContain('clearLessonHomeworkDraftContext()')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. LessonHomeworkCard — states, group summary, no lesson-status coupling
// ══════════════════════════════════════════════════════════════════════════════

describe('LessonHomeworkCard', () => {
  const src = read('src/components/lessons/LessonHomeworkCard.tsx')

  it('shows "not added yet" + add button only for teacher when no assignment exists', () => {
    expect(src).toContain('Домашнее задание пока не добавлено')
    expect(src).toContain('canEdit && !assignment')
  })

  it('shows group roster summary (total/not_started/submitted/returned/accepted) for group assignments', () => {
    expect(src).toContain('function GroupSummary')
    expect(src).toContain("r.status === 'not_started'")
    expect(src).toContain("r.status === 'accepted'")
  })

  it('one submission being reviewed does not touch other roster rows (rendered independently per row)', () => {
    expect(src).toContain('function RosterRow')
    expect(src).toContain('entries.map(r =>')
  })

  it('never writes/reads lesson.status — homework status is fully independent', () => {
    expect(src).not.toContain('lesson.status')
    expect(src).not.toContain('lessonStatus')
  })

  it('student sees own status and a link into the existing Etap4 assignment detail page (reused, not duplicated)', () => {
    expect(src).toContain('/my-assignments/${assignment.id}')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. RLS/route wiring
// ══════════════════════════════════════════════════════════════════════════════

describe('App.tsx — /lessons/:id now includes student', () => {
  const src = read('src/AppRoutes.tsx')

  it('student can access lesson detail (fixes prior gap where students had zero access)', () => {
    expect(src).toContain("path=\"/lessons/:id\" element={<RoleGuard allow={['teacher','curator','admin','owner','student']}>")
  })
})

describe('LessonDetailPage — Etap 5 sections wired without touching legacy blocks', () => {
  const src = read('src/pages/LessonDetailPage.tsx')

  it('renders LessonSummaryCard, LessonMaterialsCard, LessonHomeworkCard', () => {
    expect(src).toContain('<LessonSummaryCard')
    expect(src).toContain('<LessonMaterialsCard')
    expect(src).toContain('<LessonHomeworkCard')
  })

  it('legacy topic_materials and homeworks-table blocks remain untouched', () => {
    expect(src).toContain("from('topic_materials')")
    expect(src).toContain("from('homeworks')")
  })

  it('marking a lesson completed also stamps completed_at', () => {
    const block = src.slice(src.indexOf('async function markCompleted'), src.indexOf('async function cancelLesson'))
    expect(block).toContain('completed_at')
  })
})
