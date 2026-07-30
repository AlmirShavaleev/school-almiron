import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
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
    if (!profileId || !role) { setBadges({}); return }
    let cancelled = false

    async function load() {
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
        const { count: returned } = await supabase
          .from('topic_homework_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'returned_for_revision')
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
