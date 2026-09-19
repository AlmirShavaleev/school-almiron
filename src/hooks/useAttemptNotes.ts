import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { notesFromAnnotations, type AnnotationPageRow, type ReviewNote } from '@/lib/reviewNotes'

/**
 * §209. Замечания-рамки нескольких попыток — для списков «По заданиям» вне
 * аннотатора.
 *
 * Зачем отдельное чтение. С §209 замечание живёт рамкой в `annotation_sets`,
 * а не полем `note` строки таблицы. Экран проверки берёт рамки у аннотатора —
 * он их и рисует. А ученический разбор и карточка ученика у преподавателя
 * аннотатор не поднимают: там таблица стоит прямо в карточке попытки. Без
 * этого чтения они показывали бы только легаси-`note`, то есть ученик
 * перестал бы видеть всё, что преподаватель написал после §209.
 *
 * `status`: ученику — только опубликованные (правило то же, что у самого
 * аннотатора в режиме чтения); персоналу — все, включая черновик, который он
 * сейчас и рисует. Прав тут не проверяем: RLS `annotation_sets` отдаёт ровно
 * то, что положено, и вторая проверка на клиенте была бы второй правдой.
 *
 * `supabase as any` — тем же приёмом, что в `TopicHomeworkStudent`:
 * сгенерированные типы базы отстают от прода (CLAUDE.md).
 */
export function useAttemptNotes(
  attemptIds: readonly string[],
  filePathsOf: (attemptId: string) => readonly string[],
  options?: { publishedOnly?: boolean },
): (attemptId: string) => ReviewNote[] {
  const publishedOnly = options?.publishedOnly !== false
  const key = [...attemptIds].sort().join(',')
  const [rows, setRows] = useState<(AnnotationPageRow & { attempt_id: string })[]>([])

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setRows([])
      return
    }
    let cancelled = false
    ;(async () => {
      const query = (supabase as any)
        .from('annotation_sets')
        .select('attempt_id,file_path,page,data')
        .in('attempt_id', ids)
      if (publishedOnly) query.eq('status', 'published')
      const { data } = await query
      if (cancelled) return
      setRows((data ?? []) as (AnnotationPageRow & { attempt_id: string })[])
    })()
    return () => { cancelled = true }
  }, [key, publishedOnly])

  return useMemo(() => {
    const byAttempt = new Map<string, ReviewNote[]>()
    for (const id of key ? key.split(',') : []) {
      const own = rows.filter(row => row.attempt_id === id)
      byAttempt.set(id, own.length > 0 ? notesFromAnnotations(own, filePathsOf(id)) : [])
    }
    return (attemptId: string) => byAttempt.get(attemptId) ?? []
    // filePathsOf меняется каждый рендер у вызывающих (это замыкание над
    // массивом файлов); привязываться к нему значило бы пересчитывать список
    // на каждый рендер без нужды. Состав файлов попытки не меняется, пока
    // открыт экран.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rows])
}
