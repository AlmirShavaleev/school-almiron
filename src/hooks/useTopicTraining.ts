import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  TRAINING_TRACK,
  buildTrainingSubtopics,
  type TrainingItemRow,
  type TrainingSubtopic,
} from '@/lib/training'

// Столбцов §234 (`track`, `subtopic_*`) и таблицы `topic_subtopic_hidden` нет в
// сгенерированных типах: их перегенерирует оркестратор после применения
// PENDING_234 (руками типы не дописываем — CLAUDE.md).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- см. выше
const db = supabase as any

const TRAINING_COLUMNS =
  'id, topic_id, kind, title, storage_path, file_name, size_bytes, position, is_visible, section, subtopic_code, subtopic_title'

/**
 * Тренировка темы (§234): подтемы задачника и то, какие из них учитель скрыл
 * для этого класса.
 *
 * Единственное место, которое читает `track = 'training'`. Все прежние
 * запросы материалов смотрят только `ege` — так тренировка не попадает ни в
 * вкладки и счётчики, ни в «тема пройдена», ни в эталон ИИ-проверки.
 *
 * Ученику скрытые подтемы база не отдаёт вовсе (политика на строку); список
 * скрытых нужен персоналу — переключателю в редакторе и предпросмотру.
 */
export function useTopicTraining(topicId: string | null | undefined) {
  const profileId = useAuthStore(s => s.profile?.id ?? null)
  const [rows, setRows] = useState<TrainingItemRow[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!topicId) {
      setRows([]); setHidden([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      db.from('topic_material_items')
        .select(TRAINING_COLUMNS)
        .eq('topic_id', topicId)
        .eq('track', TRAINING_TRACK)
        .order('position', { ascending: true }),
      db.from('topic_subtopic_hidden')
        .select('subtopic_code')
        .eq('topic_id', topicId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ответы нетипизированного клиента
    ]).then(([itemsRes, hiddenRes]: any[]) => {
      if (cancelled) return
      // Ошибка чтения тренировки не должна ронять страницу темы: вкладки
      // просто не будет, остальное работает как до §234.
      if (itemsRes.error) setError(itemsRes.error.message)
      setRows((itemsRes.data ?? []) as TrainingItemRow[])
      setHidden(((hiddenRes.data ?? []) as { subtopic_code: string }[]).map(r => r.subtopic_code))
      setLoading(false)
    }, (e: unknown) => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Не удалось загрузить тренировку')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [topicId])

  const subtopics: TrainingSubtopic[] = useMemo(() => buildTrainingSubtopics(rows, hidden), [rows, hidden])

  /**
   * Скрыть/показать подтему для этого класса. Пишет `topic_subtopic_hidden`
   * (права — `course_is_staff` курса темы). Оптимистично, с откатом.
   */
  const setSubtopicHidden = useCallback(async (code: string, nextHidden: boolean) => {
    if (!topicId) return
    const previous = hidden
    setHidden(prev => nextHidden ? [...new Set([...prev, code])] : prev.filter(c => c !== code))
    const res = nextHidden
      ? await db.from('topic_subtopic_hidden').insert({ topic_id: topicId, subtopic_code: code, hidden_by: profileId })
      : await db.from('topic_subtopic_hidden').delete().eq('topic_id', topicId).eq('subtopic_code', code)
    if (res?.error) {
      setHidden(previous)
      throw new Error(res.error.message ?? 'Не удалось сохранить')
    }
  }, [topicId, hidden, profileId])

  return { subtopics, loading, error, setSubtopicHidden }
}
