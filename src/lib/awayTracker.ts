/**
 * §263. Уходы со страницы работы — счётчик без сети.
 *
 * Пока у ученика идёт работа (или пробник), страница работы считает, сколько
 * раз он с неё уходил (вкладка скрыта / окно браузера потеряло фокус) и
 * сколько секунд суммарно был вне её. На сервер — пачкой: не чаще раза в
 * `minIntervalMs` (15 с) и сразу при возврате (если последняя пачка ушла не
 * только что). Ученику счётчик не показывается — только предупреждение
 * «Учитель видит, если ты уходишь со страницы работы».
 *
 * Свои уходы страницы не считаются: снять фото (камера телефона скрывает
 * страницу), выбрать файл, открыть файл условия в новой вкладке. Перед
 * таким действием страница зовёт `excuseNextLeave()` — следующий уход (в
 * пределах `excuseMs`) не идёт ни в число, ни во время.
 */
export interface AwayBatch {
  leaves: number
  seconds: number
}

export interface AwayTrackerDeps {
  now: () => number
  send: (batch: AwayBatch) => Promise<void>
}

export interface AwayTrackerOptions {
  /** Не чаще одной пачки за столько мс (кроме возврата). */
  minIntervalMs?: number
  /** Возврат шлёт пачку сразу, если прошлая ушла не меньше столько мс назад. */
  backDebounceMs?: number
  /** Сколько действует «свой уход» (камера, выбор файла, условие в новой вкладке). */
  excuseMs?: number
}

export class AwayTracker {
  private away: { since: number; excused: boolean } | null = null
  private pendingLeaves = 0
  private pendingSeconds = 0
  private lastFlush = Number.NEGATIVE_INFINITY
  private inFlight: Promise<void> | null = null
  private excuseUntil = 0
  private resendAfterFlight = false
  private stopped = false
  private readonly minIntervalMs: number
  private readonly backDebounceMs: number
  private readonly excuseMs: number

  private readonly deps: AwayTrackerDeps

  constructor(deps: AwayTrackerDeps, opts: AwayTrackerOptions = {}) {
    this.deps = deps
    this.minIntervalMs = opts.minIntervalMs ?? 15_000
    this.backDebounceMs = opts.backDebounceMs ?? 5_000
    this.excuseMs = opts.excuseMs ?? 3 * 60_000
  }

  /** Ученик сейчас вне страницы? */
  get isAway(): boolean {
    return this.away !== null
  }

  /** Что накоплено и ещё не отправлено (для тестов и отладки; ученику не показывается). */
  get pending(): AwayBatch {
    return { leaves: this.pendingLeaves, seconds: this.pendingSeconds }
  }

  /** Следующий уход — «свой» (камера, файл, условие в новой вкладке). */
  excuseNextLeave(): void {
    this.excuseUntil = this.deps.now() + this.excuseMs
  }

  /** Страница скрыта / окно потеряло фокус. Повтор, пока ученик вне страницы, — не новый уход. */
  leave(): void {
    if (this.stopped || this.away) return
    const t = this.deps.now()
    if (t < this.excuseUntil) {
      this.excuseUntil = 0
      this.away = { since: t, excused: true }
      return
    }
    this.away = { since: t, excused: false }
    this.pendingLeaves += 1
    // Уход шлём по обычному интервалу: если ученик так и не вернётся (закрыл
    // вкладку), уход всё равно дойдёт с ближайшей пачкой.
    void this.flush(false)
  }

  /** Ученик вернулся на страницу. */
  back(): void {
    if (this.stopped || !this.away) return
    const t = this.deps.now()
    if (!this.away.excused) this.pendingSeconds += Math.max(0, Math.round((t - this.away.since) / 1000))
    this.away = null
    const sinceFlush = t - this.lastFlush
    void this.flush(sinceFlush >= this.backDebounceMs)
  }

  /** Раз в несколько секунд — отправить накопленное, если пора. */
  tick(): void {
    void this.flush(false)
  }

  /**
   * Конец работы на странице (сдал, окно кончилось, ушёл со страницы работы):
   * незакрытый уход досчитывается до этой секунды, всё накопленное — одной пачкой.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.away && !this.away.excused) {
      this.pendingSeconds += Math.max(0, Math.round((this.deps.now() - this.away.since) / 1000))
    }
    this.away = null
    if (this.inFlight) await this.inFlight
    await this.flush(true)
  }

  private async flush(force: boolean): Promise<void> {
    if (this.pendingLeaves === 0 && this.pendingSeconds === 0) return
    const t = this.deps.now()
    if (!force && t - this.lastFlush < this.minIntervalMs) return
    if (this.inFlight) {
      // Пачка в пути. Возврат (force) не ждёт интервала — дошлём сразу за ней;
      // остальное уйдёт по интервалу.
      if (force) this.resendAfterFlight = true
      return
    }
    const batch = { leaves: this.pendingLeaves, seconds: this.pendingSeconds }
    this.pendingLeaves = 0
    this.pendingSeconds = 0
    this.lastFlush = t
    let failed = false
    this.inFlight = this.deps.send(batch).catch(() => {
      // Сеть не ответила — вернуть в копилку, уйдёт со следующей пачкой.
      failed = true
      this.pendingLeaves += batch.leaves
      this.pendingSeconds += batch.seconds
    }).finally(() => {
      this.inFlight = null
    })
    await this.inFlight
    if (this.resendAfterFlight && !failed) {
      this.resendAfterFlight = false
      await this.flush(true)
    }
  }
}
