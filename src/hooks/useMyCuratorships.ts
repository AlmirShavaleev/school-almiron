import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

/**
 * «Какие курсы я курирую» — по строкам `course_curators`.
 *
 * Кураторство с 2026-08-05 — назначение ПОВЕРХ аккаунта, а не роль профиля:
 * ученик 11 класса может курировать 8-й, оставаясь учеником в своих курсах.
 * Поэтому вопрос «куратор ли этот человек» нельзя задать `profile.role` —
 * ответ живёт только в таблице.
 *
 * RLS отдаёт строку `course_curators` тому, для кого `course_is_staff(course_id)`
 * истинна, — своя строка делает её истинной. Но администратору она истинна для
 * ЛЮБОГО курса, поэтому `.eq('profile_id', …)` здесь не украшение: без него
 * админ увидел бы кураторов всей школы и посчитал их своими.
 */
export interface Curatorships {
  /** Пока true — ответа ещё нет, решать «куратор или нет» рано. */
  loading:   boolean
  courseIds: string[]
  courses:   Array<{ id: string; title: string }>
  isCurator: boolean
}

const IDLE: Curatorships = { loading: false, courseIds: [], courses: [], isCurator: false }

/**
 * Ответ один на профиль, а спрашивают его сразу трое — сайдбар, сторож
 * маршрута и сужение выдачи, — причём на каждой странице. Кэш обещанием
 * сводит это к одному запросу; `reset` нужен смене аккаунта, иначе новый
 * пользователь унаследовал бы кураторство предыдущего.
 */
const cache = new Map<string, Promise<Array<{ id: string; title: string }>>>()

export function resetCuratorshipsCache(): void {
  cache.clear()
}

async function fetchCuratorships(profileId: string): Promise<Array<{ id: string; title: string }>> {
  const { data, error } = await supabase
    .from('course_curators')
    .select('course_id, courses!inner(id, title)')
    .eq('profile_id', profileId)

  if (error) {
    // Кураторство — расширение прав, а не их основа: сбой запроса не должен
    // ронять страницу. Пустой ответ означает «прав не прибавилось».
    console.error('useMyCuratorships:', error.message)
    return []
  }

  return ((data ?? []) as any[])
    .map(row => row.courses)
    .filter((c): c is { id: string; title: string } => !!c?.id)
}

export function useMyCuratorships(): Curatorships {
  const profileId = useAuthStore(s => s.profile?.id)
  // Ответ помечен профилем, для которого он получен. Без метки на ПЕРВОМ
  // рендере — до того, как отработает эффект, — хук отвечал бы «не куратор,
  // и это окончательно»: сторож маршрута успевал увести куратора на дашборд,
  // а сайдбар — нарисовать меню без кураторства. Метка же превращает этот
  // кадр в честное «ещё не знаю».
  const [state, setState] = useState<Curatorships & { forProfile: string | null }>(
    { ...IDLE, forProfile: null },
  )

  useEffect(() => {
    if (!profileId) { setState({ ...IDLE, forProfile: null }); return }

    let cancelled = false

    let promise = cache.get(profileId)
    if (!promise) {
      promise = fetchCuratorships(profileId)
      cache.set(profileId, promise)
    }

    void promise.then(courses => {
      if (cancelled) return
      setState({
        loading:    false,
        courses,
        courseIds:  courses.map(c => c.id),
        isCurator:  courses.length > 0,
        forProfile: profileId,
      })
    })

    return () => { cancelled = true }
  }, [profileId])

  if (!profileId) return IDLE
  if (state.forProfile !== profileId) return { ...IDLE, loading: true }
  return state
}
