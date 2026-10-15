import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchLessonHomeworkFilter, keepLessonItem } from '@/lib/lessonCourses'
import { useAuthStore } from '@/store/authStore'

/**
 * Счётчики на пунктах меню — путь -> число. Ноль/отсутствие ключа = бейдж не рисуем.
 *
 * Зачем: до этого единственным визуальным сигналом был колокольчик
 * «Уведомления», и тот был скрыт из меню (hidden), а события цикла ДЗ вообще
 * не писались в notifications — только в telegram-очередь. В итоге ни учитель
 * не видел, что пришла работа на проверку, ни ученик — что его работу
 * проверили. Уведомления починены миграцией
 * 20260730_topic_homework_in_app_notifications, а бейдж на самом пункте меню
 * нужен как «состояние», а не «событие»: он показывает, сколько сейчас ждёт
 * дела, даже если уведомление уже прочитано.
 *
 * Все запросы — count/head, без выгрузки строк, и опираются на RLS:
 * `topic_homework_attempts` видны персоналу только по своим курсам
 * (topic_homework_can_manage), ученику — только свои.
 */
export function useSidebarBadges() {
  const profile = useAuthStore(s => s.profile)
  const [badges, setBadges] = useState<Record<string, number>>({})

  const profileId = profile?.id
  const role = profile?.role

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Без входа — пустые счётчики; через await, а не синхронным setState в эффекте.
      if (!profileId || !role) { await Promise.resolve(); if (!cancelled) setBadges({}); return }
      const next: Record<string, number> = {}

      const { count: unread } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profileId!)
        .eq('read', false)
      if (unread) next['/notifications'] = unread

      if (role === 'student') {
        // Ученику — сколько работ возвращено на доработку: это единственное,
        // что требует действия ПРЯМО СЕЙЧАС и считается одним дешёвым запросом.
        // Полный список «нужно сделать» (включая ещё не начатое ДЗ) живёт на
        // самой странице — там для этого get_student_topic_journal.
        //
        // 15.10, владелец: работы «урочных» курсов (раздел «Мой курс») — только
        // открытых сейчас уроков, как на странице ДЗ (src/lib/lessonCourses.ts).
        // Поэтому не count по голове, а строки с курсом и темой: их единицы.
        const { data: returnedRows } = await supabase
          .from('topic_homework_attempts')
          .select('id, homework:topic_homework!inner(topic:topics!inner(id, module:modules!inner(course_id)))')
          .eq('status', 'returned_for_revision')
        type Row = { homework?: { topic?: { id?: string; module?: { course_id?: string } } } }
        const courseOf = (r: unknown) => (r as Row).homework?.topic?.module?.course_id ?? ''
        const topicOf = (r: unknown) => (r as Row).homework?.topic?.id ?? ''
        const rowsReturned = (returnedRows ?? []) as unknown[]
        const lesson = await fetchLessonHomeworkFilter(rowsReturned.map(courseOf))
        const returned = rowsReturned.filter(r => keepLessonItem(lesson, courseOf(r), topicOf(r))).length
        if (returned) next['/my-homework'] = returned
      } else {
        // Персоналу — сколько сданных работ ждёт вердикта по его курсам.
        const { count: awaiting } = await supabase
          .from('topic_homework_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted')
        if (awaiting) next['/homework-queue'] = awaiting
      }

      if (!cancelled) setBadges(next)
    }

    void load()
    return () => { cancelled = true }
  }, [profileId, role])

  return badges
}
