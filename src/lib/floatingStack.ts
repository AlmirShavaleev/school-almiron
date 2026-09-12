/**
 * Плавающие элементы правого нижнего угла: один стек, одни координаты.
 *
 * До board/007 каждый такой элемент задавал `fixed bottom-… right-…` у себя
 * в файле: «Подборка · N» (`bottom-6 right-6 z-40`) ложилась поверх кнопки
 * «Сообщить о проблеме» (`bottom-5 right-5 z-40`), и кнопка помощи под ней
 * не нажималась. Теперь координаты живут в `index.css`
 * (`--fab-edge`/`--fab-gap`/`--fab-slot-*`), а элементы берут ГОТОВЫЙ СЛОТ.
 *
 * Порядок слотов снизу вверх:
 *   0 — кнопка помощи. Она есть на каждой странице, поэтому именно она якорь
 *       угла: иначе при очистке корзины прыгала бы кнопка, которая нужна
 *       всегда.
 *   1 — «Подборка · N». Появляется только в каталоге и только с непустой
 *       корзиной.
 *   2 — плашки-уведомления.
 *
 * Панель помощи в открытом виде намеренно НЕ в стеке: у неё свой `z-50`,
 * она перекрывает стек целиком — так и задумано.
 */
export const FAB_SLOT = {
  /** Кнопка «Сообщить о проблеме» — низ стека. */
  help: 'fab-slot fab-slot-0 z-40',
  /** «Подборка · N» — над кнопкой помощи. */
  cart: 'fab-slot fab-slot-1 z-40',
  /** Плашка-уведомление — над подборкой. */
  toast: 'fab-slot fab-slot-2 z-50',
} as const

/**
 * Элементы, поверх органов управления которых стек вставать не должен.
 * Плеер темы — `<iframe allowfullscreen>`: его кнопка «во весь экран» сидит
 * в правом нижнем углу кадра ровно под кнопкой помощи (обращение ученика
 * 09.09). `data-fab-obstacle` — ручная пометка для будущих случаев.
 */
export const FAB_OBSTACLE_SELECTOR = 'iframe[allowfullscreen], video, [data-fab-obstacle]'

/** Зона стека в правом нижнем углу, в пикселях: ширина × высота. */
const ZONE_WIDTH = 260
const ZONE_HEIGHT = 190

export interface FabViewport { width: number; height: number }
export interface FabRect { left: number; right: number; top: number; bottom: number }

/**
 * Сторона, на которой стеку место при данных препятствиях.
 * `'left'` — правый угол занят плеером, уходим влево; `null` — угол свободен.
 *
 * Чистая функция: геометрию считает вызывающий, её же проверяют тесты —
 * в jsdom настоящих размеров нет.
 */
export function dodgeSideFor(rects: FabRect[], viewport: FabViewport): 'left' | null {
  const zoneLeft = viewport.width - ZONE_WIDTH
  const zoneTop = viewport.height - ZONE_HEIGHT

  const hit = rects.some(r =>
    r.right > zoneLeft && r.left < viewport.width &&
    r.bottom > zoneTop && r.top < viewport.height
  )

  return hit ? 'left' : null
}

/** Снимает со страницы препятствия и переставляет стек. Возвращает сторону. */
export function syncFloatingStackSide(doc: Document = document): 'left' | null {
  const view = doc.defaultView
  if (!view) return null

  const rects = Array.from(doc.querySelectorAll(FAB_OBSTACLE_SELECTOR))
    .map(el => el.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0)

  const side = dodgeSideFor(rects, { width: view.innerWidth, height: view.innerHeight })

  if (side) doc.documentElement.dataset.fabSide = side
  else delete doc.documentElement.dataset.fabSide

  return side
}

let started = false

/**
 * Запускает слежение за препятствиями. Вызывается один раз при импорте
 * модуля — то есть на любой странице, где есть хоть один элемент стека.
 * Повторные вызовы безвредны.
 */
export function startFloatingStackDodge(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true

  let frame = 0
  const schedule = () => {
    // Наблюдатель переживает окно: в тестах jsdom сносит window раньше, чем
    // приходит последняя мутация, и без этой проверки падает уже на разборе.
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      if (typeof document === 'undefined') return
      syncFloatingStackSide()
    })
  }

  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  window.addEventListener('resize', schedule, { passive: true })

  // Плеер появляется вместе с вкладкой материалов, а не при загрузке
  // страницы, поэтому одних событий прокрутки мало.
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  schedule()

  return () => {
    window.removeEventListener('scroll', schedule, { capture: true })
    window.removeEventListener('resize', schedule)
    observer.disconnect()
    if (frame) window.cancelAnimationFrame(frame)
    started = false
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  startFloatingStackDodge()
}
