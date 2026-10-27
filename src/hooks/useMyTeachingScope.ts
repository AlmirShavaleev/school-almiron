import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useNeedsOwnDataFilter } from '@/store/staffModeStore'
import { useMyCuratorships } from '@/hooks/useMyCuratorships'
import { ownStudentId as fetchOwnStudentId } from '@/lib/ownStudent'

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
 *
 * ВТОРОЙ повод сужать появился с кураторством-назначением (2026-08-05).
 * Ученик-куратор видит по RLS ДВА непересекающихся набора: сдачи курируемого
 * курса (через `course_is_staff` → `course_curators`) И свои собственные
 * (через `student_id = auth_student_id()`). Второй набор в очередь проверки
 * попадать не должен — человек не проверяет сам себя. Отсюда `ownStudentId`.
 *
 * Настоящему преподавателю, который заодно курирует чужой курс, сужение НЕ
 * включается: RLS уже отдала ему ровно его курсы вместе с курируемым, а
 * фильтр по курируемым спрятал бы его собственные.
 */
export interface TeachingScope {
  /** Нужно ли фильтровать выдачу руками. */
  active:     boolean
  /** Готовы ли списки. Пока true — фильтровать рано. */
  loading:    boolean
  teacherId:  string | null
  courseIds:  string[]
  groupIds:   string[]
  /**
   * `students.id` самого пользователя, если он ученик. Нужен там, где список
   * «на проверку» обязан исключить собственные работы куратора.
   */
  ownStudentId: string | null
  /**
   * Человек смотрит курс КУРАТОРОМ — читает и проверяет работы, но ничего не
   * меняет. Зеркало SQL-правила `course_is_teacher_staff` для интерфейса:
   * прячет то, что база всё равно отобьёт.
   *
   * Зачем прятать, если база и так не пустит: клик-проверка владельца 05.08
   * показала, чем кончается «пусть жмёт». Тумблер тем оптимистичный, а
   * UPDATE под RLS, не найдя строк, НЕ возвращает ошибку — куратор жал,
   * плашка перекрашивалась, запись не проходила, и выглядело это как
   * работающая функция. Молчаливый отказ хуже видимого запрета.
   */
  readOnly: boolean
}

const IDLE: TeachingScope = {
  active: false, loading: false, teacherId: null, courseIds: [], groupIds: [],
  ownStudentId: null, readOnly: false,
}

/** Роли, которым RLS сузила выдачу сама — клиентское сужение им только мешает. */
function isStaffByRole(role: string | undefined): boolean {
  return role === 'teacher' || role === 'admin' || role === 'owner'
}

/**
 * Один набор «что моё» на сессию (письмо ЛК_СРОЧНО_шторм_запросов_программа_курса.md,
 * 27.10). Хук стоит и в странице, и в каждом тумблере открытости урока
 * (TopicOpenToggle): у владельца в режиме учителя программа из 36 уроков
 * давала 36 × 4 запроса (students, teachers, courses, groups) на каждое
 * перемонтирование — ~170 запросов за 2–3 минуты правки, и в эти минуты
 * очередь PostgREST тормозила всем (p95 API 13–14 с). Теперь — один общий
 * ответ на ключ «профиль · режим · курируемое». Набор за сессию почти не
 * меняется; ошибка не кэшируется.
 */
type ScopeData = Pick<TeachingScope, 'teacherId' | 'courseIds' | 'groupIds' | 'ownStudentId'>
const scopeCache = new Map<string, Promise<ScopeData>>()

export function resetTeachingScopeCache(): void { scopeCache.clear() }
;(globalThis as { __resetTeachingScopeCache?: () => void }).__resetTeachingScopeCache = resetTeachingScopeCache

async function loadScope(profileId: string, needsFilter: boolean, curated: string[]): Promise<ScopeData> {
  // Строка `students` есть у любого, кто хоть раз был учеником, — у
  // владельца её обычно нет, и null тут законный ответ.
  const ownStudentId = await fetchOwnStudentId(profileId)

  let teacherId: string | null = null
  const courseIds = new Set<string>(curated)
  const groupIds = new Set<string>()

  if (needsFilter) {
    const { data: teacher } = await supabase
      .from('teachers').select('id').eq('profile_id', profileId).maybeSingle()
    teacherId = teacher?.id ?? null

    // Свои курсы — это и те, которыми владеешь, и те, где ведёшь группу.
    // Один owner_id недостаточно: курс мог завести админ, а вести его ты.
    const [ownedRes, taughtRes] = await Promise.all([
      supabase.from('courses').select('id').eq('owner_id', profileId),
      teacherId
        ? supabase.from('groups').select('id, course_id').eq('teacher_id', teacherId)
        : Promise.resolve({ data: [] as Array<{ id: string; course_id: string | null }> }),
    ])
    for (const c of (ownedRes.data ?? []) as Array<{ id: string }>) courseIds.add(c.id)
    for (const g of (taughtRes.data ?? []) as Array<{ id: string; course_id: string | null }>) {
      groupIds.add(g.id)
      if (g.course_id) courseIds.add(g.course_id)
    }
  }

  // Группы курируемых курсов — по закону «один курс = одна группа» их
  // ровно по одной, но берём запросом, а не догадкой.
  if (curated.length > 0) {
    const { data: curatedGroups } = await supabase
      .from('groups').select('id').in('course_id', curated)
    for (const g of (curatedGroups ?? []) as Array<{ id: string }>) groupIds.add(g.id)
  }

  return { teacherId, courseIds: Array.from(courseIds), groupIds: Array.from(groupIds), ownStudentId }
}

function sharedScope(profileId: string, needsFilter: boolean, curatedKey: string): Promise<ScopeData> {
  const key = `${profileId}|${needsFilter ? 1 : 0}|${curatedKey}`
  const hit = scopeCache.get(key)
  if (hit) return hit
  const p = loadScope(profileId, needsFilter, curatedKey ? curatedKey.split(',') : [])
  p.catch(() => scopeCache.delete(key))
  scopeCache.set(key, p)
  return p
}

export function useMyTeachingScope(): TeachingScope {
  const profile = useAuthStore(s => s.profile)
  const needsFilter = useNeedsOwnDataFilter()
  const curatorships = useMyCuratorships()
  const [scope, setScope] = useState<TeachingScope>(IDLE)

  const curatedKey = curatorships.courseIds.join(',')
  // Пока неизвестно, куратор ли человек, отвечать «сужать не надо» нельзя:
  // ошибёмся — и на кадр покажем ученику-куратору чужие работы.
  const pendingCuratorCheck = !needsFilter
    && !isStaffByRole(profile?.role)
    && curatorships.loading
  const curatorMode = !needsFilter
    && !isStaffByRole(profile?.role)
    && !curatorships.loading
    && curatorships.isCurator

  useEffect(() => {
    if (!profile?.id) { setScope(IDLE); return }
    if (pendingCuratorCheck) {
      // Пока не знаем — считаем, что менять нельзя. Ошибиться в эту сторону
      // значит на кадр спрятать кнопку у преподавателя; в другую — на кадр
      // показать её куратору.
      setScope({ ...IDLE, active: true, loading: true, readOnly: true })
      return
    }
    if (!needsFilter && !curatorMode) { setScope(IDLE); return }

    let cancelled = false
    setScope({ ...IDLE, active: true, loading: true, readOnly: curatorMode })

    sharedScope(profile.id, needsFilter, curatedKey).then(data => {
      if (cancelled) return
      setScope({ active: true, loading: false, ...data, readOnly: curatorMode })
    }, () => { /* сбой — остаёмся в «грузится», как раньше при отказе запроса */ })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFilter, profile?.id, profile?.role, curatorMode, pendingCuratorCheck, curatedKey])

  // На ПЕРВОМ рендере эффект ещё не отработал, и `scope` — это IDLE с
  // `active: false`, то есть «сужать не надо». Потребитель успевал сходить в
  // базу и показать всю школу до того, как набор приедет, — курсы схлопывались
  // на следующем кадре, но чужие имена уже мелькали. Поэтому, когда сужение
  // нужно, отвечаем «активно и грузится» сразу, не дожидаясь эффекта.
  if ((needsFilter || curatorMode || pendingCuratorCheck) && !scope.active) {
    return { ...IDLE, active: true, loading: true, readOnly: curatorMode || pendingCuratorCheck }
  }

  return scope
}
