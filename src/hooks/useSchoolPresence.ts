import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  PRESENCE_POLL_MS, PRESENCE_TOUCH_MS, PRESENCE_WINDOW_S,
  getLastActivityAt, noteActivity, parseOnline, samePeople, shouldTouch,
  type PresencePerson,
} from '@/lib/schoolPresence'

/** Что считается действием на платформе. Только факт, без подробностей. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const

/**
 * Отметка «я на платформе».
 *
 * Вызывается ОДИН раз на приложение — компонентом `SchoolPresencePublisher`,
 * смонтированным на всё защищённое поддерево. Отметиться должны все вошедшие:
 * читает список только админ, но если ученик не отметится, показывать будет
 * нечего.
 *
 * РАНЬШЕ отметки шли только при видимой вкладке, и это было неверно: файлы,
 * ссылки и часть видео открываются в новой вкладке, так что ученик, читающий
 * конспект, пропадал из «Сейчас в школе» через 45 секунд. Панель показывала,
 * у кого вкладка на переднем плане, а не кто занимается.
 *
 * ТЕПЕРЬ — льготный период. Вкладка видна: такт 20 с. Вкладка в фоне: такт
 * 60 с, но только пока с последнего действия прошло меньше получаса. Дальше
 * молчим — вкладка, забытая на ночь, ресурсы не жжёт.
 *
 * Решение вынесено в `shouldTouch`, чтобы правило проверялось без часов.
 */
export function useSchoolPresence() {
  const profile = useAuthStore(s => s.profile)
  const profileId = profile?.id ?? null

  useEffect(() => {
    // Гость ничего не отмечает: не вошёл — не «онлайн в школе».
    if (!profileId) return

    let stopped = false
    let lastTouchAt = 0

    function sendTouch(now: number) {
      lastTouchAt = now
      // Ошибку глушим намеренно: отметка присутствия не должна мешать работе,
      // как и счётчик визитов в App.tsx. Не прошла — человек пропадёт из
      // списка по истечении окна, и это честнее, чем сломанный экран.
      void (supabase as any).rpc('school_presence_touch').then(() => {}, () => {})
    }

    function tick() {
      if (stopped) return
      const now = Date.now()
      const hidden = typeof document !== 'undefined' && document.hidden
      if (shouldTouch(now, { hidden, lastTouchAt, lastActivityAt: getLastActivityAt() })) {
        sendTouch(now)
      }
    }

    /**
     * Действие человека: клик, ввод, возвращение на вкладку.
     *
     * Слушатели глобальные и намеренно грубые — им достаточно ЗНАТЬ, что
     * человек что-то сделал. Открытие материала (ссылка с `target="_blank"`)
     * сюда попадает само: клик по ней происходит на нашей странице. Так
     * правило работает и для тех мест, которые про присутствие не знают, —
     * и ни одно из них не приходится править.
     */
    function onActivity() {
      if (stopped) return
      const now = Date.now()
      noteActivity(now)
      // Действие — повод отметиться сразу: иначе первые секунды после
      // возвращения человек числился бы ушедшим.
      sendTouch(now)
    }

    function onVisibility() {
      // Уход в фон действием НЕ считается: иначе вкладка, брошенная в фоне,
      // продлевала бы себе льготный период сама.
      if (typeof document !== 'undefined' && document.hidden) return
      onActivity()
    }

    onActivity()
    const timer = setInterval(tick, PRESENCE_TOUCH_MS)
    for (const name of ACTIVITY_EVENTS) {
      document.addEventListener(name, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopped = true
      clearInterval(timer)
      for (const name of ACTIVITY_EVENTS) document.removeEventListener(name, onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
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
