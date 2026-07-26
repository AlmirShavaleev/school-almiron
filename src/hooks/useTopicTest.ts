import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  type TopicTestAttemptRow,
  type TopicTestItemRow,
  type TopicTestRow,
  type StudentTestItem,
  type TopicTestAnswerRow,
} from '@/lib/topicTest'

/**
 * Преподавательский хук: управление тестом по теме.
 *
 * Что видно и что можно менять, определяют RLS и триггеры на стороне БД.
 * Хук их не дублирует: черновики теста и чужие попытки просто не приходят,
 * а запреты вроде удаления заданий при наличии попыток возвращаются
 * ошибкой из базы — её и показываем.
 */
export function useTopicTest(topicId: string | null) {
  const profile = useAuthStore(s => s.profile)

  const [test, setTest] = useState<TopicTestRow | null>(null)
  const [items, setItems] = useState<TopicTestItemRow[]>([])
  const [hasAttempts, setHasAttempts] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!topicId) {
      setTest(null)
      setItems([])
      setHasAttempts(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: testData, error: testErr } = await supabase
        .from('topic_tests')
        .select('*')
        .eq('topic_id', topicId!)
        .maybeSingle()

      if (cancelled) return
      if (testErr) {
        setError(testErr.message)
        setLoading(false)
        return
      }

      setTest((testData as TopicTestRow) ?? null)
      if (!testData) {
        setItems([])
        setHasAttempts(false)
        setLoading(false)
        return
      }

      const [itemsRes, attemptsRes] = await Promise.all([
        supabase
          .from('topic_test_items')
          .select('*')
          .eq('test_id', testData.id)
          .order('position'),
        supabase
          .from('topic_test_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('test_id', testData.id),
      ])

      if (cancelled) return

      setItems((itemsRes.data ?? []) as TopicTestItemRow[])
      setHasAttempts((attemptsRes.count ?? 0) > 0)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [topicId, tick])

  // ── преподаватель ──────────────────────────────────────────

  const createTest = useCallback(
    async (title: string) => {
      if (!topicId) throw new Error('Тема не выбрана')
      if (!profile) throw new Error('Нет активного профиля')
      const clean = title.trim()
      if (!clean) throw new Error('Название теста не может быть пустым')

      const { data, error: err } = await supabase
        .from('topic_tests')
        .insert({
          topic_id: topicId,
          title: clean,
          is_published: false,
          created_by: profile.id,
        })
        .select('*')
        .single()

      if (err) throw err
      setTest(data as TopicTestRow)
      reload()
    },
    [topicId, profile, reload],
  )

  const updateTest = useCallback(
    async (patch: Partial<Pick<TopicTestRow, 'title' | 'description' | 'is_published'>>) => {
      if (!test) throw new Error('Тест ещё не создан')
      const { error: err } = await supabase
        .from('topic_tests')
        .update(patch)
        .eq('id', test.id)
      if (err) throw err
      setTest(prev => (prev ? { ...prev, ...patch } : prev))
    },
    [test],
  )

  const setPublished = useCallback(
    async (v: boolean) => {
      await updateTest({ is_published: v })
    },
    [updateTest],
  )

  const deleteTest = useCallback(async () => {
    if (!test) throw new Error('Тест не найден')
    const { error: err } = await supabase.from('topic_tests').delete().eq('id', test.id)
    if (err) throw err
    reload()
  }, [test, reload])

  const addItem = useCallback(
    async (taskId: string) => {
      if (!test) throw new Error('Тест ещё не создан')
      const { error: err } = await supabase.rpc('topic_test_add_item', {
        p_test_id: test.id,
        p_task_id: taskId,
      })
      if (err) throw new Error(err.message)
      reload()
    },
    [test, reload],
  )

  const removeItem = useCallback(
    async (itemId: string) => {
      const { error: err } = await supabase.from('topic_test_items').delete().eq('id', itemId)
      if (err) throw new Error(err.message)
      reload()
    },
    [reload],
  )

  const refresh = useCallback(() => {
    reload()
  }, [reload])

  return {
    test,
    items,
    hasAttempts,
    loading,
    error,
    createTest,
    updateTest,
    setPublished,
    deleteTest,
    addItem,
    removeItem,
    refresh,
  }
}

/**
 * Ученический хук: прохождение теста по теме.
 *
 * Черновики теста и чужие попытки ученику не приходят — отсекают RLS и RPC.
 * Эталоны ответов появляются в items только после завершения попытки:
 * это решает база (topic_test_student_items), клиент лишь показывает.
 */
export function useTopicTestStudent(topicId: string | null) {
  const profile = useAuthStore(s => s.profile)

  const [test, setTest] = useState<TopicTestRow | null>(null)
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
      setItems([])
      setAttempt(null)
      setAnswers([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: testData, error: testErr } = await supabase
        .from('topic_tests')
        .select('*')
        .eq('topic_id', topicId!)
        .eq('is_published', true)
        .maybeSingle()

      if (cancelled) return
      if (testErr) {
        setError(testErr.message)
        setLoading(false)
        return
      }

      setTest((testData as TopicTestRow) ?? null)
      if (!testData) {
        setItems([])
        setAttempt(null)
        setAnswers([])
        setLoading(false)
        return
      }

      const [itemsRes, attemptRes] = await Promise.all([
        supabase.rpc('topic_test_student_items', { p_test_id: testData.id }),
        supabase
          .from('topic_test_attempts')
          .select('*')
          .eq('test_id', testData.id)
          .maybeSingle(),
      ])

      if (cancelled) return

      setItems((itemsRes.data ?? []) as StudentTestItem[])
      setAttempt((attemptRes.data as TopicTestAttemptRow) ?? null)

      if (attemptRes.data) {
        const answersRes = await supabase
          .from('topic_test_answers')
          .select('*')
          .eq('attempt_id', attemptRes.data.id)

        if (!cancelled) {
          setAnswers((answersRes.data ?? []) as TopicTestAnswerRow[])
        }
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [topicId, profile, tick])

  // ── ученик ─────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (!test) throw new Error('Тест не найден')
    const { error: err } = await supabase.rpc('topic_test_start_attempt', {
      p_test_id: test.id,
    })
    if (err) throw err
    reload()
  }, [test, reload])

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
