import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Присутствие в школе: кто сейчас на платформе.
 *
 * Устройство — по образцу `hw-review:*` (§31), но с двумя отличиями, и оба
 * продиктованы решениями владельца:
 *
 * 1. **В канал уходят ТОЛЬКО `profileId` и роль.** Ни имени, ни адреса
 *    страницы, ни идентификатора темы. Имя подставляет экран из уже
 *    загруженного списка профилей; «на каком экране человек находится»
 *    владелец запретил показывать отдельно, поэтому этого нет и в передаче —
 *    не «не показываем», а «не отправляем».
 * 2. **Писать должны все, читать — только админ.** Ученик тоже онлайн, и без
 *    его `track()` панель показала бы одних админов. Разводится политиками на
 *    `realtime.messages` (миграция 20260909213307), а не здесь.
 *
 * ОДИН КАНАЛ НА ВКЛАДКУ БРАУЗЕРА, со счётчиком ссылок. Публикатор висит на
 * всём приложении, а панель админа хочет читать то же состояние — если бы
 * каждый заводил свой канал, у админа их стало бы два. Счётчик делает второй
 * `acquire` бесплатным: канал создаётся на первом и закрывается на последнем
 * `release`.
 *
 * Ключ присутствия — профиль. Две вкладки одного человека схлопываются в одну
 * запись, а не выглядят как два онлайна; это же спасает от «второго себя»
 * после переподключения.
 */

export const SCHOOL_PRESENCE_TOPIC = 'school-presence'

export interface PresencePerson {
  profileId: string
  role: string
}

/** Разбор состояния канала. Чужие и битые записи молча отбрасываются. */
export function parsePresenceState(state: Record<string, unknown[]>): PresencePerson[] {
  const seen = new Map<string, PresencePerson>()
  for (const entries of Object.values(state ?? {})) {
    for (const raw of entries ?? []) {
      const meta = raw as Partial<PresencePerson> | null
      const profileId = String(meta?.profileId ?? '').trim()
      if (!profileId) continue
      // Одна запись на человека: несколько вкладок — это один онлайн.
      if (!seen.has(profileId)) {
        seen.set(profileId, { profileId, role: String(meta?.role ?? '') })
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.profileId.localeCompare(b.profileId))
}

// ── Хранилище состояния ────────────────────────────────────────────────────
//
// Отдельно от React: канал живёт в публикаторе, а читает панель — они в разных
// поддеревьях. Снимок отдаётся стабильной ссылкой, иначе useSyncExternalStore
// уйдёт в бесконечный цикл.

const EMPTY: PresencePerson[] = []

let people: PresencePerson[] = EMPTY
let connected = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribePresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPresenceSnapshot(): PresencePerson[] {
  return people
}

/**
 * Подключено ли присутствие. Нужно экрану, чтобы отличить «никого нет» от
 * «канал не поднялся»: пустой список в обоих случаях выглядит одинаково, а
 * значит одно из состояний соврало бы.
 */
export function getPresenceConnected(): boolean {
  return connected
}

function setPeople(next: PresencePerson[]) {
  const same = next.length === people.length
    && next.every((p, i) => p.profileId === people[i]?.profileId && p.role === people[i]?.role)
  if (same) return
  people = next.length === 0 ? EMPTY : next
  emit()
}

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  emit()
}

// ── Канал со счётчиком ссылок ──────────────────────────────────────────────

let channel: RealtimeChannel | null = null
let refs = 0
let payload: PresencePerson | null = null

/**
 * Занять канал присутствия. Возвращает функцию освобождения.
 *
 * Повторный вызов с тем же человеком не создаёт второй канал — только
 * увеличивает счётчик. Это и защита от двойного монтирования (StrictMode в
 * разработке монтирует эффекты дважды), и то, что позволяет панели админа
 * читать состояние, не заводя своей подписки.
 */
export function acquirePresence(profileId: string, role: string): () => void {
  payload = { profileId, role }
  refs += 1

  if (!channel) {
    // Приватному каналу нужен свежий токен. supabase-js обновляет его сам при
    // смене сессии, но подписка может случиться раньше такого события — вызов
    // идемпотентный и дешёвый, а без него канал молча не пустит.
    supabase.realtime.setAuth().catch(() => {})

    const created = supabase.channel(SCHOOL_PRESENCE_TOPIC, {
      config: { private: true, presence: { key: profileId } },
    })

    // Достаточно 'sync': он приходит и на первое состояние канала, и на каждый
    // последующий diff, так что отдельные подписки на join/leave ничего бы не
    // добавили.
    created.on('presence', { event: 'sync' }, () => {
      setPeople(parsePresenceState(created.presenceState() as Record<string, unknown[]>))
    })

    created.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        setConnected(true)
        // Повторная подписка после сна ноутбука или обрыва сети приходит сюда
        // же, и track() надо повторить: сервер уже забыл прежнюю запись. Ключ
        // присутствия тот же (профиль), поэтому второго себя это не создаёт.
        if (payload) created.track(payload).catch(() => {})
      } else {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED. Показывать последнее известное
        // состояние опаснее, чем не показывать ничего: «Тимур сейчас на
        // платформе» может быть неправдой уже минуту.
        setConnected(false)
        setPeople(EMPTY)
      }
    })

    channel = created
  } else if (payload) {
    // Канал уже есть (например, роль подгрузилась позже) — обновляем запись.
    channel.track(payload).catch(() => {})
  }

  let released = false
  return () => {
    if (released) return
    released = true
    refs -= 1
    if (refs > 0 || !channel) return
    const closing = channel
    channel = null
    payload = null
    setConnected(false)
    setPeople(EMPTY)
    supabase.removeChannel(closing)
  }
}

/** Только для тестов: развести состояние между случаями. */
export function __resetPresenceForTests() {
  if (channel) supabase.removeChannel(channel)
  channel = null
  refs = 0
  payload = null
  people = EMPTY
  connected = false
  listeners.clear()
}
