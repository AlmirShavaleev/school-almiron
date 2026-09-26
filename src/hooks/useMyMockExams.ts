import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { usePreviewMode } from '@/store/staffModeStore'
import { loadMockExamsByGroup } from '@/lib/myMockExams'
import type { MockLessonListRow } from '@/lib/mockExamLesson'

/**
 * §224.2. Пробники групп ученика по id групп — для баннера «Идёт пробник» на
 * странице темы, в «Мои курсы» и в кабинете. Страница курса берёт тот же
 * список из `useStudentCourseProgram` (одна загрузка на экран).
 *
 * Ученик — `my_mock_exams`, предпросмотр персонала — расписание из
 * `mock_exams` (см. `lib/myMockExams.ts`). У персонала вне предпросмотра не
 * зовётся ничего.
 */
export function useMyMockExams(groupIds: (string | null | undefined)[]): Record<string, MockLessonListRow[]> {
  const role = useAuthStore(s => s.profile?.role)
  const preview = usePreviewMode()
  const ids = [...new Set(groupIds.filter((g): g is string => !!g))].sort()
  const key = ids.join(',')
  const [byGroup, setByGroup] = useState<Record<string, MockLessonListRow[]>>({})

  useEffect(() => {
    // Пусто и так — не перерисовываем экран лишний раз.
    if (!key || (role !== 'student' && !preview)) { setByGroup(prev => (Object.keys(prev).length ? {} : prev)); return }
    let cancelled = false
    loadMockExamsByGroup(key.split(','), preview).then(res => { if (!cancelled) setByGroup(res) })
    return () => { cancelled = true }
  }, [key, role, preview])

  return byGroup
}
