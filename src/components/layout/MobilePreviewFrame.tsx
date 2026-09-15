import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { Smartphone, X } from 'lucide-react'
import {
  MOBILE_PREVIEW_FRAME_NAME,
  MOBILE_PREVIEW_HEIGHT,
  MOBILE_PREVIEW_PARAM,
  MOBILE_PREVIEW_SYNC_MS,
  MOBILE_PREVIEW_WIDTH,
  useMobilePreview,
} from '@/store/staffModeStore'

/**
 * «Мобильный вид» (§181): текущий экран как на телефоне.
 *
 * Это iframe 390×844 с тем же приложением, а не CSS. Вёрстка отзывчива по
 * ширине ОКНА (`md:`, `lg:` — media queries смотрят на viewport), сузить
 * контейнер внутри страницы недостаточно: «телефонная» вёрстка не включится.
 * У iframe свой viewport — включается всё честно: сайдбар-шторка, нижние
 * панели, лента задач. Origin тот же, значит сессия Supabase и режим роли
 * (`staffModeStore`) внутри те же самые: это второе окно того же приложения
 * тем же человеком, ничего не подменяется, новых прав нет.
 *
 * Рисуется ВМЕСТО обычного дерева кабинета (сайдбар, шапка, `<main>`), а не
 * поверх: внешней навигации в этом состоянии нет, и страницы снаружи ничего
 * не запрашивают дважды.
 */

/** Рамка «телефона» вокруг экрана и полоса сверху — для расчёта масштаба. */
const BEZEL = 12
const BAR_HEIGHT = 44
const GAP = 24

const FRAME_WIDTH  = MOBILE_PREVIEW_WIDTH  + BEZEL * 2
const FRAME_HEIGHT = MOBILE_PREVIEW_HEIGHT + BEZEL * 2

/** Путь внешнего окна без нашего параметра: `pathname + search + hash`. */
function stripPreviewParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search)
  params.delete(MOBILE_PREVIEW_PARAM)
  const rest = params.toString()
  return pathname + (rest ? '?' + rest : '') + hash
}

/** Адрес для iframe: тот же путь, плюс `?mobile-preview=1`, hash в конце. */
function mobilePreviewSrcOf(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  const params = new URLSearchParams(location.search)
  params.set(MOBILE_PREVIEW_PARAM, '1')
  return location.pathname + '?' + params.toString() + location.hash
}

/**
 * Куда дошёл человек внутри «телефона». Origin один, поэтому
 * `contentWindow.location` читается напрямую; `about:blank` (окно ещё не
 * загрузилось) и всё, что не начинается с `/`, — «ещё не знаем».
 */
function innerPathOf(frame: HTMLIFrameElement | null): string | null {
  try {
    const loc = frame?.contentWindow?.location
    if (!loc || loc.href === 'about:blank' || !loc.pathname.startsWith('/')) return null
    return stripPreviewParam(loc.pathname, loc.search, loc.hash)
  } catch {
    // Чужой origin бросил бы — но у нас он свой; на всякий случай молчим.
    return null
  }
}

/**
 * Масштаб, чтобы телефон помещался целиком: оболочка обязана влезать в ноутбук
 * 1280×720, а рамка выше 900px. `transform: scale` с origin в левом верхнем
 * углу, а обёртка — уже отмасштабированного размера: так центрирование и
 * прокрутка считаются по тому, что видно, а не по исходным 414×868.
 */
function fitScale(): number {
  if (typeof window === 'undefined') return 1
  const availH = window.innerHeight - BAR_HEIGHT - GAP * 2
  const availW = window.innerWidth - GAP * 2
  const scale = Math.min(1, availH / FRAME_HEIGHT, availW / FRAME_WIDTH)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

function useFitScale(): number {
  const [scale, setScale] = useState(fitScale)
  useEffect(() => {
    const onResize = () => setScale(fitScale())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

export function MobilePreviewFrame() {
  const { setEnabled } = useMobilePreview()
  const navigate = useNavigate()
  const location = useLocation()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const scale = useFitScale()

  // Адрес iframe фиксируется на момент включения: если бы он следовал за
  // внешним `location`, каждая синхронизация адреса ниже перезагружала бы
  // «телефон».
  const [src] = useState(() => mobilePreviewSrcOf(location))
  const lastSynced = useRef(stripPreviewParam(location.pathname, location.search, location.hash))

  // Адрес синхронизируется внутрь → наружу, минимально: React Router внутри
  // ходит через pushState, `popstate` на это не приходит, поэтому — опрос
  // раз в 500 мс. Внешний адрес меняем через роутер (`replace`), а не голым
  // `history.replaceState`: тогда «Выйти» рисует обычное дерево уже на нужном
  // адресе, а F5 снова показывает телефон там, куда человек дошёл. Outlet в
  // этом состоянии не рисуется — сторожа маршрутов снаружи не срабатывают.
  useEffect(() => {
    const id = window.setInterval(() => {
      const inner = innerPathOf(frameRef.current)
      if (inner && inner !== lastSynced.current) {
        lastSynced.current = inner
        navigate(inner, { replace: true })
      }
    }, MOBILE_PREVIEW_SYNC_MS)
    return () => window.clearInterval(id)
  }, [navigate])

  function handleExit() {
    // Последняя сверка перед выходом — чтобы не ждать следующего тика.
    const inner = innerPathOf(frameRef.current)
    setEnabled(false)
    if (inner && inner !== lastSynced.current) navigate(inner, { replace: true })
  }

  return (
    <div
      data-testid="mobile-preview-shell"
      className="fixed inset-0 z-40 flex flex-col bg-slate-800 text-white"
    >
      {/* Полоса сверху — тёмная, не жёлтая: жёлтая занята предпросмотром
          ученика (§178), и внутри «телефона» она рисуется как обычно. */}
      <div
        role="status"
        data-testid="mobile-preview-bar"
        className="flex shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 text-sm md:px-6"
        style={{ height: BAR_HEIGHT }}
      >
        <Smartphone size={16} className="shrink-0 text-slate-300" />
        <span className="font-semibold">Мобильный вид</span>
        <span className="text-slate-400">· {MOBILE_PREVIEW_WIDTH}×{MOBILE_PREVIEW_HEIGHT} · экран как на телефоне</span>
        <button
          type="button"
          onClick={handleExit}
          data-testid="mobile-preview-exit"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
        >
          <X size={13} />
          Выйти из мобильного вида
        </button>
      </div>

      <div className="flex flex-1 min-h-0 items-start justify-center overflow-auto" style={{ padding: GAP }}>
        {/* Обёртка ровно под отмасштабированную рамку — иначе scale оставил бы
            под телефоном пустоту в исходный размер и прокрутку. */}
        <div style={{ width: FRAME_WIDTH * scale, height: FRAME_HEIGHT * scale, flexShrink: 0 }}>
          <div
            className="overflow-hidden rounded-[40px] border-[3px] border-slate-950 bg-slate-950 shadow-2xl shadow-black/60"
            style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, padding: BEZEL - 3, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <iframe
              ref={frameRef}
              src={src}
              name={MOBILE_PREVIEW_FRAME_NAME}
              title="Мобильный вид"
              width={MOBILE_PREVIEW_WIDTH}
              height={MOBILE_PREVIEW_HEIGHT}
              className="block rounded-[30px] bg-white"
              style={{ width: MOBILE_PREVIEW_WIDTH, height: MOBILE_PREVIEW_HEIGHT, border: 0 }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
