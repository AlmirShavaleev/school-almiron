import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface FeedbackNote {
  id: string
  student_id: string
  author_id: string | null
  kind: 'ai_draft' | 'saved'
  body: string
  model: string | null
  created_at: string
}

/**
 * Обратная связь по ученику: сохранённые версии преподавателя и черновик ИИ.
 *
 * Таблица версионная и без UPDATE — сохранение всегда добавляет строку.
 * Поэтому «текущий текст» = последняя `saved`, а всё, что было раньше,
 * остаётся историей мнения о человеке (требование владельца 08.08).
 *
 * Черновик ИИ живёт ОТДЕЛЬНО и в сохранённый текст сам не попадает: даже
 * нажатие «Собрать черновик» ничего не перетирает, перенос — второе,
 * осознанное действие. Молча переписать работу преподавателя нельзя.
 */
export function useStudentFeedback(studentId: string | null) {
  const profileId = useAuthStore(s => s.profile?.id ?? null)
  const [notes, setNotes] = useState<FeedbackNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setNotes([]); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load(id: string) {
      const { data, error: err } = await supabase
        .from('student_feedback_notes')
        .select('*')
        .eq('student_id', id)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setNotes((data ?? []) as FeedbackNote[])
      setLoading(false)
    }

    void load(studentId)
    return () => { cancelled = true }
  }, [studentId, tick])

  const saved = notes.filter(n => n.kind === 'saved')
  const draft = notes.find(n => n.kind === 'ai_draft') ?? null

  const save = useCallback(async (body: string) => {
    const text = body.trim()
    if (!studentId || !profileId) throw new Error('Не удалось определить автора заметки')
    if (!text) throw new Error('Пустую заметку сохранять нечего')

    // Вставка, а не обновление: политика INSERT — единственная пишущая, и
    // прошлая версия остаётся в базе физически.
    const { error: err } = await supabase.from('student_feedback_notes').insert({
      student_id: studentId,
      author_id: profileId,
      kind: 'saved',
      body: text,
    })
    if (err) throw err
    reload()
  }, [studentId, profileId, reload])

  /**
   * Пересборка черновика — только по кнопке. Функция сама проверит права
   * вызывающего его же токеном и запишет строку `ai_draft`; сюда возвращается
   * готовый текст, чтобы показать его рядом, НЕ трогая сохранённое.
   */
  const generate = useCallback(async (insights: Record<string, unknown>): Promise<string> => {
    if (!studentId) throw new Error('Ученик не выбран')
    // Цифры считает клиент — тем же `collapseToWorks`, что и очередь проверки,
    // чтобы правило «состояние работы» не жило во второй копии внутри функции.
    // Обезличивание делает `insightsForModel`, а функция проверяет состав
    // ещё раз по белому списку: граница приватности стоит с обеих сторон.
    const { data, error: err } = await supabase.functions.invoke('student-feedback-ai', {
      body: { student_id: studentId, insights },
    })
    if (err) throw err
    const text = String((data as any)?.text ?? '').trim()
    if (!text) throw new Error('Модель вернула пустой ответ')
    reload()
    return text
  }, [studentId, reload])

  return { notes, saved, current: saved[0] ?? null, draft, loading, error, reload, save, generate }
}
