import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'

/**
 * §263. Страница работы: «открыл условие» — один вызов; уходы со страницы —
 * visibilitychange/blur, пачками в `work_report_away`; ученику — ничего
 * (хук ничего не возвращает). Клик по выбору файла / ссылке условия — «свой»
 * уход; фокус во встроенном просмотрщике (iframe) — не уход.
 */
const rpc = vi.hoisted(() => vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({ data: { saved: true }, error: null })))
vi.mock('@/lib/safeRpc', () => ({ safeRpc: rpc }))

import { isExcusedClick, useAwayTracker, useWorkOpenMark } from '@/hooks/useWorkActivity'

let hidden = false
let focused = true
beforeEach(() => {
  rpc.mockClear()
  hidden = false
  focused = true
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})
afterEach(() => { vi.useRealTimers() })

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const awayCalls = () => rpc.mock.calls.filter(c => c[0] === 'work_report_away').map(c => c[1] as Record<string, unknown>)

function hide() { hidden = true; document.dispatchEvent(new Event('visibilitychange')) }
function show() { hidden = false; document.dispatchEvent(new Event('visibilitychange')) }

describe('useWorkOpenMark', () => {
  it('один вызов на ДЗ, пока работа идёт; вне работы — ни одного', () => {
    const { rerender } = renderHook(({ live }) => useWorkOpenMark('hw1', live), { initialProps: { live: false } })
    expect(rpc).not.toHaveBeenCalled()
    rerender({ live: true })
    rerender({ live: true })
    expect(rpc.mock.calls.filter(c => c[0] === 'work_mark_opened')).toEqual([['work_mark_opened', { p_homework_id: 'hw1' }]])
  })
})

describe('useAwayTracker', () => {
  it('вкладка скрыта → уход (сразу), вернулся → время вне страницы; хук ничего не отдаёт ученику', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-03T06:00:00Z'))
    const { result, unmount } = renderHook(() => useAwayTracker({ homeworkId: 'hw1', active: true }))
    expect(result.current).toBeUndefined()
    hide()
    await flush()
    vi.setSystemTime(new Date('2026-10-03T06:01:10Z'))
    show()
    await flush()
    expect(awayCalls()).toEqual([
      { p_homework_id: 'hw1', p_mock_exam_id: null, p_leaves: 1, p_away_seconds: 0 },
      { p_homework_id: 'hw1', p_mock_exam_id: null, p_leaves: 0, p_away_seconds: 70 },
    ])
    unmount()
  })

  it('пробник: та же пачка с mock_exam_id', async () => {
    const { unmount } = renderHook(() => useAwayTracker({ mockExamId: 'm9', active: true }))
    window.dispatchEvent(new Event('blur'))
    await flush()
    expect(awayCalls()[0]).toMatchObject({ p_homework_id: null, p_mock_exam_id: 'm9', p_leaves: 1 })
    unmount()
  })

  it('не идёт работа — ничего не слушает и не шлёт', async () => {
    renderHook(() => useAwayTracker({ homeworkId: 'hw1', active: false }))
    hide(); show()
    window.dispatchEvent(new Event('blur'))
    await flush()
    expect(awayCalls()).toEqual([])
  })

  it('фокус ушёл во встроенный просмотрщик условия (iframe) — не уход', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(frame)
    const { unmount } = renderHook(() => useAwayTracker({ homeworkId: 'hw1', active: true }))
    window.dispatchEvent(new Event('blur'))
    await flush()
    expect(awayCalls()).toEqual([])
    unmount()
    frame.remove()
  })

  it('выбор фото (input type=file) — «свой» уход: камера скрывает страницу, но в счёт не идёт', async () => {
    const { container } = render(<label><input type="file" data-testid="f" />Фото</label>)
    const { unmount } = renderHook(() => useAwayTracker({ homeworkId: 'hw1', active: true }))
    container.querySelector('label')!.click()
    hide()
    await flush()
    show()
    await flush()
    expect(awayCalls()).toEqual([])
    unmount()
  })

  it('уход в момент закрытия страницы досылается при размонтировании', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-03T06:00:00Z'))
    const { unmount } = renderHook(() => useAwayTracker({ homeworkId: 'hw1', active: true }))
    hide()
    await flush()
    vi.setSystemTime(new Date('2026-10-03T06:00:30Z'))
    unmount()
    await flush()
    expect(awayCalls().map(c => [c.p_leaves, c.p_away_seconds])).toEqual([[1, 0], [0, 30]])
  })
})

describe('isExcusedClick', () => {
  it('ссылки и кнопки в зоне условия, файловые поля и их подписи — да; просто щелчок по условию — нет', () => {
    document.body.innerHTML = `
      <section data-away-ok><a href="#" id="a">PDF</a><p id="p">текст условия</p></section>
      <label id="l"><input type="file" />Фото</label>
      <button id="b">Сдать</button>`
    expect(isExcusedClick(document.getElementById('a'))).toBe(true)
    expect(isExcusedClick(document.getElementById('p'))).toBe(false)
    expect(isExcusedClick(document.getElementById('l'))).toBe(true)
    expect(isExcusedClick(document.getElementById('b'))).toBe(false)
    expect(isExcusedClick(null)).toBe(false)
    document.body.innerHTML = ''
  })
})
