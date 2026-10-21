import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from '@/lib/lazyPage'

describe('isChunkLoadError — отличаем «файл не доехал» от настоящей ошибки', () => {
  it('узнаёт сообщение браузера про недогруженный модуль', () => {
    // Ровно то, что владелец видел в проде после деплоя.
    expect(isChunkLoadError(new Error(
      'Failed to fetch dynamically imported module: https://alminion.ru/assets/MyTopicHomeworkPage-B4x7W2Ut.js',
    ))).toBe(true)
  })

  it('узнаёт формулировки других браузеров', () => {
    // Safari и Firefox формулируют иначе, чем Chrome.
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('ChunkLoadError'))).toBe(true)
  })

  it('НЕ трогает обычные ошибки внутри страницы', () => {
    // Перезагрузка их не чинит, а сообщение потеряется — такие должны
    // доходить до экрана ошибки как есть.
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isChunkLoadError(new Error('Нет прав на этот курс'))).toBe(false)
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false)
  })

  it('не падает на не-ошибках', () => {
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('Failed to fetch dynamically imported module: /a.js')).toBe(true)
  })
})

/**
 * Защита от цикла перезагрузок (письмо ЛК_СРОЧНО_урок_перезагрузка_НЕ_исправлено.md, 21.10):
 * не чаще одной автоперезагрузки за 2 минуты, отметка — в window.name (переживает
 * перезагрузку без хранилища) и в localStorage; перезагрузка — за свежим index.html.
 */
import { beforeEach, vi } from 'vitest'
import { RELOAD_COOLDOWN_MS, freshUrl, lastAutoReload, markAutoReload, mayAutoReload, stripBustParam } from '@/lib/lazyPage'

describe('lazyPage — не больше одной автоперезагрузки за окно', () => {
  beforeEach(() => { window.name = ''; localStorage.clear() })

  it('после отметки повторная автоперезагрузка запрещена 2 минуты, потом снова можно', () => {
    expect(mayAutoReload(1_000_000)).toBe(true)
    markAutoReload(1_000_000)
    expect(mayAutoReload(1_000_000 + 5_000)).toBe(false)
    expect(mayAutoReload(1_000_000 + RELOAD_COOLDOWN_MS)).toBe(true)
  })

  it('отметка живёт в window.name — даже без хранилища', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    markAutoReload(42_000)
    expect(lastAutoReload()).toBe(42_000)
    expect(mayAutoReload(43_000)).toBe(false)
    spy.mockRestore(); get.mockRestore()
  })

  it('чужое содержимое window.name не теряется', () => {
    window.name = 'popup-x'
    markAutoReload(7)
    expect(window.name.startsWith('popup-x')).toBe(true)
    markAutoReload(9)
    expect(lastAutoReload()).toBe(9)
  })

  it('перезагрузка за свежим index.html: ?_r=<время>, потом параметр убирается', () => {
    expect(freshUrl('https://www.almiron.ru/my-course/g/topic/t?tab=hw#x', 123)).toBe('https://www.almiron.ru/my-course/g/topic/t?tab=hw&_r=123#x')
    window.history.replaceState(null, '', '/my-course/g/topic/t?tab=hw&_r=123#x')
    stripBustParam()
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/my-course/g/topic/t?tab=hw#x')
  })
})
