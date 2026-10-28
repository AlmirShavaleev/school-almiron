import { useEffect, useRef, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { Check, Play } from 'lucide-react'
import { useVideoWatch } from '@/hooks/useVideoWatch'
import type { VideoWatchMark } from '@/hooks/useVideoWatchMarks'
import { isVideoWatched } from '@/lib/videoWatch'
import { bunnyThumbnailUrl } from '@/lib/lessonCard'
import { bunnyGuidOf, isPhoneViewport, mountVideo, playUrl, setActiveVideo, useIsActiveVideo } from '@/lib/videoPlayback'
import { noteUrgentNav } from '@/lib/perf/rum'
import { savePagePosition } from '@/lib/pagePosition'
import type { WatchVideoState } from '@/pages/WatchVideoPage'

/**
 * Плеер темы со счётчиком просмотра (§204).
 *
 * Один компонент на оба места, где ученик смотрит видео: карточку материала в
 * рубрике (`TopicMaterialItems`) и плеер урока (`TopicPage`). Третьей копии не
 * заводим.
 *
 * С 27.10 (письмо ЛК_СРОЧНО_видео_на_телефоне_роняет_страницу.md) — **фасад**:
 * до нажатия ▶ никакого iframe, только обложка Bunny (или тёмная плашка с
 * названием) и кнопка. iframe создаётся по нажатию, сразу с автозапуском и
 * без предзагрузки, и живой на странице всегда один (`videoPlayback.ts`):
 * запуск второго ролика снимает первый, его просмотр перед этим дописывается.
 * В уроке до 8 видео, и восемь плееров Bunny разом роняли вкладку на телефоне.
 *
 * С 27.10 (письмо ЛК_СРОЧНО_iPhone_видео_отдельная_страница.md) на телефоне
 * ▶ не создаёт iframe вовсе, а ведёт на лёгкую страницу `/watch/:id`: даже
 * один плеер поверх урока ронял вкладку в Safari на iPhone. Перед переходом
 * запоминаем прокрутку — «назад» возвращает в урок на то же место.
 *
 * Минуты ученику не показываются (решение владельца): ему видно только, дошёл
 * он до конца или нет. Отметка — из записанного в базе просмотра и того, что
 * плеер сообщил прямо сейчас.
 */
export function WatchedVideo({
  materialId, embed, title, countWatch, watchMark, frameClassName, allow, thumbFile,
}: {
  materialId: string
  embed: string
  title: string
  /** Считать просмотр: ученик — да, персонал и предпросмотр — нет. */
  countWatch: boolean
  /** Уже записанный просмотр; undefined — записи нет. */
  watchMark?: VideoWatchMark
  frameClassName?: string
  allow?: string
  /** Имя своей обложки Bunny (§283), если ставили кадр заставки. */
  thumbFile?: string | null
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [live, setLive] = useState<{ maxPositionSec: number; durationSec: number | null } | null>(null)
  const playing = useIsActiveVideo(materialId)
  const [posterFailed, setPosterFailed] = useState(false)

  // Карточка ушла со страницы (свернули раздел, сменили вкладку) — плеер снят.
  useEffect(() => mountVideo(materialId), [materialId])

  useVideoWatch({
    itemId: materialId,
    embedUrl: embed,
    // Счёт — только пока плеер живой: снятие плеера = cleanup с flush().
    enabled: countWatch && playing,
    iframeRef,
    // timeupdate приходит несколько раз в секунду: перерисовываем, только когда
    // позиция сдвинулась на целую секунду или пришла длительность (письмо 19.10).
    onReady: () => noteUrgentNav('play-ready'),
    onProgress: p => setLive(prev =>
      prev && Math.floor(prev.maxPositionSec) === Math.floor(p.maxPositionSec) && prev.durationSec === p.durationSec ? prev : p),
  })

  const watched =
    isVideoWatched(watchMark?.maxPositionSec ?? null, watchMark?.durationSec ?? null) ||
    isVideoWatched(live?.maxPositionSec ?? null, live?.durationSec ?? null)

  const poster = posterFailed ? null : bunnyThumbnailUrl(bunnyGuidOf(embed), undefined, thumbFile)

  // Важным событием (сразу keepalive): обычная пачка раз в 30 с умирала вместе с вкладкой.
  function start() {
    noteUrgentNav('play')
    setActiveVideo(materialId)
  }

  return (
    <div className="space-y-2">
      <div className={frameClassName ?? 'aspect-video w-full overflow-hidden rounded-xl bg-black'}>
        {playing ? (
          <iframe
            ref={iframeRef}
            src={playUrl(embed)}
            title={title}
            allow={allow ?? 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen'}
            allowFullScreen
            {...{ playsinline: 'true' }}
            onLoad={() => noteUrgentNav('play-load')}
            className="h-full w-full"
            data-testid="video-iframe"
          />
        ) : (
          <VideoFacade title={title} poster={poster} onPosterError={() => setPosterFailed(true)}
            materialId={materialId} onStart={start} />
        )}
      </div>
      {watched && (
        <div
          data-testid="video-watched-badge"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
        >
          <Check size={12} className="shrink-0" />
          Просмотрено
        </div>
      )}
    </div>
  )
}

interface FacadeProps {
  title: string
  poster: string | null
  onPosterError: () => void
  materialId: string
  onStart: () => void
}

/** Обложка с ▶. Внутри роутера на телефоне — переход на `/watch/:id`. */
function VideoFacade(props: FacadeProps) {
  return useInRouterContext() ? <RoutedFacade {...props} /> : <FacadeButton {...props} onClick={props.onStart} />
}

function RoutedFacade(props: FacadeProps) {
  const navigate = useNavigate()
  function onClick() {
    if (!isPhoneViewport()) { props.onStart(); return }
    noteUrgentNav('play')
    const from = location.pathname + location.search
    savePagePosition(location.pathname, { y: window.scrollY })
    navigate(`/watch/${props.materialId}`, { state: { from } satisfies WatchVideoState })
  }
  return <FacadeButton {...props} onClick={onClick} />
}

function FacadeButton({ title, poster, onPosterError, onClick }: FacadeProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Смотреть: ${title}`}
      data-testid="video-facade"
      className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-black text-white"
    >
      {poster ? (
        <img src={poster} alt="" loading="lazy" decoding="async" onError={onPosterError}
          className="absolute inset-0 h-full w-full object-cover opacity-90" />
      ) : (
        <span className="absolute inset-x-4 bottom-4 truncate text-left text-sm font-semibold text-white/80">{title}</span>
      )}
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-lg transition-transform group-hover:scale-105">
        <Play size={28} className="ml-1" fill="currentColor" />
      </span>
    </button>
  )
}
