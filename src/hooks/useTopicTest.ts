import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  type TopicTestAssignmentRow,
  type TopicTestAttemptRow,
  type TopicTestItemRow,
  type TopicTestRow,
  type StudentTestItem,
  type TopicTestAnswerRow,
  type BankTestSummary,
} from '@/lib/topicTest'

/**
 * Банк: список всех тестов.
 *
 * Преподаватель видит все тесты, которые может редактировать автор или admin/owner.
 * Запрос включает счётчики заданий и привязок через PostgREST embedded count.
 */
export function useTestBank() {
  const profile = useAuthStore(s => s.profile)

  const [tests, setTests] = useState<BankTestSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) {
      setTests([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data, error: err } = await supabase
        .from('topic_tests')
        .select('*, topic_test_items(count), topic_test_assignments(count)')
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const summaries: BankTestSummary[] = (data as any[]).map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        itemCount: row.topic_test_items?.[0]?.count ?? 0,
        assignmentCount: row.topic_test_assignments?.[0]?.count ?? 0,
      }))

      setTests(summaries)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [profile, tick])

  const createTest = useCallback(
    async (title: string): Promise<string> => {
      if (!profile) throw new Error('Нет активного профиля')
      const clean = title.trim()
      if (!clean) throw new Error('Название теста не может быть пустым')

      const { data, error: err } = await supabase
        .from('topic_tests')
        .insert({
          title: clean,
          created_by: profile.id,
        })
        .select('id')
        .single()

      if (err) throw err
      refresh()
      return data.id
    },
    [profile, refresh],
  )

  const deleteTest = useCallback(
    async (id: string) => {
      const { error: err } = await supabase.from('topic_tests').delete().eq('id', id)
      if (err) throw err
      refresh()
    },
    [refresh],
  )

  return {
    tests,
    loading,
    error,
    createTest,
    deleteTest,
    refresh,
  }
}

/**
 * Банк: один тест (конструктор для редактирования).
 *
 * Загружает тест, его задания и информацию о наличии попыток.
 * Позволяет обновлять название и описание, добавлять/удалять задания.
 */
export function useBankTest(testId: string | null) {
  const profile = useAuthStore(s => s.profile)

  const [test, setTest] = useState<TopicTestRow | null>(null)
  const [items, setItems] = useState<TopicTestItemRow[]>([])
  const [hasAttempts, setHasAttempts] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!testId) {
      setTest(null)
      setItems([])
      setHasAttempts(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      if (!testId) return

      const { data: testData, error: testErr } = await supabase
        .from('topic_tests')
        .select('*')
        .eq('id', testId)
        .maybeSingle()

      if (cancelled) return
      if (testErr) {
        setError(testErr.message)
        setLoading(false)
        return
      }

      const typedTestData = testData as TopicTestRow | null
      setTest(typedTestData)
      if (!typedTestData) {
        setItems([])
        setHasAttempts(false)
        setLoading(false)
        return
      }

      const [itemsRes, assignmentsRes] = await Promise.all([
        supabase
          .from('topic_test_items')
          .select('*')
          .eq('test_id', testId)
          .order('position'),
        supabase
          .from('topic_test_assignments')
          .select('id, topic_test_attempts(count)')
          .eq('test_id', testId),
      ])

      if (cancelled) return

      setItems((itemsRes.data ?? []) as TopicTestItemRow[])
      const hasAtts = (assignmentsRes.data ?? []).some(
        (a: any) => a.topic_test_attempts?.[0]?.count ?? 0 > 0,
      )
      setHasAttempts(hasAtts)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [testId, tick])

  const updateTest = useCallback(
    async (patch: Partial<Pick<TopicTestRow, 'title' | 'description'>>) => {
      if (!test) throw new Error('Тест ещё не создан')
      const { error: err } = await supabase.from('topic_tests').update(patch).eq('id', test.id)
      if (err) throw err
      setTest(prev => (prev ? { ...prev, ...patch } : prev))
    },
    [test],
  )

  const addItem = useCallback(
    async (taskId: string) => {
      if (!test) throw new Error('Тест ещё не создан')
      const { error: err } = await supabase.rpc('topic_test_add_item', {
        p_test_id: test.id,
        p_task_id: taskId,
      })
      if (err) throw new Error(err.message)
      refresh()
    },
    [test, refresh],
  )

  const removeItem = useCallback(
    async (itemId: string) => {
      const { error: err } = await supabase.from('topic_test_items').delete().eq('id', itemId)
      if (err) throw new Error(err.message)
      refresh()
    },
    [refresh],
  )

  return {
    test,
    items,
    hasAttempts,
    loading,
    error,
    updateTest,
    addItem,
    removeItem,
    refresh,
  }
}

/**
 * Результаты теста по всем привязкам.
 *
 * Загружает все попытки студентов для теста и группирует их по привязкам (assignment_id).
 * Для каждой привязки показывает название темы и курса.
 */
export interface TestAssignmentResults {
  assignment: TopicTestAssignmentRow
  topicTitle: string
  courseTitle: string
  attempts: Array<TopicTestAttemptRow & { studentName: string }>
}

export function useTestResults(testId: string | null) {
  const [results, setResults] = useState<TestAssignmentResults[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!testId) {
      setResults([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      if (!testId) {
        setResults([])
        setLoading(false)
        return
      }

      // Сначала загружаем все привязки для теста
      const { data: assignmentData } = await supabase
        .from('topic_test_assignments')
        .select('*, topics(title, modules(courses(title)))')
        .eq('test_id', testId)

      if (cancelled) return

      const assignmentIds = (assignmentData ?? []).map((a: any) => a.id)

      // Потом загружаем все попытки для этих привязок
      const attemptsRes = assignmentIds.length > 0
        ? await supabase
            .from('topic_test_attempts')
            .select('*, students(id, profiles(full_name))')
            .in('assignment_id', assignmentIds)
        : { data: [] }

      const assignmentsRes = { data: assignmentData }

      if (cancelled) return

      const attempts = (attemptsRes.data ?? []) as any[]
      const assignments = (assignmentsRes.data ?? []) as any[]

      const attemptsMap = new Map<string, Array<TopicTestAttemptRow & { studentName: string }>>()
      attempts.forEach((row: any) => {
        const attempt: TopicTestAttemptRow & { studentName: string } = {
          id: row.id,
          assignment_id: row.assignment_id,
          student_id: row.student_id,
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          total_points: row.total_points,
          max_points: row.max_points,
          studentName: row.students?.profiles?.full_name ?? 'Ученик',
        }
        const key = row.assignment_id
        if (!attemptsMap.has(key)) {
          attemptsMap.set(key, [])
        }
        attemptsMap.get(key)!.push(attempt)
      })

      // Сортируем попытки по баллам (desc), завершённые в конце
      attemptsMap.forEach((atts: any[]) => {
        atts.sort((a, b) => {
          if (a.status === 'completed' && b.status !== 'completed') return 1
          if (a.status !== 'completed' && b.status === 'completed') return -1
          const aPoints = a.total_points ?? -1
          const bPoints = b.total_points ?? -1
          return bPoints - aPoints
        })
      })

      const resultList: TestAssignmentResults[] = assignments
        .map(row => {
          const assignmentId = row.id
          return {
            assignment: {
              id: row.id,
              test_id: row.test_id,
              topic_id: row.topic_id,
              assigned_by: row.assigned_by,
              created_at: row.created_at,
            },
            topicTitle: row.topics?.title ?? '',
            courseTitle: row.topics?.modules?.courses?.title ?? '',
            attempts: attemptsMap.get(assignmentId) ?? [],
          }
        })
        .sort((a, b) => new Date(b.assignment.created_at).getTime() - new Date(a.assignment.created_at).getTime())

      setResults(resultList)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [testId, tick])

  return {
    results,
    loading,
    error,
    refresh,
  }
}

/**
 * Модалка темы: привязка теста к теме.
 *
 * Загружает текущую привязку (если есть), позволяет прикреплять и откреплять тесты.
 * Проверяет наличие попыток перед откреплением.
 */
export function useTopicTestAssignment(topicId: string | null) {
  const profile = useAuthStore(s => s.profile)

  const [assignment, setAssignment] = useState<
    | (TopicTestAssignmentRow & { test: { id: string; title: string; description: string | null } | null })
    | null
  >(null)
  const [hasAttempts, setHasAttempts] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!topicId) {
      setAssignment(null)
      setHasAttempts(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      if (!topicId) {
        setAssignment(null)
        setHasAttempts(false)
        setLoading(false)
        return
      }

      const { data: assignmentData, error: assignmentErr } = await supabase
        .from('topic_test_assignments')
        .select('*, topic_tests(id, title, description)')
        .eq('topic_id', topicId)
        .maybeSingle()

      if (cancelled) return
      if (assignmentErr) {
        setError(assignmentErr.message)
        setLoading(false)
        return
      }

      if (!assignmentData) {
        setAssignment(null)
        setHasAttempts(false)
        setLoading(false)
        return
      }

      const result = {
        id: assignmentData.id,
        test_id: assignmentData.test_id,
        topic_id: assignmentData.topic_id,
        assigned_by: assignmentData.assigned_by,
        created_at: assignmentData.created_at,
        test: assignmentData.topic_tests as any,
      }
      setAssignment(result)

      // Проверяем наличие попыток
      const { count, error: countErr } = await supabase
        .from('topic_test_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('assignment_id', assignmentData.id)

      if (!cancelled) {
        if (!countErr) {
          setHasAttempts((count ?? 0) > 0)
        }
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [topicId, tick])

  const attach = useCallback(
    async (testId: string) => {
      if (!topicId || !profile) throw new Error('Данные темы или профиля отсутствуют')
      const { error: err } = await supabase.from('topic_test_assignments').insert({
        test_id: testId,
        topic_id: topicId,
        assigned_by: profile.id,
      })
      if (err) throw new Error(err.message)
      refresh()
    },
    [topicId, profile, refresh],
  )

  const detach = useCallback(async () => {
    if (!assignment) throw new Error('Привязка не найдена')
    const { error: err } = await supabase.from('topic_test_assignments').delete().eq('id', assignment.id)
    if (err) throw new Error(err.message)
    refresh()
  }, [assignment, refresh])

  return {
    assignment,
    hasAttempts,
    loading,
    error,
    attach,
    detach,
    refresh,
  }
}

/**
 * Ученик: тест на странице темы (через привязку).
 *
 * Загружает тест через привязку к теме, задания через RPC и попытки студента.
 * Позволяет начать новую попытку, сохранять ответы и отправлять результаты.
 */
export function useTopicTestStudent(topicId: string | null) {
  const profile = useAuthStore(s => s.profile)

  const [test, setTest] = useState<{ id: string; title: string; description: string | null } | null>(null)
  const [assignmentId, setAssignmentId] = useState<string | null>(null)
  const [items, setItems] = useState<StudentTestItem[]>([])
  const [attempt, setAttempt] = useState<TopicTestAttemptRow | null>(null)
  const [answers, setAnswers] = useState<TopicTestAnswerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!topicId || !profile) {
      setTest(null)
      setAssignmentId(null)
      setItems([])
      setAttempt(null)
      setAnswers([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      // 1. Загружаем привязку и тест
      const { data: assignmentData, error: assignmentErr } = await supabase
        .from('topic_test_assignments')
        .select('id, topic_tests(id, title, description)')
        .eq('topic_id', topicId!)
        .maybeSingle()

      if (cancelled) return
      if (assignmentErr) {
        setError(assignmentErr.message)
        setLoading(false)
        return
      }

      if (!assignmentData || !assignmentData.topic_tests) {
        setTest(null)
        setAssignmentId(null)
        setItems([])
        setAttempt(null)
        setAnswers([])
        setLoading(false)
        return
      }

      const testData = assignmentData.topic_tests as any
      setTest({
        id: testData.id,
        title: testData.title,
        description: testData.description,
      })
      setAssignmentId(assignmentData.id)

      const assignmentId = assignmentData.id

      // 2. Загружаем задания через RPC
      const { data: itemsData, error: itemsErr } = await supabase.rpc('topic_test_assignment_items', {
        p_assignment_id: assignmentId,
      })

      if (cancelled) return
      if (!itemsErr) {
        setItems((itemsData ?? []) as StudentTestItem[])
      }

      // 3. Загружаем попытку студента
      const { data: attemptData, error: attemptErr } = await supabase
        .from('topic_test_attempts')
        .select('*')
        .eq('assignment_id', assignmentId)
        .maybeSingle()

      if (cancelled) return
      if (attemptErr) {
        setError(attemptErr.message)
        setLoading(false)
        return
      }

      setAttempt((attemptData as TopicTestAttemptRow) ?? null)

      // 4. Загружаем ответы, если есть попытка
      if (attemptData) {
        const { data: answersData } = await supabase
          .from('topic_test_answers')
          .select('*')
          .eq('attempt_id', attemptData.id)

        if (!cancelled) {
          setAnswers((answersData ?? []) as TopicTestAnswerRow[])
        }
      }

      if (!cancelled) {
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [topicId, profile, tick])

  const start = useCallback(async () => {
    if (!assignmentId) throw new Error('Привязка не найдена')
    const { error: err } = await supabase.rpc('topic_test_start_attempt', {
      p_assignment_id: assignmentId,
    })
    if (err) throw err
    reload()
  }, [assignmentId, reload])

  const saveAnswer = useCallback(
    async (itemId: string, text: string) => {
      if (!attempt) throw new Error('Попытка не создана')
      const { error: err } = await supabase.rpc('topic_test_save_answer', {
        p_attempt_id: attempt.id,
        p_item_id: itemId,
        p_answer: text,
      })
      if (err) throw err
      // Не перезагружаем на каждый ввод — это UX
    },
    [attempt],
  )

  const submit = useCallback(async () => {
    if (!attempt) throw new Error('Попытка не создана')
    const { error: err } = await supabase.rpc('topic_test_submit_attempt', {
      p_attempt_id: attempt.id,
    })
    if (err) throw err
    reload()
  }, [attempt, reload])

  const refresh = useCallback(() => {
    reload()
  }, [reload])

  return {
    test,
    assignmentId,
    items,
    attempt,
    answers,
    loading,
    error,
    start,
    saveAnswer,
    submit,
    refresh,
  }
}
