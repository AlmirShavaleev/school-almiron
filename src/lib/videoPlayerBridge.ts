/**
 * Протокол player.js поверх postMessage — приёмник событий плеера Bunny (§204).
 *
 * Почему вообще протокол. Видео вставлено iframe'ом чужого происхождения
 * (`TopicMaterialItems`, адрес даёт `getVideoEmbedUrl`): обычные события
 * `<video>` оттуда не видны, `contentDocument` закрыт. Плеер Bunny понимает
 * player.js — страница шлёт в iframe `{ context: 'player.js', version: '0.0.4',
 * method: 'addEventListener', value: '<событие>', listener: '<метка>' }` и
 * получает обратно `{ context: 'player.js', event: '<событие>', value: … }`.
 *
 * Зависимость ради этого не добавляется: протокол — несколько десятков строк,
 * а чужой пакет пришлось бы держать в бандле ученика ради трёх сообщений.
 *
 * **Что здесь проверено только на заглушке.** До боевого Bunny из облака не
 * дотянуться, поэтому точная форма сообщений подтверждается только на проде.
 * Отсюда правило приёмника: всё, что не похоже на ожидаемое, игнорируется
 * МОЛЧА, а при отсутствии событий не записывается ничего. Ошибиться в сторону
 * пустоты здесь дешевле, чем в сторону выдуманных минут.
 *
 * YouTube и Vimeo — это шов, а не реализация: `videoProviderOf` их узнаёт,
 * `supportsWatchTracking` отвечает `false`, и счётчик к ним не цепляется.
 * Свои протоколы (YouTube IFrame API, Vimeo Player API) — отдельная карточка.
 */

export const PLAYERJS_CONTEXT = 'player.js'
export const PLAYERJS_VERSION = '0.0.4'

/** События плеера, на которые подписываемся. Больше не нужно. */
export const PLAYERJS_EVENTS = ['ready', 'play', 'pause', 'ended', 'timeupdate'] as const
export type PlayerJsEventName = (typeof PLAYERJS_EVENTS)[number]

export type VideoProvider = 'bunny' | 'youtube' | 'vimeo' | 'unknown'

/** Кого узнаём по embed-адресу. Разбор Bunny — общий, из `_shared`. */
export function videoProviderOf(embedUrl: string | null | undefined): VideoProvider {
  const raw = (embedUrl ?? '').trim()
  if (!raw) return 'unknown'
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return 'unknown'
  }
  if (host === 'iframe.mediadelivery.net' || host === 'player.mediadelivery.net') return 'bunny'
  if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('youtube-nocookie.com')) return 'youtube'
  if (host.endsWith('vimeo.com')) return 'vimeo'
  return 'unknown'
}

/** Умеем ли считать просмотр у этого плеера. Пока только Bunny — это и есть шов. */
export function supportsWatchTracking(embedUrl: string | null | undefined): boolean {
  return videoProviderOf(embedUrl) === 'bunny'
}

export interface PlayerJsEvent {
  event: PlayerJsEventName | string
  value: unknown
}

/**
 * Разбор входящего сообщения.
 *
 * Строгий нарочно: чужое сообщение на странице (аналитика, расширение, другой
 * встроенный виджет) не должно превратиться в секунды просмотра. Всё, что не
 * несёт `context: 'player.js'` и строкового `event`, — null.
 */
export function parsePlayerJsMessage(raw: unknown): PlayerJsEvent | null {
  let data: unknown = raw
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const obj = data as Record<string, unknown>
  if (obj.context !== PLAYERJS_CONTEXT) return null
  if (typeof obj.event !== 'string' || obj.event === '') return null

  return { event: obj.event, value: obj.value }
}

/** Позиция и длительность из `value` события `timeupdate`. */
export function playerJsTime(value: unknown): { seconds: number; duration: number | null } | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const seconds = obj.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
  const duration = obj.duration
  return {
    seconds,
    duration: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
  }
}

/** Команда подписки на событие — ровно тот вид, что ждёт player.js. */
export function playerJsListenCommand(event: string, listener: string): string {
  return JSON.stringify({
    context: PLAYERJS_CONTEXT,
    version: PLAYERJS_VERSION,
    method: 'addEventListener',
    value: event,
    listener,
  })
}

export interface PlayerJsBridgeOptions {
  /** Куда слать команды и чьи сообщения принимать. */
  iframe: HTMLIFrameElement
  /** Метка подписки: приходит обратно в поле `listener`, полезна в отладке. */
  listener?: string
  onEvent: (event: PlayerJsEvent) => void
  /** Окно, на котором слушаем сообщения. Подменяется в тестах. */
  win?: Window
}

/**
 * Подписка на события плеера в конкретном iframe.
 *
 * Строгая сторона здесь одна, и она входящая: сообщение принимается, только
 * если `event.source` — окно ИМЕННО этого iframe. Иначе на странице с двумя
 * видео события одного ролика легли бы в счётчик другого, а чужой виджет мог
 * бы наговорить ученику минут.
 *
 * Исходящие команды уходят с `targetOrigin = '*'` — и это осознанно. В них нет
 * ничего тайного («подпишите меня на timeupdate»), зато плеер Bunny волен
 * оказаться на другом своём хосте или редиректе, и приколоченный origin дал бы
 * не ошибку, а МОЛЧАНИЕ: команда не ушла, событий нет, просмотров нет. Проверить
 * это на живом Bunny из облака нельзя, поэтому выбран вариант, который не
 * ломается от лишнего предположения.
 *
 * Команды повторяются, пока плеер не ответит `ready`: момент готовности
 * iframe'а со стороны страницы не виден, а одна команда в пустоту означала бы
 * «событий нет» — то есть тихую потерю всех просмотров.
 */
export function attachPlayerJs({ iframe, listener = 'almiron-watch', onEvent, win }: PlayerJsBridgeOptions): () => void {
  const target = win ?? (typeof window !== 'undefined' ? window : undefined)
  if (!target) return () => {}

  let ready = false
  let attempts = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  function send() {
    const contentWindow = iframe.contentWindow
    if (!contentWindow) return
    for (const event of PLAYERJS_EVENTS) {
      try {
        contentWindow.postMessage(playerJsListenCommand(event, listener), '*')
      } catch {
        // Плеер ещё не поднялся — повторим по таймеру.
      }
    }
  }

  function handleMessage(raw: Event) {
    const message = raw as MessageEvent
    if (message.source !== iframe.contentWindow) return
    const parsed = parsePlayerJsMessage(message.data)
    if (!parsed) return
    if (parsed.event === 'ready') {
      ready = true
      stopRetries()
      // На `ready` подписываемся ещё раз: плееры, поднявшиеся позже наших
      // первых команд, до этого момента подписок не видели.
      send()
    }
    onEvent(parsed)
  }

  function stopRetries() {
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
  }

  target.addEventListener('message', handleMessage)
  iframe.addEventListener('load', send)
  send()

  timer = setInterval(() => {
    attempts += 1
    if (stopped || ready || attempts > 20) {
      stopRetries()
      return
    }
    send()
  }, 500)

  return () => {
    stopped = true
    stopRetries()
    target.removeEventListener('message', handleMessage)
    iframe.removeEventListener('load', send)
  }
}
