import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const src = readFileSync(join(root, 'src/pages/CourseProgramPage.tsx'), 'utf8')

describe('CourseProgramPage — Homework V2 cutover', () => {
  it('uses Homework V2 templates in the program tab and removes legacy homework reads', () => {
    expect(src).toContain("useCourseHomeworkTemplates(selectedId)")
    expect(src).toContain("homeworkByTopic")
    expect(src).toContain("onOpenHomeworkTab={() => setTab('homework')}")
    expect(src).not.toContain("from('homeworks')")
    expect(src).not.toContain("from('homework_submissions')")
  })

  it('removes legacy homework archive/restore/delete handlers from active UI', () => {
    expect(src).not.toContain('handleDeleteHw(')
    expect(src).not.toContain('handleRestoreHw(')
    expect(src).not.toContain('CreateHomeworkModal')
  })
})
