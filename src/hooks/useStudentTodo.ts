import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  buildStudentTodo,
  type StudentTodo,
  type TodoHomework,
  type TodoTest,
  type TodoVerdict,
} from '@/lib/studentTodo'

/**
 * Список дел ученика: что просрочено, что вернули, что сдавать, что открылось.
 *
 * Хук только собирает данные; вся раскладка — в `lib/studentTodo`, чтобы
 * правила проверялись без сети. Сужение держит RLS: ученик видит свои попытки
 * (`student_id = auth_student_id()`) и ДЗ только открытых тем своих курсов.
 * Отдельного клиентского фильтра «только моё» здесь не нужно — в отличие от
 * учительских страниц, где RLS администратору не сужает ничего (§80).
 */

const EMPTY: StudentTodo = {
  overdue: [], returned: [], dueSoon: [], tests: [], newlyOpened: [], checked: [], isClear: true,
}

export function useStudentTodo(profileId: string | undefined) {
  const [todo, setTodo] = useState<StudentTodo>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profileId) { setTodo(EMPTY); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load(pid: string) {
      const { data: student } = await supabase
        .from('students').select('id').eq('profile_id', pid).maybeSingle()
      if (cancelled) return
      // Профиль без строки students — это персонал, зашедший на ученический
      // маршрут. Пустой список честнее выдуманного.
      if (!student?.id) { setTodo(EMPTY); setLoading(false); return }

      // Мои группы → курсы. Через group_students, а не student_courses:
      // вторая таблица легаси и с настоящим доступом не связана.
      const { data: memberships } = await supabase
        .from('group_students')
        .select('group_id, groups!inner(id, course_id)')
        .eq('student_id', student.id)
      if (cancelled) return

      const groupByCourse = new Map<string, string>()
      for (const row of (memberships ?? []) as any[]) {
        const courseId = row.groups?.course_id
        if (courseId && !groupByCourse.has(courseId)) groupByCourse.set(courseId, row.groups.id)
      }
      const courseIds = [...groupByCourse.keys()]

      if (courseIds.length === 0) { setTodo(EMPTY); setLoading(false); return }

      const [hwRes, attemptsRes, verdictsRes, testAssignRes, testAttemptsRes] = await Promise.all([
        // ДЗ моих курсов вместе с темой: открытость темы считается на клиенте
        // зеркалом `topic_open_now` (§59), поэтому нужны is_open и
        // available_from, а не только факт существования темы.
        supabase
          .from('topic_homework')
          .select('id, title, due_at, topic:topics!inner(id, title, is_open, available_from, module:modules!inner(id, course:courses!inner(id, title)))')
          .eq('is_published', true),
        // Тот же select, что у очереди проверки, — чтобы переиспользовать
        // `toQueueRows` + `collapseToWorks` (§88) без второй копии правила.
        supabase
          .from('topic_homework_attempts')
          .select('*, homework:topic_homework!inner(id, title, grade_scale, due_at, topic:topics!inner(id, title, module:modules!inner(id, course:courses!inner(id, title))))')
          .eq('student_id', student.id),
        supabase
          .from('topic_homework_reviews')
          .select('id, attempt_id, decision, score, comment, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('topic_test_assignments')
          .select('id, test_id, topic_id, topic:topics!inner(id, title), test:topic_tests!inner(id, title)'),
        supabase
          .from('topic_test_attempts')
          .select('id, test_id, status, completed_at')
          .eq('student_id', student.id),
      ])
      if (cancelled) return

      const homework: TodoHomework[] = []
      for (const row of (hwRes.data ?? []) as any[]) {
        const topic = row.topic
        const course = topic?.module?.course
        if (!topic?.id || !course?.id) continue
        if (!groupByCourse.has(course.id)) continue
        homework.push({
          homeworkId:    row.id,
          homeworkTitle: row.title ?? 'Домашнее задание',
          topicId:       topic.id,
          topicTitle:    topic.title ?? 'Тема',
          courseId:      course.id,
          courseTitle:   course.title ?? 'Курс',
          groupId:       groupByCourse.get(course.id) ?? null,
          dueAt:         row.due_at ?? null,
          topic:         { is_open: topic.is_open ?? null, available_from: topic.available_from ?? null },
        })
      }

      const myAttemptIds = new Set((attemptsRes.data ?? []).map((a: any) => a.id))
      const verdicts: TodoVerdict[] = []
      for (const row of (verdictsRes.data ?? []) as any[]) {
        // Политика вердиктов пускает персонал к чужим разборам; ученику здесь
        // нужны только свои, поэтому отсекаем по своим же попыткам.
        if (!myAttemptIds.has(row.attempt_id)) continue
        if (row.decision !== 'accepted' && row.decision !== 'returned_for_revision') continue
        verdicts.push({
          attemptId:     row.attempt_id,
          homeworkTitle: '',
          decision:      row.decision,
          score:         row.score ?? null,
          gradeScale:    null,
          comment:       row.comment ?? null,
          createdAt:     row.created_at,
        })
      }

      // Названия работ для «Проверено» — по своим же попыткам.
      const titleByAttempt = new Map<string, { title: string; scale: 'five' | 'hundred' | null }>()
      for (const row of (attemptsRes.data ?? []) as any[]) {
        titleByAttempt.set(row.id, {
          title: row.homework?.title ?? 'Домашнее задание',
          scale: row.homework?.grade_scale ?? null,
        })
      }
      for (const verdict of verdicts) {
        const meta = titleByAttempt.get(verdict.attemptId)
        verdict.homeworkTitle = meta?.title ?? 'Домашнее задание'
        verdict.gradeScale = meta?.scale ?? null
      }

      const completedTests = new Set(
        (testAttemptsRes.data ?? [])
          .filter((a: any) => a.status === 'completed' && a.completed_at)
          .map((a: any) => a.test_id),
      )
      const tests: TodoTest[] = []
      for (const row of (testAssignRes.data ?? []) as any[]) {
        tests.push({
          assignmentId: row.id,
          testId:       row.test_id,
          testTitle:    row.test?.title ?? 'Тестирование',
          topicId:      row.topic_id,
          topicTitle:   row.topic?.title ?? 'Тема',
          completed:    completedTests.has(row.test_id),
        })
      }

      setTodo(buildStudentTodo({
        rawAttempts: attemptsRes.data ?? [],
        homework,
        tests,
        verdicts,
      }))
      setLoading(false)
    }

    load(profileId).catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить список дел')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [profileId, tick])

  return { todo, loading, error, reload }
}
