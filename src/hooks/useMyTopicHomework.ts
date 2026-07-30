import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useStudentTopicJournal } from '@/hooks/useStudentTopicJournal'
import { useMyCourseMemberships } from '@/hooks/useMyCourseMemberships'
import { splitHomeworkBuckets, type HomeworkBuckets, type TopicJournalHomework } from '@/lib/topicJournal'

/**
 * students.id текущего пользователя. Тот же однострочный резолв, что руками
 * повторён в десятке хуков; здесь он нужен, чтобы отдать p_student_id в
 * get_student_topic_journal (RPC сама проверит, что это «сам ученик»).
 */
export function useMyStudentId() {
  const profileId = useAuthStore(s => s.profile?.id)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profileId) { setStudentId(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    supabase.from('students').select('id').eq('profile_id', profileId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setStudentId(data?.id ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profileId])

  return { studentId, loading }
}

/**
 * Своё ДЗ по новому контуру, разложенное по трём корзинам для страницы
 * «Домашние задания» ученика.
 *
 * Источник — та же RPC get_student_topic_journal, что и журнал: она
 * единственная отдаёт ДЗ, к которому ученик ещё НЕ прикасался
 * (status = 'not_started'). Дашборд (useStudentDashboard) читает только
 * topic_homework_attempts, поэтому «предстоящие» там не видны в принципе —
 * из-за этого у ученика и не было списка предстоящих работ.
 *
 * groupId по курсу подтягивается отдельно (useMyCourseMemberships): журнал
 * отдаёт course_id, а ссылка на тему у ученика — /my-course/:groupId/topic/:topicId.
 */
export function useMyTopicHomework() {
  const { studentId, loading: resolvingStudent } = useMyStudentId()
  const { journal, loading: loadingJournal, error, reload } = useStudentTopicJournal(studentId)
  const { courses, loading: loadingCourses } = useMyCourseMemberships()

  const groupByCourseId = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of courses) map.set(c.courseId, c.primaryGroupId)
    return map
  }, [courses])

  const buckets = useMemo<HomeworkBuckets>(
    () => splitHomeworkBuckets(journal?.homework ?? []),
    [journal],
  )

  /** Ссылка на тему с этим ДЗ, если группа курса известна. */
  const topicLink = (row: TopicJournalHomework): string | null => {
    const groupId = groupByCourseId.get(row.course_id)
    return groupId ? `/my-course/${groupId}/topic/${row.topic_id}` : null
  }

  return {
    buckets,
    summary: journal?.summary ?? null,
    topicLink,
    loading: resolvingStudent || loadingJournal || loadingCourses,
    error,
    reload,
    /** Ученик не найден — например, персонал открыл страницу по прямой ссылке. */
    noStudentRecord: !resolvingStudent && !studentId,
  }
}
