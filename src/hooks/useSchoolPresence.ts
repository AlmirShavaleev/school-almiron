import { useEffect, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/store/authStore'
import {
  acquirePresence,
  getPresenceConnected,
  getPresenceSnapshot,
  subscribePresence,
  type PresencePerson,
} from '@/lib/schoolPresence'

/**
 * Публикация собственного присутствия.
 *
 * Вызывается ОДИН раз на приложение — компонентом `SchoolPresencePublisher`.
 * Отправляет только `profileId` и роль: имени в канале нет намеренно (решение
 * владельца), его подставляет экран.
 *
 * Ничего не возвращает: читать присутствие — дело `useOnlinePeople`, и
 * разделены они потому, что публикует КАЖДЫЙ вошедший, а читает только админ.
 */
export function useSchoolPresence() {
  const profile = useAuthStore(s => s.profile)
  const profileId = profile?.id ?? null
  const role = profile?.role ?? ''

  useEffect(() => {
    // Без профиля публиковать нечего: гость на платформе не «онлайн в школе».
    if (!profileId) return
    return acquirePresence(profileId, role)
  }, [profileId, role])
}

/**
 * Кто сейчас на платформе.
 *
 * Читает общее состояние канала, СВОЕЙ подписки не заводит: канал уже поднят
 * публикатором, и второй на тот же топик был бы лишним сокетом. Если
 * публикатор почему-то не смонтирован, список окажется пустым, а `connected`
 * — ложным, и экран скажет об этом словами.
 */
export function useOnlinePeople(): { people: PresencePerson[]; connected: boolean } {
  const people = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot)
  const connected = useSyncExternalStore(subscribePresence, getPresenceConnected, getPresenceConnected)
  return { people, connected }
}
