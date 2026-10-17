import { useEffect, useState } from 'react'
import { LessonEventModal } from '@/components/student/course/LessonEventModal'
import { useStudentCourseProgram } from '@/hooks/useStudentCourseProgram'
import { isWorksOnlyModule } from '@/lib/courseAssessments'
import { snapshotOf, takeLessonEvent, type LessonEvent } from '@/lib/lessonEvents'
import type { ScreenModule } from '@/lib/courseScreen'

/**
 * Показ модалки «Урок пройден / открыт следующий» (письмо 16.10) по уже
 * загруженной программе курса: событие берётся из разницы со снимком и сразу
 * запоминается — второй раз то же не покажется. Разделы «только работы» не
 * участвуют: это контрольные, а не уроки.
 */
export function LessonEvents({ who, courseId, groupId, modules }: {
  who: string | null
  courseId: string | null | undefined
  groupId: string | null | undefined
  modules: readonly (ScreenModule & { topics: ReadonlyArray<ScreenModule['topics'][number] & { kind?: unknown }> })[] | null
}) {
  const [event, setEvent] = useState<LessonEvent | null>(null)
  const lessons = (modules ?? []).filter(m => !isWorksOnlyModule(m))
  // Ключ состояния: пересчитываем только когда реально что-то сдано или открылось.
  const key = lessons.length ? JSON.stringify(snapshotOf(lessons)) : ''

  useEffect(() => {
    if (!who || !courseId || !key) return
    const ev = takeLessonEvent(who, courseId, lessons)
    // Событие — из внешнего хранилища (localStorage) при смене состояния курса.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ev) setEvent(ev)
    // lessons — производное от key; зависеть от массива — пересчёт каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, courseId, key])

  if (!event || !groupId) return null
  return <LessonEventModal event={event} onClose={() => setEvent(null)} hrefFor={id => `/my-course/${groupId}/topic/${id}`} />
}

/**
 * Страница урока: программы курса там нет — грузим её и перечитываем, когда
 * меняется состояние ДЗ (сдал — урок засчитан, модалка сразу).
 */
export function TopicLessonEvents({ who, courseId, groupId, refreshKey }: {
  who: string | null
  courseId: string | null | undefined
  groupId: string
  refreshKey: string
}) {
  const program = useStudentCourseProgram(groupId)
  const { reload } = program
  const [seenKey, setSeenKey] = useState(refreshKey)
  useEffect(() => {
    if (refreshKey === seenKey) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeenKey(refreshKey)
    reload()
  }, [refreshKey, seenKey, reload])
  if (program.loading) return null
  return <LessonEvents who={who} courseId={courseId ?? program.course?.id} groupId={groupId} modules={program.modules} />
}
