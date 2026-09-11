import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  PRESENCE_POLL_MS, PRESENCE_TOUCH_MS, PRESENCE_WINDOW_S,
  parseOnline, samePeople, type PresencePerson,
} from '@/lib/schoolPresence'

/**
 * Отметка «я на платформе».
 *
 * Вызывается ОДИН раз на приложение — компонентом `SchoolPresencePublisher`,
 * смонтированным на всё защищённое поддерево. Отметиться должны все вошедшие:
 * читает список только админ, но если ученик не отметится, показывать будет
 * нечего.
 *
 * Отметки идут ТОЛЬКО при видимой вкладке. Во-первых, требование «вкладка в
 * фоне не жжёт ресурсы»; во-вторых, человек с двадцатью фоновыми вкладками не
 * должен считаться присутствующим в школе больше остальных.
 *
 * Канала здесь больше нет — почему, написано в `@/lib/schoolPresence`.
 */
export function useSchoolPresence() {
  const profile = useAuthStore(s => s.profile)
  const profileId = profile?.id ?? null

  useEffect(() => {
    // Гость ничего не отмечает: не вошёл — не «онлайн в школе».
    if (!profileId) return

    let stopped = false

    function touch() {
      if (stopped) return
      if (typeof document !== 'undefined' && document.hidden) return
      // Ошибку глушим намеренно: отметка присутствия не должна мешать работе,
      // как и счётчик визитов в App.tsx. Не прошла — человек пропадёт из
      // списка через 45 секунд, и это честнее, чем сломанный экран.
      void (supabase as any).rpc('school_presence_touch').then(() => {}, () => {})
    }

    touch()
    const timer = setInterval(touch, PRESENCE_TOUCH_MS)
    // Вернулись на вкладку — отмечаемся сразу, не дожидаясь такта: иначе после
    // фона человек до двадцати секунд числился бы ушедшим.
    document.addEventListener('visibilitychange', touch)

    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', touch)
    }
  }, [profileId])
}

/**
 * Кто сейчас на платформе — для панели админа.
 *
 * Опрос раз в 15 секунд, и только при видимой вкладке. Подписки на таблицу
 * НЕТ намеренно: при отметке раз в 20 секунд на каждого она дала бы поток
 * событий ради числа, которое и так обновляется опросом.
 *
 * `ok` отличает «никого нет» от «список не прочитался»: оба состояния выглядят
 * пустым списком, и молчание тут соврало бы.
 */
export function useOnlinePeople(): { people: PresencePerson[]; ok: boolean } {
  const [people, setPeople] = useState<PresencePerson[]>([])
  const [ok, setOk] = useState(false)
  // Держим последний состав в ref, чтобы сравнивать без перезапуска эффекта.
  const peopleRef = useRef<PresencePerson[]>([])

  useEffect(() => {
    let stopped = false

    async function load() {
      if (stopped) return
      if (typeof document !== 'undefined' && document.hidden) return

      const { data, error } = await (supabase as any)
        .rpc('school_presence_online', { p_seconds: PRESENCE_WINDOW_S })
      if (stopped) return

      if (error) {
        // Отказ — это не «никого нет». Экран разводит эти состояния словами.
        setOk(false)
        return
      }

      const next = parseOnline(data)
      setOk(true)
      // Тот же состав — не трогаем состояние: у людей меняется только
      // `seen_at`, а он на экран не идёт, и перерисовка была бы холостой.
      if (!samePeople(next, peopleRef.current)) {
        peopleRef.current = next
        setPeople(next)
      }
    }

    void load()
    const timer = setInterval(() => { void load() }, PRESENCE_POLL_MS)
    // Вернулись на вкладку — обновляем сразу: за время в фоне список устарел.
    const onVisible = () => { void load() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return { people, ok }
}
