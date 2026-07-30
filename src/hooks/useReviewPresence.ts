import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  dedupeViewers,
  parsePresenceState,
  reviewChannelTopic,
  type PresenceMeta,
} from '@/lib/reviewPresence'

/**
 * Кто из персонала сейчас в проверке ДЗ — через Supabase Presence.
 *
 * Подписка идёт на КУРС (`hw-review:<courseId>`), а не на работу: очередь
 * показывает десятки работ разом, и канал-на-работу означал бы десятки
 * сокет-подписок с одной вкладки. Какую именно работу открыл участник, он
 * кладёт в свой payload (`attemptId`), поэтому одной подписки хватает и для
 * списка, и для разбора.
 *
 * Каналы приватные: anon-ключ лежит в бандле, и на публичном канале
 * посторонний и имена собрал бы, и подделал бы присутствие. Доступ решает
 * политика на `realtime.messages` через ту же `course_is_staff`
 * (миграция 20260730220534).
 *
 * Отказ канала (нет прав, нет сети, Realtime выключен) НЕ ломает экран:
 * `viewers` просто остаётся пустым, и интерфейс выглядит как до этой фичи.
 * Присутствие — подсказка поверх работы, а не её условие.
 */
export function useReviewPresence({
  courseIds,
  attemptId,
}: {
  /** Курсы, за которыми следим. Для очереди — все курсы её строк. */
  courseIds: string[]
  /** Работа, открытая прямо сейчас, или `null` — «я просто в списке». */
  attemptId: string | null
}) {
  const profile = useAuthStore(s => s.profile)
  const profileId = profile?.id ?? null
  const name = profile?.full_name?.trim() || 'Коллега'

  const [viewers, setViewers] = useState<PresenceMeta[]>([])

  // Свой payload держим в ref: он меняется при каждом открытии работы, а
  // пересобирать из-за этого подписки — терять соединение на ровном месте.
  const payloadRef = useRef<PresenceMeta>({ profileId: profileId ?? '', name, attemptId })
  const liveChannelsRef = useRef<RealtimeChannel[]>([])

  // Новый массив с теми же id не должен пересоздавать каналы — сравниваем
  // по содержимому, а не по ссылке.
  const courseKey = useMemo(
    () => Array.from(new Set(courseIds.filter(Boolean))).sort().join(','),
    [courseIds],
  )

  // Этот эффект объявлен ДО эффекта подписки, поэтому при первом проходе
  // payloadRef уже заполнен к моменту, когда канал вызовет track().
  useEffect(() => {
    payloadRef.current = { profileId: profileId ?? '', name, attemptId }
    for (const channel of liveChannelsRef.current) {
      // Повторный track перезаписывает свою запись присутствия — так «Аня
      // вошла в работу» и «Аня вышла в список» доезжают без переподписки.
      channel.track(payloadRef.current).catch(() => {})
    }
  }, [profileId, name, attemptId])

  useEffect(() => {
    const ids = courseKey ? courseKey.split(',') : []
    if (!profileId || ids.length === 0) {
      setViewers([])
      return
    }

    let cancelled = false
    const channels: RealtimeChannel[] = []
    // Состояние каждого канала храним отдельно и склеиваем при выдаче:
    // sync приходит по одному каналу за раз и не знает про остальные.
    const stateByCourse = new Map<string, PresenceMeta[]>()

    function publish() {
      if (cancelled) return
      setViewers(dedupeViewers(Array.from(stateByCourse.values()).flat(), profileId))
    }

    // Приватному каналу нужен свежий токен. supabase-js делает это сам при
    // смене сессии, но подписка может случиться раньше такого события —
    // вызов идемпотентный и дешёвый, а без него канал молча не пустит.
    supabase.realtime.setAuth().catch(() => {})

    for (const courseId of ids) {
      const channel = supabase.channel(reviewChannelTopic(courseId), {
        // Ключ присутствия — профиль: две вкладки одного человека
        // схлопываются в одну запись, а не выглядят как два проверяющих.
        config: { private: true, presence: { key: profileId } },
      })

      // Достаточно 'sync': он приходит и на первое состояние канала, и на
      // каждый последующий diff (join/leave), так что отдельные подписки на
      // join/leave ничего бы не добавили.
      channel.on('presence', { event: 'sync' }, () => {
        stateByCourse.set(courseId, parsePresenceState(channel.presenceState()))
        publish()
      })

      channel.subscribe(status => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          channel.track(payloadRef.current).catch(() => {})
        } else {
          // CHANNEL_ERROR / TIMED_OUT / CLOSED: показывать последнее известное
          // состояние опаснее, чем не показывать ничего — «работу смотрит
          // Аня» может быть неправдой уже минуту.
          stateByCourse.delete(courseId)
          publish()
        }
      })

      channels.push(channel)
    }

    liveChannelsRef.current = channels

    return () => {
      cancelled = true
      liveChannelsRef.current = []
      for (const channel of channels) supabase.removeChannel(channel)
    }
  }, [courseKey, profileId])

  return { viewers }
}
