import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useNeedsOwnDataFilter } from '@/store/staffModeStore'

/**
 * «Что моё» для владельца в режиме учителя: своя строка `teachers`, курсы, где
 * он владелец или ведёт группу, и сами эти группы.
 *
 * Зачем отдельный хук: под админской RLS база отдаёт всю школу, поэтому
 * сужение живёт в клиенте — и один и тот же набор нужен нескольким страницам
 * (программа курса, ученики, проверка ДЗ, тесты). Считать его в каждой заново
 * — это ровно тот рассинхрон копий, из-за которого случились §21 и §29.
 *
 * `active === false` означает «сужать не надо»: либо человек не в режиме
 * учителя, либо он настоящий учитель, которому всё сузила RLS. В этом случае
 * списки не заполняются и фильтровать по ним НЕЛЬЗЯ — проверяйте `active`.
 */
export interface TeachingScope {
  /** Нужно ли фильтровать выдачу руками. */
  active:     boolean
  /** Готовы ли списки. Пока true — фильтровать рано. */
  loading:    boolean
  teacherId:  string | null
  courseIds:  string[]
  groupIds:   string[]
}

const IDLE: TeachingScope = {
  active: false, loading: false, teacherId: null, courseIds: [], groupIds: [],
}

export function useMyTeachingScope(): TeachingScope {
  const profile = useAuthStore(s => s.profile)
  const needsFilter = useNeedsOwnDataFilter()
  const [scope, setScope] = useState<TeachingScope>(IDLE)

  useEffect(() => {
    if (!needsFilter || !profile?.id) {
      setScope(IDLE)
      return
    }

    let cancelled = false
    setScope({ ...IDLE, active: true, loading: true })

    async function load(profileId: string) {
      const { data: teacher } = await supabase
        .from('teachers').select('id').eq('profile_id', profileId).maybeSingle()
      const teacherId = teacher?.id ?? null

      // Свои курсы — это и те, которыми владеешь, и те, где ведёшь группу.
      // Один owner_id недостаточно: курс мог завести админ, а вести его ты.
      const [ownedRes, taughtRes] = await Promise.all([
        supabase.from('courses').select('id').eq('owner_id', profileId),
        teacherId
          ? supabase.from('groups').select('id, course_id').eq('teacher_id', teacherId)
          : Promise.resolve({ data: [] as Array<{ id: string; course_id: string | null }> }),
      ])

      if (cancelled) return

      const groups = (taughtRes.data ?? []) as Array<{ id: string; course_id: string | null }>
      const courseIds = Array.from(new Set([
        ...((ownedRes.data ?? []) as Array<{ id: string }>).map(c => c.id),
        ...groups.map(g => g.course_id).filter((x): x is string => !!x),
      ]))

      setScope({
        active:    true,
        loading:   false,
        teacherId,
        courseIds,
        groupIds:  groups.map(g => g.id),
      })
    }

    void load(profile.id)
    return () => { cancelled = true }
  }, [needsFilter, profile?.id])

  // На ПЕРВОМ рендере эффект ещё не отработал, и `scope` — это IDLE с
  // `active: false`, то есть «сужать не надо». Потребитель успевал сходить в
  // базу и показать всю школу до того, как набор приедет, — курсы схлопывались
  // на следующем кадре, но чужие имена уже мелькали. Поэтому, когда сужение
  // нужно, отвечаем «активно и грузится» сразу, не дожидаясь эффекта.
  if (needsFilter && !scope.active) return { ...IDLE, active: true, loading: true }

  return scope
}
