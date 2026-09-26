import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadToStorage } from '@/lib/storageUpload'
import { compressImageFile, HOMEWORK_PHOTO_PRESET } from '@/lib/imageCompression'
import { splitHomeworkFiles, type RejectedHomeworkFile } from '@/lib/topicHomework'
import {
  MOCK_EXAMS_BUCKET, clockOffset, mockPhotoPath,
  type MockLessonPhoto, type MockLessonResult, type MockLessonState,
} from '@/lib/mockExamLesson'

/**
 * §221. Пробник глазами ученика: окно, бланк, фото, результат.
 *
 * Всё, что зависит от времени, решает база (`save_mock_exam_answer`,
 * `submit_mock_exam`, `add_mock_exam_photo` сверяют окно по своему now()).
 * Хук держит только смещение часов устройства от часов базы — для таймера.
 *
 * Функций нет в сгенерированных типах (миграция не применена, типы руками не
 * дописываем — CLAUDE.md), поэтому RPC — через узкий вид клиента, как в §218.
 */

type RpcResp<T> = Promise<{ data: T | null; error: { message?: string; code?: string } | null }>
interface RpcLike { rpc<T = unknown>(fn: string, args: Record<string, unknown>): RpcResp<T> }
const db = supabase as unknown as RpcLike

export interface PhotoUploadProgress { name: string; percent: number }

export function useMockExamLesson(examId: string | undefined) {
  const [state, setState] = useState<MockLessonState | null>(null)
  const [result, setResult] = useState<MockLessonResult | null>(null)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const stateRef = useRef<MockLessonState | null>(null)
  stateRef.current = state

  useEffect(() => {
    if (!examId) return
    let cancelled = false
    ;(async () => {
      setError(null)
      const { data, error: err } = await db.rpc<MockLessonState>('my_mock_exam', { p_mock_exam_id: examId })
      if (cancelled) return
      if (err || !data) {
        setError(err?.message || 'Пробник не найден')
        setLoading(false)
        return
      }
      setOffset(clockOffset(data.server_now, Date.now()))
      setState({ ...data, answers: data.answers ?? [], photos: data.photos ?? [] })
      // Результат — отдельной функцией: до «Уведомить» она отдаёт только
      // { status: 'pending' }, и ни баллов, ни ключа, ни решения здесь нет.
      if (data.notified) {
        const { data: r } = await db.rpc<MockLessonResult>('my_mock_exam_result', { p_mock_exam_id: examId })
        if (cancelled) return
        setResult(r ?? { status: 'pending' })
      } else {
        setResult({ status: 'pending' })
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [examId, tick])

  const reload = useCallback(() => setTick(t => t + 1), [])

  /** Один ответ бланка. Ответ базы — только поле и время записи. */
  const saveAnswer = useCallback(async (task: number, value: string): Promise<{ savedAt: string | null; error: string | null }> => {
    if (!examId) return { savedAt: null, error: 'Пробник не загружен' }
    const { data, error: err } = await db.rpc<{ task: number; answer: string | null; saved_at: string }>('save_mock_exam_answer', {
      p_mock_exam_id: examId, p_task: task, p_answer: value,
    })
    if (err) return { savedAt: null, error: err.message || 'Не сохранилось' }
    setState(prev => {
      if (!prev) return prev
      const answers = prev.answers.slice()
      while (answers.length < task) answers.push(null)
      answers[task - 1] = data?.answer ?? null
      return { ...prev, answers, updated_at: data?.saved_at ?? prev.updated_at }
    })
    return { savedAt: data?.saved_at ?? null, error: null }
  }, [examId])

  const submit = useCallback(async (): Promise<{ error: string | null }> => {
    if (!examId) return { error: 'Пробник не загружен' }
    const { data, error: err } = await db.rpc<{ submitted_at: string }>('submit_mock_exam', { p_mock_exam_id: examId })
    if (err) return { error: err.message || 'Не удалось сдать' }
    setState(prev => (prev ? { ...prev, submitted_at: data?.submitted_at ?? new Date().toISOString() } : prev))
    return { error: null }
  }, [examId])

  /**
   * Фото второй части. Отбор по формату — тот же, что у домашки
   * (`splitHomeworkFiles`: `.dng` и прочий RAW отклоняются с подсказкой),
   * сжатие — тот же пресет, загрузка — общий `uploadToStorage`. Своего здесь
   * только путь в бакете и регистрация фото в базе, которая сверяет окно.
   */
  const uploadPhotos = useCallback(async (
    files: File[],
    onProgress?: (p: PhotoUploadProgress[]) => void,
  ): Promise<{ rejected: RejectedHomeworkFile[]; error: string | null }> => {
    const st = stateRef.current
    if (!examId || !st) return { rejected: [], error: 'Пробник не загружен' }
    const { accepted, rejected } = splitHomeworkFiles(files)
    if (accepted.length === 0) return { rejected, error: null }
    const studentId = st.student_id

    const progress = accepted.map(f => ({ name: f.name, percent: 0 }))
    onProgress?.(progress.slice())
    try {
      for (let i = 0; i < accepted.length; i++) {
        const upload = await compressImageFile(accepted[i], HOMEWORK_PHOTO_PRESET)
        const path = mockPhotoPath(examId, studentId, upload.name)
        await uploadToStorage(MOCK_EXAMS_BUCKET, path, upload, p => {
          progress[i] = { ...progress[i], percent: p }
          onProgress?.(progress.slice())
        })
        const { data, error: err } = await db.rpc<MockLessonPhoto>('add_mock_exam_photo', {
          p_mock_exam_id: examId,
          p_storage_path: path,
          p_file_name: upload.name,
          p_mime_type: upload.type,
          p_size_bytes: upload.size,
        })
        if (err || !data) {
          // Файл лёг, а база его не приняла (например, время вышло между
          // загрузкой и регистрацией) — убираем за собой, чтобы не висел.
          await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([path])
          throw new Error(err?.message || 'Фото не принято')
        }
        progress[i] = { ...progress[i], percent: 100 }
        onProgress?.(progress.slice())
        setState(prev => (prev ? { ...prev, photos: [...prev.photos, data] } : prev))
      }
    } catch (e) {
      return { rejected, error: e instanceof Error ? e.message : 'Не удалось загрузить фото' }
    } finally {
      onProgress?.([])
    }
    return { rejected, error: null }
  }, [examId])

  const removePhoto = useCallback(async (photo: MockLessonPhoto): Promise<{ error: string | null }> => {
    const { data: path, error: err } = await db.rpc<string>('remove_mock_exam_photo', { p_photo_id: photo.id })
    if (err) return { error: err.message || 'Не удалось убрать фото' }
    await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([path ?? photo.storage_path])
    setState(prev => (prev ? { ...prev, photos: prev.photos.filter(p => p.id !== photo.id) } : prev))
    return { error: null }
  }, [])

  return { state, result, offset, loading, error, reload, saveAnswer, submit, uploadPhotos, removePhoto }
}

/** §224. Как часто страница пробника отмечается «я здесь». База пишет не чаще раза в 10 с. */
export const MOCK_PING_MS = 30_000

/**
 * §224. «Я на странице пробника» — для монитора преподавателя. Пинг при
 * открытии и раз в 30 с, только пока вкладка видима и окно открыто (по часам
 * базы: `offset` — смещение часов устройства). После конца окна — тишина.
 * Первый пинг заводит бланк с отметкой «открыл» (`mock_exam_ping`), ответы
 * он не трогает. Ошибку глотаем: до применения PENDING_224.sql функции нет, а
 * пробник от этого писаться не должен перестать.
 */
export function useMockExamPing(
  examId: string | undefined,
  lessonWindow: { starts_at: string | null; ends_at: string | null } | null,
  offset: number,
) {
  const startsAt = lessonWindow?.starts_at ?? null
  const endsAt = lessonWindow?.ends_at ?? null
  useEffect(() => {
    if (!examId || !startsAt || !endsAt) return
    const starts = new Date(startsAt).getTime()
    const ends = new Date(endsAt).getTime()
    const inWindow = () => {
      const now = Date.now() + offset
      return now >= starts && now < ends
    }
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    // Интервал, отметка на старте и возврат на вкладку могут сойтись в одну
    // секунду — второй раз не зовём (база всё равно пишет не чаще раза в 10 с).
    let last = -Infinity
    const ping = () => {
      if (!visible() || !inWindow()) return
      if (Date.now() - last < 10_000) return
      last = Date.now()
      void Promise.resolve(db.rpc('mock_exam_ping', { p_mock_exam_id: examId })).catch(() => { /* монитор подождёт */ })
    }
    ping()
    const id = setInterval(ping, MOCK_PING_MS)
    const onVis = () => { if (visible()) ping() }
    document.addEventListener('visibilitychange', onVis)
    // Окно открылось, пока страница стояла на отсчёте, — отметиться сразу,
    // не ждать очередные 30 секунд.
    const untilStart = starts - (Date.now() + offset)
    const startTimer = untilStart > 0 && untilStart < 24 * 3600_000 ? setTimeout(ping, untilStart + 500) : null
    return () => {
      clearInterval(id)
      if (startTimer) clearTimeout(startTimer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [examId, startsAt, endsAt, offset])
}
