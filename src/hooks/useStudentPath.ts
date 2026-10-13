/**
 * §290-B. Хуки пути ученика. Главная и страница курса живут (и тестируются)
 * без QueryClientProvider — там без react-query, как useCourseAccess; ошибка
 * чтения = «нет данных», экран как раньше. Витрина «Курсы» — react-query.
 */
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchCourseDemo,
  fetchShowcase,
  fetchStudentPathHome,
  requestLaunchNotice,
  type StudentPathHome,
} from '@/lib/studentPath'

/** Анкета и подписки ученика; `enabled = false` (подписка закрыта) — не спрашиваем. */
export function useStudentPathHome(profileId: string | null | undefined, enabled: boolean) {
  const [got, setGot] = useState<{ key: string; data: StudentPathHome | null } | null>(null)
  const [tick, setTick] = useState(0)
  const key = profileId && enabled ? profileId : null
  useEffect(() => {
    if (!key) return
    let alive = true
    fetchStudentPathHome().then((d) => { if (alive) setGot({ key, data: d }) })
    return () => {
      alive = false
    }
  }, [key, tick])
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  const mine = got && got.key === key ? got : null
  return { data: mine?.data ?? null, loading: !!key && !mine, refresh }
}

/** Демо ли этот курс у ученика (подпись и кнопка на замке урока). */
export function useCourseDemo(courseId: string | null | undefined, enabled = true) {
  const [got, setGot] = useState<{ courseId: string; demo: boolean } | null>(null)
  useEffect(() => {
    if (!courseId || !enabled) return
    let alive = true
    fetchCourseDemo(courseId).then((demo) => { if (alive) setGot({ courseId, demo }) })
    return () => {
      alive = false
    }
  }, [courseId, enabled])
  return got && got.courseId === courseId ? got.demo : false
}

export function useShowcase() {
  return useQuery({ queryKey: ['subscription', 'showcase'], queryFn: fetchShowcase, staleTime: 30_000 })
}

export function useLaunchNotice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (showcaseId: string) => requestLaunchNotice(showcaseId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['subscription', 'showcase'] }) },
  })
}
