/**
 * Сколько ученик на самом деле смотрел видео (§204).
 *
 * Здесь нет ни DOM, ни сети — только правила счёта. Так и задумано: врут такие
 * счётчики почти всегда в арифметике, а не в проводке событий, и проверять
 * надо именно арифметику.
 *
 * Главное правило: **нет событий плеера — нет секунд**. Ни одна секунда не
 * появляется от того, что вкладка открыта или что прошло время. Выдуманные
 * минуты хуже отсутствующих: по ним начнут принимать решения об ученике.
 *
 * Как считаем прибавку между двумя соседними событиями плеера:
 *   - берём МИНИМУМ из «сколько прошло по часам» и «насколько продвинулась
 *     позиция» (плюс секунда на дрожание таймера плеера). Прыжок в конец
 *     ролика тогда даёт столько же, сколько реально прошло времени, а не
 *     сорок минут;
 *   - позиция не сдвинулась (пауза, буферизация) — ноль;
 *   - позиция ушла назад (перемотка назад) — ноль;
 *   - между событиями больше 30 секунд (вкладку усыпили) — ноль и отсчёт
 *     с чистого листа;
 *   - вкладка скрыта или плеер на паузе — ноль и отсчёт с чистого листа.
 */

/** Разрыв между событиями, после которого промежуток не засчитывается. */
export const WATCH_MAX_GAP_SEC = 30

/** Допуск на дрожание: позиция обычно идёт чуть неровнее часов. */
export const WATCH_JITTER_SEC = 1

/** Потолок одной порции — столько же, сколько принимает RPC `video_watch_add`. */
export const WATCH_MAX_CHUNK_SEC = 30

/** Доля длительности, с которой материал считается просмотренным. */
export const WATCH_DONE_RATIO = 0.9

/** Событие плеера, приведённое к одному виду. */
export interface WatchTick {
  /** Время события по часам страницы, мс. */
  atMs: number
  /** Позиция в ролике, секунды. */
  positionSec: number
  /** Плеер играет. Пауза и конец ролика — false. */
  playing: boolean
  /** Вкладка видима (`document.visibilityState !== 'hidden'`). */
  visible: boolean
}

export interface WatchState {
  /** Предыдущее засчитанное событие; null — отсчёт начнётся заново. */
  last: { atMs: number; positionSec: number } | null
  /** Накоплено и ещё не отправлено, секунды (дробные). */
  pendingSec: number
  /** Докуда дошёл за сеанс, секунды. */
  maxPositionSec: number
  /** Последняя длительность, о которой сказал плеер. */
  durationSec: number | null
}

export function createWatchState(): WatchState {
  return { last: null, pendingSec: 0, maxPositionSec: 0, durationSec: null }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Учесть событие плеера.
 *
 * Возвращает НОВОЕ состояние — вызывающему не нужно помнить, что мутируется.
 */
export function observeWatchTick(state: WatchState, tick: WatchTick): WatchState {
  const position = finite(tick.positionSec)
  const atMs = finite(tick.atMs)
  if (position == null || atMs == null || position < 0) return state

  const maxPositionSec = Math.max(state.maxPositionSec, position)

  // Пауза и скрытая вкладка не копят и рвут отсчёт: следующий промежуток
  // должен считаться от нового события, а не от того, что было до паузы.
  if (!tick.playing || !tick.visible) {
    return { ...state, last: null, maxPositionSec }
  }

  const last = state.last
  if (!last) return { ...state, last: { atMs, positionSec: position }, maxPositionSec }

  const wallSec = (atMs - last.atMs) / 1000
  const posSec = position - last.positionSec

  let added = 0
  if (wallSec > 0 && wallSec <= WATCH_MAX_GAP_SEC && posSec > 0) {
    added = Math.min(wallSec, posSec + WATCH_JITTER_SEC)
  }

  return {
    ...state,
    last: { atMs, positionSec: position },
    pendingSec: state.pendingSec + added,
    maxPositionSec,
  }
}

/**
 * Порвать отсчёт, не трогая накопленное. Пауза, конец ролика, уход со
 * страницы: следующее событие начнёт промежуток заново.
 */
export function resetWatchClock(state: WatchState): WatchState {
  return state.last == null ? state : { ...state, last: null }
}

/** Запомнить длительность, если плеер её сказал. */
export function noteWatchDuration(state: WatchState, duration: unknown): WatchState {
  const value = finite(duration)
  if (value == null || value <= 0 || value === state.durationSec) return state
  return { ...state, durationSec: value }
}

/**
 * Забрать накопленное целыми секундами, порциями не больше `WATCH_MAX_CHUNK_SEC`
 * — больший кусок RPC отбрасывает молча, и минуты потерялись бы без следа.
 * Дробный остаток остаётся в состоянии и уедет со следующей отправкой.
 */
export function drainWatchSeconds(state: WatchState): { state: WatchState; chunks: number[] } {
  const whole = Math.floor(state.pendingSec)
  if (whole < 1) return { state, chunks: [] }

  const chunks: number[] = []
  let left = whole
  while (left > 0) {
    const chunk = Math.min(left, WATCH_MAX_CHUNK_SEC)
    chunks.push(chunk)
    left -= chunk
  }
  return { state: { ...state, pendingSec: state.pendingSec - whole }, chunks }
}

/**
 * Считается ли материал просмотренным.
 *
 * Без известной длительности ответа нет: «просмотрено» при неизвестном
 * знаменателе — это не отметка, а догадка.
 */
export function isVideoWatched(maxPositionSec: number | null, durationSec: number | null): boolean {
  const position = finite(maxPositionSec)
  const duration = finite(durationSec)
  if (position == null || duration == null || duration <= 0) return false
  return position >= duration * WATCH_DONE_RATIO
}

// ─── Сводка для карточки ученика ─────────────────────────────────────────────

/** Строка `video_watch_daily` в том виде, в каком её читает клиент. */
export interface WatchDayRow {
  day: string
  seconds: number | null
}

export interface WatchSummary {
  totalSeconds: number
  weekSeconds: number
  /** Первый день, за который вообще есть запись; null — записей нет. */
  firstDay: string | null
}

/**
 * Итоги по дням.
 *
 * «За неделю» — последние семь суток включая сегодняшние, по датам, а не по
 * скользящим 168 часам: преподаватель сравнивает с расписанием занятий, а оно
 * тоже по дням.
 */
export function summarizeWatchDays(rows: WatchDayRow[], today: string): WatchSummary {
  const from = shiftDay(today, -6)
  let totalSeconds = 0
  let weekSeconds = 0
  let firstDay: string | null = null

  for (const row of rows) {
    const day = typeof row.day === 'string' ? row.day.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const seconds = Math.max(0, finite(row.seconds) ?? 0)
    totalSeconds += seconds
    if (day >= from && day <= today) weekSeconds += seconds
    if (firstDay == null || day < firstDay) firstDay = day
  }

  return { totalSeconds, weekSeconds, firstDay }
}

function shiftDay(day: string, deltaDays: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

/**
 * Секунды человеческими словами.
 *
 * Меньше минуты — так и пишем: «0 мин» читалось бы как «не смотрел», а это
 * разные вещи, и разница ровно та, ради которой всё затевалось.
 */
export function formatWatchMinutes(seconds: number): string {
  if (seconds <= 0) return '0 мин'
  if (seconds < 60) return 'меньше минуты'
  return `${Math.round(seconds / 60)} мин`
}
