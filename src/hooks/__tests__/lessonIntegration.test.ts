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
// 5-6. Выдача ДЗ с карточки занятия — снято в §197
//
// Разделы про `useAssignLessonHomework`, `AssignLessonHomeworkModal`,
// `lessonHomeworkDraft` и `LessonHomeworkCard` ушли вместе с самим сценарием:
// карточка ДЗ занятия выдавала подборку как работу, а её экраны разбора
// (`/review-submissions`, `/my-assignments`) удалены. Итоги занятия и
// материалы — разделы 3 и 4 выше — этим не затронуты.
// ══════════════════════════════════════════════════════════════════════════════

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

  it('renders LessonSummaryCard, LessonMaterialsCard', () => {
    expect(src).toContain('<LessonSummaryCard')
    expect(src).toContain('<LessonMaterialsCard')
    // Карточка Homework V2 удалена вместе с мёртвым контуром: её запрос шёл
    // в несуществующую колонку homework_templates.lesson_id.
    expect(src).not.toContain('<LessonHomeworkV2Card')
  })

  // Блок материалов переведён на новый контур (ЧАТ Б): topic_materials больше
  // не читается нигде во фронте. Легаси-таблица homeworks ушла отсюда в §185
  // вместе с карточкой «Домашние задания» урока.
  it('materials come from topic_material_items, not the legacy topic_materials table', () => {
    expect(src).toContain("from('topic_material_items')")
    expect(src).not.toContain("from('topic_materials')")
    expect(src).not.toContain("from('homeworks')")
  })

  it('marking a lesson completed also stamps completed_at', () => {
    const block = src.slice(src.indexOf('async function markCompleted'), src.indexOf('async function cancelLesson'))
    expect(block).toContain('completed_at')
  })
})
