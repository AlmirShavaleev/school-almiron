import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Присутствие в школе.
 *
 * Файл сторожит четыре обещания, данные владельцу и вводной:
 *
 * 1. **В канал уходят только `profileId` и роль.** Ни имени, ни адреса
 *    страницы: «на каком экране ребёнок» — запрещено отдельным решением, и
 *    запрет выполняется тем, что этого нет В ПЕРЕДАЧЕ, а не тем, что мы это не
 *    рисуем.
 * 2. **Подписка одна, сколько бы раз её ни заняли.** Публикатор висит на всём
 *    приложении, панель читает то же состояние — без счётчика ссылок у админа
 *    стало бы два сокета на один топик.
 * 3. **Открыть и закрыть экран десять раз — каналов не прибавляется.** Прямое
 *    требование приёмки: утечка подписок на живом экране это растущий счёт.
 * 4. **Переподписка после сна ноутбука не создаёт второго себя.** Ключ
 *    присутствия — профиль, и повторный track() перезаписывает свою же запись.
 */

const channels: Array<{
  topic: string
  config: any
  track: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  /** Обработчик, переданный в subscribe — им имитируем смену состояния. */
  statusHandler: ((status: string) => void) | null
  /** Обработчик 'sync' — им имитируем приход присутствия. */
  syncHandler: (() => void) | null
}> = []

const removed: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    realtime: { setAuth: vi.fn(() => Promise.resolve()) },
    channel: (topic: string, config: any) => {
      const ch: any = {
        topic,
        config,
        statusHandler: null,
        syncHandler: null,
        track: vi.fn(() => Promise.resolve()),
        presenceState: vi.fn(() => ({})),
      }
      ch.on = vi.fn((_type: string, _filter: any, handler: () => void) => {
        ch.syncHandler = handler
        return ch
      })
      ch.subscribe = vi.fn((handler: (status: string) => void) => {
        ch.statusHandler = handler
        return ch
      })
      channels.push(ch)
      return ch
    },
    removeChannel: (ch: any) => { removed.push(ch.topic) },
  },
}))

import {
  SCHOOL_PRESENCE_TOPIC,
  acquirePresence,
  getPresenceConnected,
  getPresenceSnapshot,
  parsePresenceState,
  subscribePresence,
  __resetPresenceForTests,
} from '@/lib/schoolPresence'

beforeEach(() => {
  channels.length = 0
  removed.length = 0
  __resetPresenceForTests()
  channels.length = 0
  removed.length = 0
})

afterEach(() => {
  __resetPresenceForTests()
})

describe('что уходит в канал', () => {
  it('только идентификатор и роль — ни имени, ни адреса страницы', () => {
    acquirePresence('p-1', 'student')
    channels[0].statusHandler?.('SUBSCRIBED')

    expect(channels[0].track).toHaveBeenCalledWith({ profileId: 'p-1', role: 'student' })

    // Именно перечень ключей: лишнее поле здесь — это утечка сведений о ребёнке.
    const payload = channels[0].track.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['profileId', 'role'])
  })

  it('ключ присутствия — профиль, чтобы две вкладки были одним онлайном', () => {
    acquirePresence('p-1', 'student')
    expect(channels[0].config.config.presence.key).toBe('p-1')
    expect(channels[0].config.config.private).toBe(true)
    expect(channels[0].topic).toBe(SCHOOL_PRESENCE_TOPIC)
  })
})

describe('разбор состояния', () => {
  it('несколько вкладок одного человека схлопываются в одну запись', () => {
    const people = parsePresenceState({
      'p-1': [{ profileId: 'p-1', role: 'student' }, { profileId: 'p-1', role: 'student' }],
      'p-2': [{ profileId: 'p-2', role: 'teacher' }],
    })
    expect(people).toHaveLength(2)
    expect(people.map(p => p.profileId)).toEqual(['p-1', 'p-2'])
  })

  it('битые и безымянные записи отбрасываются, а не роняют разбор', () => {
    const people = parsePresenceState({
      a: [{ profileId: '', role: 'student' }],
      b: [null as any],
      c: [{ role: 'student' } as any],
      d: [{ profileId: 'p-9', role: 'admin' }],
    })
    expect(people).toEqual([{ profileId: 'p-9', role: 'admin' }])
  })
})

describe('счётчик ссылок', () => {
  it('два держателя — один канал', () => {
    const releaseA = acquirePresence('p-1', 'admin')
    const releaseB = acquirePresence('p-1', 'admin')

    expect(channels).toHaveLength(1)

    // Первый отпустил — канал ещё нужен второму.
    releaseA()
    expect(removed).toHaveLength(0)

    releaseB()
    expect(removed).toEqual([SCHOOL_PRESENCE_TOPIC])
  })

  it('повторный release ничего не ломает', () => {
    const release = acquirePresence('p-1', 'admin')
    release()
    release()
    expect(removed).toHaveLength(1)
  })

  it('открыть и закрыть экран десять раз — один канал за раз, все закрыты', () => {
    // Требование приёмки. Считаем и созданные, и закрытые: равенство значит,
    // что ни одна подписка не осталась висеть.
    for (let i = 0; i < 10; i++) {
      const release = acquirePresence('p-1', 'admin')
      channels[channels.length - 1].statusHandler?.('SUBSCRIBED')
      release()
    }
    expect(channels).toHaveLength(10)
    expect(removed).toHaveLength(10)
  })
})

describe('состояние для экрана', () => {
  it('присутствие доезжает до снимка, подписчики уведомлены', () => {
    const seen = vi.fn()
    subscribePresence(seen)

    acquirePresence('p-1', 'admin')
    channels[0].presenceState.mockReturnValue({
      'p-1': [{ profileId: 'p-1', role: 'admin' }],
      'p-2': [{ profileId: 'p-2', role: 'student' }],
    })
    channels[0].statusHandler?.('SUBSCRIBED')
    channels[0].syncHandler?.()

    expect(getPresenceConnected()).toBe(true)
    expect(getPresenceSnapshot().map(p => p.profileId)).toEqual(['p-1', 'p-2'])
    expect(seen).toHaveBeenCalled()
  })

  it('снимок — стабильная ссылка, пока состав не менялся', () => {
    acquirePresence('p-1', 'admin')
    channels[0].presenceState.mockReturnValue({ 'p-1': [{ profileId: 'p-1', role: 'admin' }] })
    channels[0].statusHandler?.('SUBSCRIBED')
    channels[0].syncHandler?.()

    const first = getPresenceSnapshot()
    // Тот же состав пришёл ещё раз — новый массив здесь увёл бы
    // useSyncExternalStore в бесконечную перерисовку.
    channels[0].syncHandler?.()
    expect(getPresenceSnapshot()).toBe(first)
  })

  it('обрыв канала гасит список, а не показывает последний известный', () => {
    acquirePresence('p-1', 'admin')
    channels[0].presenceState.mockReturnValue({ 'p-2': [{ profileId: 'p-2', role: 'student' }] })
    channels[0].statusHandler?.('SUBSCRIBED')
    channels[0].syncHandler?.()
    expect(getPresenceSnapshot()).toHaveLength(1)

    // «Тимур сейчас на платформе» может быть неправдой уже через минуту.
    channels[0].statusHandler?.('CHANNEL_ERROR')
    expect(getPresenceSnapshot()).toHaveLength(0)
    expect(getPresenceConnected()).toBe(false)
  })

  it('переподписка после сна повторяет track и не плодит второго себя', () => {
    acquirePresence('p-1', 'student')
    channels[0].statusHandler?.('SUBSCRIBED')
    expect(channels[0].track).toHaveBeenCalledTimes(1)

    // Ноутбук уснул: канал отвалился и поднялся тем же объектом.
    channels[0].statusHandler?.('TIMED_OUT')
    channels[0].statusHandler?.('SUBSCRIBED')

    expect(channels).toHaveLength(1)
    expect(channels[0].track).toHaveBeenCalledTimes(2)
    // Ключ присутствия прежний — сервер перезапишет ту же запись.
    expect(channels[0].config.config.presence.key).toBe('p-1')
  })
})
