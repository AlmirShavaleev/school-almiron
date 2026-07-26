import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  TOPIC_HOMEWORK_BUCKET,
  buildAttemptFilePath,
  buildHomeworkFilePath,
  type TopicHomeworkAttemptFileRow,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkFileRow,
  type TopicHomeworkReviewRow,
  type TopicHomeworkRow,
} from '@/lib/topicHomework'

/**
 * PDF-ДЗ темы: одно на тему.
 *
 * Что видно и что можно менять, определяют RLS и триггеры на стороне БД.
 * Хук их не дублирует: ученику черновик ДЗ просто не приходит, чужие попытки
 * не приходят, а запреты вроде пересдачи принятой работы возвращаются
 * ошибкой из базы — её и показываем.
 */
export function useTopicHomework(topicId: string | null) {
  const profile = useAuthStore(s => s.profile)

  const [homework, setHomework] = useState<TopicHomeworkRow | null>(null)
  const [files, setFiles] = useState<TopicHomeworkFileRow[]>([])
  const [attempts, setAttempts] = useState<TopicHomeworkAttemptRow[]>([])
  const [attemptFiles, setAttemptFiles] = useState<TopicHomeworkAttemptFileRow[]>([])
  const [reviews, setReviews] = useState<TopicHomeworkReviewRow[]>([])
  const [studentNames, setStudentNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!topicId) {
      setHomework(null); setFiles([]); setAttempts([]); setAttemptFiles([]); setReviews([]); setStudentNames({})
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: hw, error: hwErr } = await supabase
        .from('topic_homework')
        .select('*')
        .eq('topic_id', topicId!)
        .maybeSingle()

      if (cancelled) return
      if (hwErr) { setError(hwErr.message); setLoading(false); return }

      setHomework((hw as TopicHomeworkRow) ?? null)
      if (!hw) {
        setFiles([]); setAttempts([]); setAttemptFiles([]); setReviews([]); setStudentNames({})
        setLoading(false)
        return
      }

      const [filesRes, attemptsRes] = await Promise.all([
        supabase.from('topic_homework_files').select('*').eq('homework_id', hw.id).order('position'),
        supabase.from('topic_homework_attempts').select('*').eq('homework_id', hw.id).order('attempt_number'),
      ])
      if (cancelled) return

      setFiles((filesRes.data ?? []) as TopicHomeworkFileRow[])
      const rows = (attemptsRes.data ?? []) as TopicHomeworkAttemptRow[]
      setAttempts(rows)

      if (rows.length === 0) {
        setAttemptFiles([]); setReviews([]); setStudentNames({}); setLoading(false)
        return
      }

      const ids = rows.map(a => a.id)
      const [afRes, revRes] = await Promise.all([
        supabase.from('topic_homework_attempt_files').select('*').in('attempt_id', ids).order('position'),
        supabase.from('topic_homework_reviews').select('*').in('attempt_id', ids).order('created_at'),
      ])
      if (cancelled) return

      setAttemptFiles((afRes.data ?? []) as TopicHomeworkAttemptFileRow[])
      setReviews((revRes.data ?? []) as TopicHomeworkReviewRow[])

      // Имена нужны только преподавателю: ученик видит в выдаче лишь себя.
      // Отдельным запросом, потому что RLS students/profiles живёт своими
      // правилами и join через PostgREST здесь только мешает.
      const studentIds = Array.from(new Set(rows.map(a => a.student_id)))
      if (studentIds.length > 0) {
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, profile_id, profiles!inner(full_name)')
          .in('id', studentIds)
        if (!cancelled) {
          const map: Record<string, string> = {}
          for (const s of (studentRows ?? []) as any[]) {
            map[s.id] = s.profiles?.full_name ?? 'Ученик'
          }
          setStudentNames(map)
        }
      } else {
        setStudentNames({})
      }

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [topicId, tick])

  // ── преподаватель ──────────────────────────────────────────

  const createHomework = useCallback(
    async (
      title: string,
      instructions: string,
      extra?: { due_at?: string | null; grade_scale?: 'five' | 'hundred' | null },
    ) => {
      if (!topicId) throw new Error('Тема не выбрана')
      if (!profile) throw new Error('Нет активного профиля')
      // Пустое название не блокирует создание — подставляем дефолт
      const clean = title.trim() || 'Домашнее задание'

      const { data, error: err } = await supabase
        .from('topic_homework')
        .insert({
          topic_id: topicId,
          title: clean,
          instructions: instructions.trim() || null,
          is_published: false,
          created_by: profile.id,
          due_at: extra?.due_at || null,
          grade_scale: extra?.grade_scale ?? null,
        })
        .select('*')
        .single()

      if (err) throw err
      setHomework(data as TopicHomeworkRow)
      return data.id as string
    },
    [topicId, profile],
  )

  const updateHomework = useCallback(
    async (patch: Partial<Pick<TopicHomeworkRow, 'title' | 'instructions' | 'is_published' | 'due_at' | 'grade_scale'>>) => {
      if (!homework) throw new Error('ДЗ ещё не создано')
      const { error: err } = await supabase.from('topic_homework').update(patch).eq('id', homework.id)
      if (err) throw err
      setHomework(prev => (prev ? { ...prev, ...patch } : prev))
    },
    [homework],
  )

  /**
   * Загружает PDF задания. `replace = true` — сначала убирает прежние файлы,
   * чтобы у ДЗ остался ровно один актуальный PDF.
   */
  const uploadHomeworkFile = useCallback(
    async (file: File, replace = true) => {
      if (!topicId) throw new Error('Тема не выбрана')
      if (!homework) throw new Error('Сначала создайте ДЗ')

      const path = buildHomeworkFilePath(topicId, file.name)
      const up = await supabase.storage
        .from(TOPIC_HOMEWORK_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)

      if (replace && files.length > 0) {
        await supabase.storage.from(TOPIC_HOMEWORK_BUCKET).remove(files.map(f => f.storage_path))
        const del = await supabase.from('topic_homework_files').delete().eq('homework_id', homework.id)
        if (del.error) throw del.error
      }

      const { data, error: err } = await supabase
        .from('topic_homework_files')
        .insert({
          homework_id: homework.id,
          storage_path: path,
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          position: 0,
        })
        .select('*')
        .single()

      if (err) throw err
      setFiles(replace ? [data as TopicHomeworkFileRow] : prevAppend(files, data as TopicHomeworkFileRow))
    },
    [topicId, homework, files],
  )

  // ── ученик ─────────────────────────────────────────────────

  /** Создаёт попытку или возвращает уже открытую: RPC идемпотентна. */
  const startAttempt = useCallback(async (): Promise<string> => {
    if (!homework) throw new Error('ДЗ не найдено')
    const { data, error: err } = await supabase.rpc('topic_homework_start_attempt', {
      p_homework_id: homework.id,
    })
    if (err) throw err
    reload()
    return data as string
  }, [homework, reload])

  const uploadAttemptFile = useCallback(async (attemptId: string, file: File) => {
    const path = buildAttemptFilePath(attemptId, file.name)
    const up = await supabase.storage
      .from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)

    const { data, error: err } = await supabase
      .from('topic_homework_attempt_files')
      .insert({
        attempt_id: attemptId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        position: 0,
      })
      .select('*')
      .single()

    if (err) throw err
    setAttemptFiles(prev => [...prev, data as TopicHomeworkAttemptFileRow])
  }, [])

  const removeAttemptFile = useCallback(async (fileId: string, storagePath: string) => {
    const { error: err } = await supabase.from('topic_homework_attempt_files').delete().eq('id', fileId)
    if (err) throw err
    await supabase.storage.from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET).remove([storagePath])
    setAttemptFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  // ── преподаватель: проверка ─────────────────────────────────

  /**
   * Вердикт по сданной попытке. Комментарий обязателен только при возврате —
   * это же условие держит CHECK `topic_homework_reviews_comment_chk` в БД.
   * Балл обязателен только при принятии, если задана шкала баллов.
   * Данные перечитываются здесь же, без перезагрузки страницы.
   */
  const reviewAttempt = useCallback(
    async (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string, score?: number | null) => {
      const { error: err } = await supabase.rpc('topic_homework_review_attempt', {
        p_attempt_id: attemptId,
        p_decision: decision,
        // не null: в сгенерированных типах параметр опционален, а в БД
        // у него DEFAULT null — семантика та же
        p_comment: comment?.trim() || undefined,
        p_score: score ?? undefined,
      })
      if (err) throw err
      reload()
    },
    [reload],
  )

  const submitAttempt = useCallback(async (attemptId: string) => {
    const { error: err } = await supabase.rpc('topic_homework_submit_attempt', { p_attempt_id: attemptId })
    if (err) throw err
    reload()
  }, [reload])

  const notifyStudents = useCallback(async (): Promise<number> => {
    if (!homework) throw new Error('ДЗ не найдено')
    const { data, error: err } = await supabase.rpc('topic_homework_notify_students', {
      p_homework_id: homework.id,
    })
    if (err) throw new Error(err.message)
    return data as number
  }, [homework])

  return {
    homework, files, attempts, attemptFiles, reviews, studentNames,
    loading, error, reload,
    createHomework, updateHomework, uploadHomeworkFile,
    startAttempt, uploadAttemptFile, removeAttemptFile, submitAttempt,
    reviewAttempt, notifyStudents,
  }
}

function prevAppend<T>(list: T[], item: T): T[] {
  return [...list, item]
}
