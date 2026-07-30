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
