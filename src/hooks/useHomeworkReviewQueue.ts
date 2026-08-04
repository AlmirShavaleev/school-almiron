import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  QUEUE_STATUSES,
  collapseToWorks,
  countByTab,
  isAlreadyReviewedError,
  rowsOfTab,
  sortQueue,
  toQueueRows,
  type QueueRow,
  type QueueTab,
} from '@/lib/homeworkQueue'
import type { TopicHomeworkAttemptFileRow, TopicHomeworkReviewRow } from '@/lib/topicHomework'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * Общая очередь проверки ДЗ преподавателя: попытки по всем темам его курсов.
 *
 * Грузим сразу три состояния — «сдано», «на доработке», «принято». Раньше
 * запрос был жёстко `status = 'submitted'`, и страница показывала только
 * ожидающих: принятые и возвращённые с неё были невидимы, хотя их
 * большинство. Одним запросом вместо трёх — потому что счётчики вкладок
 * должны быть честными ещё до того, как на вкладку зашли.
 *
 * Видимость держит RLS — но только НАСТОЯЩЕМУ преподавателю.
 * `topic_homework_attempts_select` пускает через `topic_homework_can_manage`,
 * а та упирается в `course_is_staff`, которая администратору отвечает «да» на
 * любой курс. Поэтому у владельца в режиме учителя очередь без клиентского
 * сужения показывала бы сдачи всей школы.
 */
export function useHomeworkReviewQueue(tab: QueueTab = 'submitted') {
  const scope = useMyTeachingScope()
  const [all, setAll] = useState<QueueRow[]>([])
  const [attemptFiles, setAttemptFiles] = useState<TopicHomeworkAttemptFileRow[]>([])
  const [reviews, setReviews] = useState<TopicHomeworkReviewRow[]>([])
  const [studentNames, setStudentNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  const rows = useMemo(() => rowsOfTab(all, tab), [all, tab])
  const counts = useMemo(() => countByTab(all), [all])

  useEffect(() => {
    // Пока набор «мои курсы» не приехал, фильтровать нечем — ждём, иначе на
    // мгновение показали бы чужие сдачи.
    if (scope.active && scope.loading) return

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data, error: err } = await supabase
        .from('topic_homework_attempts')
        .select(
          '*, homework:topic_homework!inner(id, title, grade_scale, due_at, topic:topics!inner(id, title, module:modules!inner(id, course:courses!inner(id, title))))',
        )
        .in('status', QUEUE_STATUSES)
        .order('submitted_at', { ascending: true })

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }

      // Схлопываем попытки в работы ДО всех фильтров и счётчиков: вкладка и
      // счётчик обязаны говорить об одном и том же — о работах.
      const loaded = sortQueue(collapseToWorks(toQueueRows(data ?? [])))
      // Куратор курса — это может быть ученик другого курса, и RLS отдаёт ему
      // ЕЩЁ И его собственные сдачи (`student_id = auth_student_id()`).
      // Сам себя человек не проверяет: свои работы из очереди убираем.
      // У владельца строки `students` нет, `ownStudentId` там null — фильтр
      // вырождается в тождество и вкладки считаются как раньше.
      setAll(scope.active
        ? loaded.filter(r => scope.courseIds.includes(r.courseId)
                          && r.attempt.student_id !== scope.ownStudentId)
        : loaded)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [tick, scope.active, scope.loading, scope.courseIds, scope.ownStudentId])

  /**
   * Подробности — только для строк ОТКРЫТОЙ вкладки: файлы, имена учеников и
   * вердикты. На вкладках «На доработке» и «Принятые» вердикт — главное, что
   * там смотрят, поэтому он едет вместе со списком, а не по клику.
   */
  const attemptIdsKey = useMemo(() => rows.map(r => r.attempt.id).sort().join(','), [rows])

  useEffect(() => {
    const attemptIds = attemptIdsKey ? attemptIdsKey.split(',') : []
    if (attemptIds.length === 0) {
      setAttemptFiles([]); setReviews([]); setStudentNames({})
      return
    }

    let cancelled = false
    const studentIds = Array.from(new Set(rows.map(r => r.attempt.student_id)))
    // Вердикты берём и по прошлым попыткам: «за что вернули в прошлый раз» —
    // первое, что нужно знать, открывая пересданную работу.
    const reviewIds = Array.from(new Set([
      ...attemptIds,
      ...rows.flatMap(r => r.history.map(h => h.id)),
    ]))

    async function loadDetails() {
      const [filesRes, studentsRes, reviewsRes] = await Promise.all([
        supabase.from('topic_homework_attempt_files').select('*').in('attempt_id', attemptIds).order('position'),
        supabase.from('students').select('id, profiles!inner(full_name)').in('id', studentIds),
        supabase.from('topic_homework_reviews').select('*').in('attempt_id', reviewIds).order('created_at'),
      ])
      if (cancelled) return

      setAttemptFiles((filesRes.data ?? []) as TopicHomeworkAttemptFileRow[])
      setReviews((reviewsRes.data ?? []) as TopicHomeworkReviewRow[])
      const names: Record<string, string> = {}
      for (const s of (studentsRes.data ?? []) as any[]) {
        names[s.id] = s.profiles?.full_name ?? 'Ученик'
      }
      setStudentNames(names)
    }

    void loadDetails()
    return () => { cancelled = true }
    // rows пересобирается вместе с ключом — в зависимостях достаточно ключа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptIdsKey])

  /**
   * Вердикт из очереди — тот же RPC, что и в теме. После успеха строка не
   * пропадает, а меняет статус локально: работа уезжает на вкладку «Принятые»
   * или «На доработке», и счётчики сходятся без повторного запроса.
   *
   * Двойная проверка одной работы возможна: персонала у курса несколько
   * (владелец, преподаватели групп, кураторы), и очередь у всех общая. От
   * порчи данных защищает сама RPC — она меняет статус только `where status =
   * 'submitted'` и иначе падает, так что второй вердикт не перезапишет первый.
   * Но её текст «Попытка не в статусе "сдано"» ничего не объясняет
   * преподавателю. Переводим его на человеческий и перечитываем очередь: чужое
   * решение уже в базе, и показывать своё представление о нём — врать.
   */
  const reviewAttempt = useCallback(
    async (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string, score?: number | null) => {
      const { error: err } = await supabase.rpc('topic_homework_review_attempt', {
        p_attempt_id: attemptId,
        p_decision: decision,
        p_comment: comment?.trim() || undefined,
        p_score: score ?? undefined,
      })
      if (err) {
        if (isAlreadyReviewedError(err)) {
          reload()
          throw new Error('Эту работу уже проверил кто-то другой — она убрана из очереди.')
        }
        throw err
      }
      setAll(prev => prev.map(r => (
        r.attempt.id === attemptId ? { ...r, attempt: { ...r.attempt, status: decision } } : r
      )))
    },
    [reload],
  )

  return { rows, all, counts, attemptFiles, reviews, studentNames, loading, error, reload, reviewAttempt }
}
