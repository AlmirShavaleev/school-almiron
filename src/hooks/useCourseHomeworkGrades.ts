import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parseHomeworkGrades, type CourseHomeworkGrades } from '@/lib/courseHomeworkJournal'
import type { LoadStatus } from './useCourseAssessments'

/**
 * §250. Журнал ДЗ курса: вкладка «Домашние задания» (таблица) и строка класса
 * во вкладке «Курс» — одна RPC на оба экрана.
 *
 * RPC `course_homework_grades` (PENDING_250) нет в сгенерированных типах —
 * отсюда `as never`, как у §241/§242/§249. Ошибка — не падение вкладки: до
 * применения миграции (или при сбое) отдаём `status: 'error'`, а решает экран
 * (во «Домашних заданиях» остаётся вид «По темам», во «Курсе» — без строки класса).
 */
export function useCourseHomeworkGrades(courseId: string | null | undefined, refreshKey = 0, enabled = true) {
  const [state, setState] = useState<{ key: string; status: LoadStatus; data: CourseHomeworkGrades | null }>({ key: '', status: 'idle', data: null })

  useEffect(() => {
    if (!courseId || !enabled) return
    let cancelled = false
    const key = `${courseId}:${refreshKey}`
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('course_homework_grades' as never, { p_course_id: courseId } as never)
        if (cancelled) return
        if (error) throw new Error(error.message)
        const parsed = parseHomeworkGrades(data)
        setState({ key, status: parsed ? 'ready' : 'error', data: parsed })
      } catch (e) {
        if (cancelled) return
        console.warn('Не удалось загрузить журнал домашних заданий', e)
        setState({ key, status: 'error', data: null })
      }
    })()
    return () => { cancelled = true }
  }, [courseId, refreshKey, enabled])

  if (!courseId || !enabled) return { status: 'idle' as LoadStatus, data: null }
  // Ответ помечен ключом запроса: другой курс — «грузится»; перечитка того же
  // курса держит прежние данные на экране, пока не придёт новый ответ.
  const mine = state.key.startsWith(`${courseId}:`) ? state : null
  return { status: mine?.status ?? 'loading', data: mine?.data ?? null }
}
