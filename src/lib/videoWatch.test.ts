import { describe, expect, it } from 'vitest'
import {
  createWatchState,
  drainWatchSeconds,
  formatWatchMinutes,
  isVideoWatched,
  noteWatchDuration,
  observeWatchTick,
  resetWatchClock,
  summarizeWatchDays,
  WATCH_MAX_CHUNK_SEC,
  type WatchState,
} from '@/lib/videoWatch'

/**
 * §204. Тут проверяется единственное место, где такой счётчик врёт, —
 * арифметика прибавки. Ни React, ни сети: правило «сколько засчитать между
 * двумя событиями плеера» обязано быть проверяемым без браузера.
 */

const START = 1_700_000_000_000

/** Прогон списка событий «позиция в секундах через N секунд по часам». */
function play(
  steps: Array<{ atSec: number; positionSec: number; playing?: boolean; visible?: boolean }>,
  state: WatchState = createWatchState(),
): WatchState {
  let current = state
  for (const step of steps) {
    current = observeWatchTick(current, {
      atMs: START + step.atSec * 1000,
      positionSec: step.positionSec,
      playing: step.playing ?? true,
      visible: step.visible ?? true,
    })
  }
  return current
}

describe('Счёт просмотра видео (§204)', () => {
  it('обычное воспроизведение даёт секунды', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 1, positionSec: 1 },
      { atSec: 2, positionSec: 2 },
      { atSec: 3, positionSec: 3 },
    ])
    expect(state.pendingSec).toBeCloseTo(3, 5)
  })

  it('без единого события не накапливается ничего', () => {
    expect(createWatchState().pendingSec).toBe(0)
    expect(drainWatchSeconds(createWatchState()).chunks).toEqual([])
  })

  it('одно-единственное событие ничего не даёт — промежутка ещё нет', () => {
    expect(play([{ atSec: 0, positionSec: 10 }]).pendingSec).toBe(0)
  })

  it('пауза — ноль: плеер не играет', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 1, positionSec: 1 },
      { atSec: 2, positionSec: 1, playing: false },
      { atSec: 12, positionSec: 1, playing: false },
    ])
    expect(state.pendingSec).toBeCloseTo(1, 5)
  })

  it('пауза — ноль и тогда, когда плеер продолжает слать события с той же позицией', () => {
    const state = play([
      { atSec: 0, positionSec: 30 },
      { atSec: 1, positionSec: 30 },
      { atSec: 2, positionSec: 30 },
      { atSec: 3, positionSec: 30 },
    ])
    expect(state.pendingSec).toBe(0)
  })

  it('перемотка вперёд не даёт больше, чем прошло по часам', () => {
    const state = play([
      { atSec: 0, positionSec: 10 },
      { atSec: 1, positionSec: 2400 },
    ])
    expect(state.pendingSec).toBeCloseTo(1, 5)
    expect(state.maxPositionSec).toBe(2400)
  })

  it('перемотка назад — ноль', () => {
    const state = play([
      { atSec: 0, positionSec: 600 },
      { atSec: 1, positionSec: 10 },
    ])
    expect(state.pendingSec).toBe(0)
    // Достигнутая позиция при этом не откатывается.
    expect(state.maxPositionSec).toBe(600)
  })

  it('после перемотки назад счёт идёт заново, а не от старой позиции', () => {
    const state = play([
      { atSec: 0, positionSec: 600 },
      { atSec: 1, positionSec: 10 },
      { atSec: 2, positionSec: 11 },
      { atSec: 3, positionSec: 12 },
    ])
    expect(state.pendingSec).toBeCloseTo(2, 5)
  })

  it('разрыв больше 30 секунд — ноль и перезапуск отсчёта', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 120, positionSec: 120 },
      { atSec: 121, positionSec: 121 },
    ])
    expect(state.pendingSec).toBeCloseTo(1, 5)
  })

  it('ровно 30 секунд разрыва ещё считаются', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 30, positionSec: 30 },
    ])
    expect(state.pendingSec).toBeCloseTo(30, 5)
  })

  it('скрытая вкладка — ноль, и промежуток через неё не сшивается', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 1, positionSec: 1 },
      { atSec: 2, positionSec: 2, visible: false },
      { atSec: 3, positionSec: 3, visible: false },
      // Возврат на вкладку сам по себе секунд не даёт: он только начинает
      // новый промежуток, и засчитан будет уже следующий.
      { atSec: 4, positionSec: 4 },
      { atSec: 5, positionSec: 5 },
    ])
    expect(state.pendingSec).toBeCloseTo(2, 5)
  })

  it('дрожание позиции не съедает секунду', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 1, positionSec: 0.85 },
      { atSec: 2, positionSec: 1.9 },
    ])
    expect(state.pendingSec).toBeCloseTo(2, 5)
  })

  it('события задом наперёд по часам ничего не прибавляют', () => {
    const state = play([
      { atSec: 10, positionSec: 10 },
      { atSec: 5, positionSec: 20 },
    ])
    expect(state.pendingSec).toBe(0)
  })

  it('мусорная позиция игнорируется целиком', () => {
    const before = play([{ atSec: 0, positionSec: 0 }, { atSec: 1, positionSec: 1 }])
    const after = observeWatchTick(before, {
      atMs: START + 2000, positionSec: Number.NaN, playing: true, visible: true,
    })
    expect(after).toBe(before)
  })
})

describe('Отправка накопленного (§204)', () => {
  it('целые секунды уходят, дробный остаток остаётся', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 2.5, positionSec: 2.5 },
    ])
    const drained = drainWatchSeconds(state)
    expect(drained.chunks).toEqual([2])
    expect(drained.state.pendingSec).toBeCloseTo(0.5, 5)
  })

  it('меньше секунды не отправляется вовсе', () => {
    const state = play([
      { atSec: 0, positionSec: 0 },
      { atSec: 0.4, positionSec: 0.4 },
    ])
    expect(drainWatchSeconds(state).chunks).toEqual([])
  })

  it('накопленное больше потолка RPC режется на порции', () => {
    const state: WatchState = { ...createWatchState(), pendingSec: 70 }
    const drained = drainWatchSeconds(state)
    expect(drained.chunks).toEqual([WATCH_MAX_CHUNK_SEC, WATCH_MAX_CHUNK_SEC, 10])
    expect(drained.state.pendingSec).toBe(0)
  })
})

describe('Вспомогательное состояние (§204)', () => {
  it('разрыв отсчёта не трогает накопленное', () => {
    const state = play([{ atSec: 0, positionSec: 0 }, { atSec: 1, positionSec: 1 }])
    const reset = resetWatchClock(state)
    expect(reset.pendingSec).toBeCloseTo(1, 5)
    expect(reset.last).toBeNull()
  })

  it('длительность запоминается, мусор — нет', () => {
    let state = noteWatchDuration(createWatchState(), 900)
    expect(state.durationSec).toBe(900)
    state = noteWatchDuration(state, 0)
    state = noteWatchDuration(state, Number.NaN)
    expect(state.durationSec).toBe(900)
  })
})

describe('Отметка «просмотрено» (§204)', () => {
  it('появляется на 90 % и не раньше', () => {
    expect(isVideoWatched(809, 900)).toBe(false)
    expect(isVideoWatched(810, 900)).toBe(true)
    expect(isVideoWatched(900, 900)).toBe(true)
  })

  it('без известной длительности отметки нет', () => {
    expect(isVideoWatched(5000, null)).toBe(false)
    expect(isVideoWatched(5000, 0)).toBe(false)
    expect(isVideoWatched(null, 900)).toBe(false)
  })
})

describe('Сводка по дням для карточки ученика (§204)', () => {
  const rows = [
    { day: '2026-09-01', seconds: 600 },
    { day: '2026-09-14', seconds: 300 },
    { day: '2026-09-17', seconds: 120 },
  ]

  it('«за неделю» — последние семь суток включая сегодняшние', () => {
    const summary = summarizeWatchDays(rows, '2026-09-17')
    expect(summary.weekSeconds).toBe(420)
    expect(summary.totalSeconds).toBe(1020)
  })

  it('первый день записи — самый ранний из строк', () => {
    expect(summarizeWatchDays(rows, '2026-09-17').firstDay).toBe('2026-09-01')
  })

  it('без строк — ни минут, ни даты', () => {
    expect(summarizeWatchDays([], '2026-09-17')).toEqual({ totalSeconds: 0, weekSeconds: 0, firstDay: null })
  })

  it('строка с мусорной датой не ломает счёт', () => {
    const summary = summarizeWatchDays([{ day: 'позавчера', seconds: 999 }, ...rows], '2026-09-17')
    expect(summary.totalSeconds).toBe(1020)
    expect(summary.firstDay).toBe('2026-09-01')
  })

  it('меньше минуты называется словами, а не нулём', () => {
    expect(formatWatchMinutes(0)).toBe('0 мин')
    expect(formatWatchMinutes(40)).toBe('меньше минуты')
    expect(formatWatchMinutes(600)).toBe('10 мин')
  })
})
