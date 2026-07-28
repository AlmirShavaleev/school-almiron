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
  /**
   * Сколько учеников курса реально получат Telegram-оповещение.
   * Считается для подписи кнопки; сам отбор получателей делает RPC на сервере,
   * это число — только подсказка преподавателю.
   */
  const [notifyRecipientCount, setNotifyRecipientCount] = useState<number | null>(null)

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

  // Количество получателей Telegram-оповещения. Отдельным эффектом: ученику
  // эти таблицы не отдаст RLS, и это нормально — тогда просто нет подсказки.
  useEffect(() => {
    if (!topicId) { setNotifyRecipientCount(null); return }
    let cancelled = false

    async function countRecipients() {
      const { data: topicRow } = await supabase
        .from('topics')
        .select('modules(course_id)')
        .eq('id', topicId!)
        .maybeSingle()
      const courseId = (topicRow as any)?.modules?.course_id as string | undefined
      if (cancelled || !courseId) { if (!cancelled) setNotifyRecipientCount(null); return }

      const { data: roster } = await supabase
        .from('group_students')
        .select('students!inner(profile_id), groups!inner(course_id)')
        .eq('groups.course_id', courseId)
      if (cancelled) return

      const profileIds = Array.from(
        new Set(((roster ?? []) as any[]).map(r => r.students?.profile_id).filter(Boolean)),
      ) as string[]
      if (profileIds.length === 0) { setNotifyRecipientCount(0); return }

      const { data: connections, error: connErr } = await supabase
        .from('telegram_connections')
        .select('profile_id, is_enabled')
        .in('profile_id', profileIds)
      if (cancelled) return
      if (connErr) { setNotifyRecipientCount(null); return }

      setNotifyRecipientCount(((connections ?? []) as any[]).filter(c => c.is_enabled).length)
    }

    countRecipients()
    return () => { cancelled = true }
  }, [topicId])

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

  /**
   * Ленивое создание: ДЗ появляется в базе в момент первого осмысленного
   * действия (загрузили файл, поставили дедлайн), а не по отдельной кнопке
   * «Создать». Идемпотентна — если ДЗ уже есть, просто возвращает его.
   *
   * Название и инструкция из интерфейса убраны: у темы одно ДЗ, и заголовок
   * «Домашнее задание» ничего не добавлял. Колонка `title` NOT NULL, поэтому
   * дефолт подставляется здесь.
   */
  const ensureHomework = useCallback(async (): Promise<TopicHomeworkRow> => {
    if (homework) return homework
    if (!topicId) throw new Error('Тема не выбрана')
    if (!profile) throw new Error('Нет активного профиля')

    // Гонка двух вкладок: UNIQUE(topic_id) отдаст 23505 — тогда перечитываем.
    const { data, error: err } = await supabase
      .from('topic_homework')
      .insert({
        topic_id: topicId,
        title: 'Домашнее задание',
        instructions: null,
        is_published: false,
        created_by: profile.id,
      })
      .select('*')
      .single()

    if (err) {
      if ((err as { code?: string }).code === '23505') {
        const { data: existing } = await supabase
          .from('topic_homework')
          .select('*')
          .eq('topic_id', topicId)
          .single()
        if (existing) {
          setHomework(existing as TopicHomeworkRow)
          return existing as TopicHomeworkRow
        }
      }
      throw err
    }

    setHomework(data as TopicHomeworkRow)
    return data as TopicHomeworkRow
  }, [homework, topicId, profile])

  const updateHomework = useCallback(
    async (patch: Partial<Pick<TopicHomeworkRow, 'title' | 'instructions' | 'is_published' | 'due_at' | 'grade_scale'>>) => {
      // Ленивое создание: правка дедлайна или шкалы сама заводит ДЗ, если его ещё нет.
      const hw = homework ?? (await ensureHomework())
      const { error: err } = await supabase.from('topic_homework').update(patch).eq('id', hw.id)
      if (err) throw err
      setHomework(prev => (prev ? { ...prev, ...patch } : { ...hw, ...patch }))
    },
    [homework, ensureHomework],
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

  /**
   * Мультизагрузка файлов задания (PDF и картинки) с прогрессом.
   *
   * Файлы НЕ заменяют друг друга — у ДЗ может быть несколько вложений.
   * Прогресс берётся через signed upload URL + XHR: у supabase-js нет
   * колбэка прогресса, тот же приём уже используется в материалах темы.
   * Загрузка последовательная — так прогресс честный, а не «всё сразу 100 %».
   */
  const uploadHomeworkFiles = useCallback(
    async (
      list: File[],
      onProgress?: (index: number, percent: number) => void,
    ): Promise<TopicHomeworkFileRow[]> => {
      if (!topicId) throw new Error('Тема не выбрана')
      if (list.length === 0) return []

      const hw = homework ?? (await ensureHomework())
      let position = files.reduce((max, f) => Math.max(max, f.position), -1) + 1
      const created: TopicHomeworkFileRow[] = []

      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        const path = buildHomeworkFilePath(topicId, file.name)

        const { data: signed, error: signErr } = await supabase.storage
          .from(TOPIC_HOMEWORK_BUCKET)
          .createSignedUploadUrl(path)

        if (signErr || !signed) {
          // Фолбэк без прогресса — лучше загрузить молча, чем не загрузить.
          const up = await supabase.storage
            .from(TOPIC_HOMEWORK_BUCKET)
            .upload(path, file, { contentType: file.type, upsert: false })
          if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)
        } else {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('PUT', signed.signedUrl)
            xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
            xhr.setRequestHeader('x-upsert', 'false')
            xhr.upload.onprogress = e => {
              if (e.lengthComputable) onProgress?.(i, Math.round((e.loaded / e.total) * 100))
            }
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
              ? resolve()
              : reject(new Error('Ошибка загрузки: HTTP ' + xhr.status))
            xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
            xhr.send(file)
          })
        }
        onProgress?.(i, 100)

        const { data, error: err } = await supabase
          .from('topic_homework_files')
          .insert({
            homework_id: hw.id,
            storage_path: path,
            original_filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            position: position++,
          })
          .select('*')
          .single()

        if (err) {
          // Строка не создалась — не оставляем осиротевший объект в бакете.
          await supabase.storage.from(TOPIC_HOMEWORK_BUCKET).remove([path])
          throw err
        }
        created.push(data as TopicHomeworkFileRow)
      }

      setFiles(prev => [...prev, ...created])
      return created
    },
    [topicId, homework, files, ensureHomework],
  )

  /** Убирает файл задания: сначала строку (её держит RLS), потом объект в бакете. */
  const removeHomeworkFile = useCallback(async (fileId: string, storagePath: string) => {
    const { error: err } = await supabase.from('topic_homework_files').delete().eq('id', fileId)
    if (err) throw err
    await supabase.storage.from(TOPIC_HOMEWORK_BUCKET).remove([storagePath])
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

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

  /**
   * Мультизагрузка файлов сдачи (несколько фото работы или PDF) с прогрессом.
   *
   * Тот же приём, что и uploadHomeworkFiles на стороне преподавателя: signed
   * upload URL + XHR, потому что у supabase-js нет колбэка прогресса.
   * Загрузка последовательная — прогресс честный, а не «всё сразу 100%», и
   * это даёт ученику реальный индикатор во время сдачи, а не молчание до
   * завершения. Позиции продолжают уже загруженные файлы этой попытки —
   * повторное открытие «Добавить файл» не затирает порядок.
   */
  const uploadAttemptFiles = useCallback(
    async (
      attemptId: string,
      list: File[],
      onProgress?: (index: number, percent: number) => void,
    ): Promise<TopicHomeworkAttemptFileRow[]> => {
      if (list.length === 0) return []

      let position = attemptFiles
        .filter(f => f.attempt_id === attemptId)
        .reduce((max, f) => Math.max(max, f.position), -1) + 1
      const created: TopicHomeworkAttemptFileRow[] = []

      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        const path = buildAttemptFilePath(attemptId, file.name)

        const { data: signed, error: signErr } = await supabase.storage
          .from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET)
          .createSignedUploadUrl(path)

        if (signErr || !signed) {
          // Фолбэк без прогресса — лучше загрузить молча, чем не загрузить.
          const up = await supabase.storage
            .from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET)
            .upload(path, file, { contentType: file.type, upsert: false })
          if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)
        } else {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('PUT', signed.signedUrl)
            xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
            xhr.setRequestHeader('x-upsert', 'false')
            xhr.upload.onprogress = e => {
              if (e.lengthComputable) onProgress?.(i, Math.round((e.loaded / e.total) * 100))
            }
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
              ? resolve()
              : reject(new Error('Ошибка загрузки: HTTP ' + xhr.status))
            xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
            xhr.send(file)
          })
        }
        onProgress?.(i, 100)

        const { data, error: err } = await supabase
          .from('topic_homework_attempt_files')
          .insert({
            attempt_id: attemptId,
            storage_path: path,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            position: position++,
          })
          .select('*')
          .single()

        if (err) {
          // Строка не создалась — не оставляем осиротевший объект в бакете.
          await supabase.storage.from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET).remove([path])
          throw err
        }
        created.push(data as TopicHomeworkAttemptFileRow)
      }

      setAttemptFiles(prev => [...prev, ...created])
      return created
    },
    [attemptFiles],
  )

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
    createHomework, ensureHomework, updateHomework,
    uploadHomeworkFile, uploadHomeworkFiles, removeHomeworkFile,
    startAttempt, uploadAttemptFiles, removeAttemptFile, submitAttempt,
    reviewAttempt, notifyStudents, notifyRecipientCount,
  }
}

function prevAppend<T>(list: T[], item: T): T[] {
  return [...list, item]
}
