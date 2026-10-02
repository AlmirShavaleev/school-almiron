import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * §255. Цель ЕГЭ, которую ученик поставил себе САМ (главная, «Примерный балл»),
 * — для карточки ученика у учителя. Таблица `student_exam_goals`: читать её
 * может сам ученик, админ и персонал курса ученика (RLS через
 * `auth_is_staff_of_student` → `course_is_staff`); пишет только ученик функцией
 * `set_my_exam_goal`. Учительская цель (§216) — отдельно, её не трогаем.
 *
 * Ошибка (в том числе «таблицы нет», пока миграция не применена) — пустой
 * список: карточка учителя живёт как раньше.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface StudentExamGoal {
  subject: string
  goal: number
  updated_at: string | null
}

export function useStudentExamGoals(profileId: string | null | undefined) {
  const [goals, setGoals] = useState<StudentExamGoal[]>([])

  useEffect(() => {
    if (!profileId) { setGoals([]); return }
    let cancelled = false
    Promise.resolve(
      db.from('student_exam_goals').select('subject, goal, updated_at').eq('profile_id', profileId),
    ).then(({ data, error }: { data: StudentExamGoal[] | null; error: unknown }) => {
      if (!cancelled) setGoals(error ? [] : data ?? [])
    }, () => { if (!cancelled) setGoals([]) })
    return () => { cancelled = true }
  }, [profileId])

  return goals
}
