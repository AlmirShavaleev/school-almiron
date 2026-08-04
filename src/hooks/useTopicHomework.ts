import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { HOMEWORK_PHOTO_PRESET, MATERIAL_IMAGE_PRESET, compressImageFile } from '@/lib/imageCompression'
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

  // ДЗ и его файлы дублируются в ref-ах: обработчик может создать ДЗ и тут же
  // грузить в него файлы, не дожидаясь ре-рендера (иначе гонка со state).
  const homeworkRef = useRef<TopicHomeworkRow | null>(null)
  const filesRef = useRef<TopicHomeworkFileRow[]>([])

  const applyHomework = useCallback((row: TopicHomeworkRow | null) => {
    homeworkRef.current = row
    setHomework(row)
  }, [])

  const applyFiles = useCallback((rows: TopicHomeworkFileRow[]) => {
    filesRef.current = rows
    setFiles(rows)
  }, [])

  // Файлы попыток нужны обработчику загрузки только для одного: продолжить
  // нумерацию страниц, а не начать её заново. Держим в ref, чтобы не
  // пересоздавать колбэк на каждую пришедшую строку.
  const attemptFilesRef = useRef<TopicHomeworkAttemptFileRow[]>([])
  useEffect(() => { attemptFilesRef.current = attemptFiles }, [attemptFiles])

  useEffect(() => {
    if (!topicId) {
      applyHomework(null); applyFiles([]); setAttempts([]); setAttemptFiles([]); setReviews([]); setStudentNames({})
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

      applyHomework((hw as TopicHomeworkRow) ?? null)
      if (!hw) {
        applyFiles([]); setAttempts([]); setAttemptFiles([]); setReviews([]); setStudentNames({})
        setLoading(false)
        return
      }

      const [filesRes, attemptsRes] = await Promise.all([
        supabase.from('topic_homework_files').select('*').eq('homework_id', hw.id).order('position'),
        supabase.from('topic_homework_attempts').select('*').eq('homework_id', hw.id).order('attempt_number'),
      ])
      if (cancelled) return

      applyFiles((filesRes.data ?? []) as TopicHomeworkFileRow[])
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
  }, [topicId, tick, applyHomework, applyFiles])

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
      // Пишем и в ref: следующий шаг того же обработчика (загрузка файла,
      // сохранение дедлайна) не должен ждать ре-рендера.
      applyHomework(data as TopicHomeworkRow)
      applyFiles([])
      return data.id as string
    },
    [topicId, profile, applyHomework, applyFiles],
  )

  const updateHomework = useCallback(
    async (patch: Partial<Pick<TopicHomeworkRow, 'title' | 'instructions' | 'is_published' | 'due_at' | 'grade_scale'>>) => {
      const current = homeworkRef.current
      if (!current) throw new Error('ДЗ ещё не создано')
      const { error: err } = await supabase.from('topic_homework').update(patch).eq('id', current.id)
      if (err) throw err
      applyHomework({ ...current, ...patch })
    },
    [applyHomework],
  )

  /**
   * Добавляет файл задания: PDF или картинку. Файлы не заменяют друг друга —
   * их может быть сколько угодно, порядок задаёт `position`.
   *
   * Грузим через signed URL и XHR: только так можно показать прогресс.
   * Если подписать URL не удалось — обычная загрузка, но уже без процентов.
   */
  const uploadHomeworkFile = useCallback(
    async (file: File, onProgress?: (percent: number) => void) => {
      if (!topicId) throw new Error('Тема не выбрана')
      const current = homeworkRef.current
      if (!current) throw new Error('Сначала создайте ДЗ')

      // Пережимаем ДО построения пути: имя и расширение должны описывать то,
      // что реально ляжет в Storage. PDF проходит насквозь нетронутым.
      const upload = await compressImageFile(file, MATERIAL_IMAGE_PRESET)
      const path = buildHomeworkFilePath(topicId, upload.name)

      const { data: signed, error: signErr } = await supabase.storage
        .from(TOPIC_HOMEWORK_BUCKET)
        .createSignedUploadUrl(path)

      if (signErr || !signed) {
        // Фолбэк: обычная загрузка без прогресса
        const up = await supabase.storage
          .from(TOPIC_HOMEWORK_BUCKET)
          .upload(path, upload, { contentType: upload.type, upsert: false })
        if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)
      } else {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', signed.signedUrl)
          xhr.setRequestHeader('content-type', upload.type || 'application/octet-stream')
          xhr.setRequestHeader('x-upsert', 'false')
          xhr.upload.onprogress = e => {
            if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
          }
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
            ? resolve()
            : reject(new Error('Ошибка загрузки: HTTP ' + xhr.status))
          xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
          xhr.send(upload)
        })
        onProgress?.(100)
      }

      const { data, error: err } = await supabase
        .from('topic_homework_files')
        .insert({
          homework_id: current.id,
          storage_path: path,
          original_filename: upload.name,
          mime_type: upload.type,
          size_bytes: upload.size,
          position: filesRef.current.length,
        })
        .select('*')
        .single()

      if (err) throw err
      applyFiles(prevAppend(filesRef.current, data as TopicHomeworkFileRow))
    },
    [topicId, applyFiles],
  )

  /** Убирает файл задания: сначала объект в Storage, затем строку в БД. */
  const deleteHomeworkFile = useCallback(
    async (fileId: string) => {
      const target = filesRef.current.find(f => f.id === fileId)
      if (!target) return

      await supabase.storage.from(TOPIC_HOMEWORK_BUCKET).remove([target.storage_path])

      const { error: err } = await supabase.from('topic_homework_files').delete().eq('id', fileId)
      if (err) throw err

      applyFiles(filesRef.current.filter(f => f.id !== fileId))
    },
    [applyFiles],
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

  /**
   * Сдача работы: несколько файлов за раз, с процентами по каждому.
   *
   * Файлы идут по очереди, а не параллельно. Ученик обычно сдаёт с телефона,
   * и пять одновременных отправок на слабом канале мешают друг другу и врут
   * в прогрессе; последовательная очередь честнее и предсказуемее.
   *
   * `onProgress(index, percent)` — индекс в переданном массиве, чтобы
   * интерфейс мог показать имя файла рядом с его процентом.
   */
  const uploadAttemptFiles = useCallback(
    async (
      attemptId: string,
      incoming: File[],
      onProgress?: (index: number, percent: number) => void,
    ): Promise<TopicHomeworkAttemptFileRow[]> => {
      if (incoming.length === 0) return []

      // Позиции продолжают уже приложенные страницы этой попытки. Раньше
      // здесь стоял жёсткий 0: при доклад­ывании файлов порядок в проверке
      // разъезжался, и рамки ИИ ложились не на ту страницу.
      const basePosition = attemptFilesRef.current.filter(f => f.attempt_id === attemptId).length
      const inserted: TopicHomeworkAttemptFileRow[] = []

      for (let i = 0; i < incoming.length; i++) {
        onProgress?.(i, 0)

        // Пережимаем ДО построения пути: имя и расширение должны описывать
        // то, что реально ляжет в Storage.
        const upload = await compressImageFile(incoming[i], HOMEWORK_PHOTO_PRESET)
        const path = buildAttemptFilePath(attemptId, upload.name)

        const { data: signed, error: signErr } = await supabase.storage
          .from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET)
          .createSignedUploadUrl(path)

        if (signErr || !signed) {
          // Фолбэк: обычная загрузка, но уже без процентов.
          const up = await supabase.storage
            .from(TOPIC_HOMEWORK_ATTEMPTS_BUCKET)
            .upload(path, upload, { contentType: upload.type, upsert: false })
          if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)
        } else {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('PUT', signed.signedUrl)
            xhr.setRequestHeader('content-type', upload.type || 'application/octet-stream')
            xhr.setRequestHeader('x-upsert', 'false')
            xhr.upload.onprogress = e => {
              if (e.lengthComputable && onProgress) onProgress(i, Math.round((e.loaded / e.total) * 100))
            }
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
              ? resolve()
              : reject(new Error('Ошибка загрузки: HTTP ' + xhr.status))
            xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
            xhr.send(upload)
          })
        }
        onProgress?.(i, 100)

        const { data, error: err } = await supabase
          .from('topic_homework_attempt_files')
          .insert({
            attempt_id: attemptId,
            storage_path: path,
            file_name: upload.name,
            mime_type: upload.type,
            size_bytes: upload.size,
            position: basePosition + i,
          })
          .select('*')
          .single()

        if (err) throw err
        const row = data as TopicHomeworkAttemptFileRow
        inserted.push(row)
        setAttemptFiles(prev => [...prev, row])
      }

      return inserted
    },
    [],
  )

  /** Один файл — тот же путь, что и у нескольких. Оставлен для старых вызовов. */
  const uploadAttemptFile = useCallback(
    async (attemptId: string, file: File) => { await uploadAttemptFiles(attemptId, [file]) },
    [uploadAttemptFiles],
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

  /**
   * Оповещение в Telegram. Без аргумента — всем привязанным, как раньше;
   * со списком — точечно. Возвращает, сколько строк реально встало в очередь:
   * ученик без привязки и ученик с ещё не ушедшим оповещением не считаются.
   */
  const notifyStudents = useCallback(async (profileIds?: string[]): Promise<number> => {
    const current = homeworkRef.current
    if (!current) throw new Error('ДЗ не найдено')
    const { data, error: err } = await supabase.rpc('topic_homework_notify_students', {
      p_homework_id: current.id,
      // не null: в сгенерированных типах параметр опционален, а в БД
      // у него DEFAULT null — семантика та же (см. reviewAttempt выше)
      p_profile_ids: profileIds ?? undefined,
    })
    if (err) throw new Error(err.message)
    return data as number
  }, [])

  /**
   * Ученики курса с отметкой о привязке Telegram. Через definer-RPC: политики
   * telegram_connections пускают преподавателя только к своей строке, и функция
   * отдаёт ровно boolean, без chat_id.
   */
  const loadNotifyTargets = useCallback(async (): Promise<NotifyTarget[]> => {
    const current = homeworkRef.current
    if (!current) return []
    const { data, error: err } = await supabase.rpc('topic_homework_notify_targets', {
      p_homework_id: current.id,
    })
    if (err) throw new Error(err.message)
    return (data ?? []) as NotifyTarget[]
  }, [])

  return {
    homework, files, attempts, attemptFiles, reviews, studentNames,
    loading, error, reload,
    createHomework, updateHomework, uploadHomeworkFile, deleteHomeworkFile,
    startAttempt, uploadAttemptFiles, uploadAttemptFile, removeAttemptFile, submitAttempt,
    reviewAttempt, notifyStudents, loadNotifyTargets,
  }
}

/** Строка списка получателей оповещения. Никаких данных самой связки с ТГ. */
export interface NotifyTarget {
  profile_id: string
  full_name: string
  telegram_linked: boolean
  /** Оповещение уже в очереди и ещё не ушло. */
  pending: boolean
}

function prevAppend<T>(list: T[], item: T): T[] {
  return [...list, item]
}
