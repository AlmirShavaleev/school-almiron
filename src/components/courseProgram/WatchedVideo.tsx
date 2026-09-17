import { useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useVideoWatch } from '@/hooks/useVideoWatch'
import type { VideoWatchMark } from '@/hooks/useVideoWatchMarks'
import { isVideoWatched } from '@/lib/videoWatch'

/**
 * Плеер темы со счётчиком просмотра (§204).
 *
 * Один компонент на оба места, где ученик смотрит видео: карточку материала в
 * рубрике (`TopicMaterialItems`) и вкладку «Видео» темы (`TopicPage`). Два
 * плеера уже было — и именно поэтому на вкладке «Видео» адрес Bunny до §204 не
 * превращался в плеер вовсе. Третьей копии не заводим.
 *
 * Вёрстка не менялась: рамку задаёт вызывающий (`frameClassName`), здесь
 * добавились только ссылка на iframe — через неё идёт протокол player.js — и
 * отметка «просмотрено».
 *
 * Минуты ученику не показываются (решение владельца): ему видно только, дошёл
 * он до конца или нет. Отметка собирается из двух источников — записанного в
 * базе просмотра и того, что плеер сообщил прямо сейчас; второе, чтобы после
 * просмотра не приходилось перезагружать страницу ради галочки.
 */
export function WatchedVideo({
  materialId, embed, title, countWatch, watchMark, frameClassName, allow,
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
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [live, setLive] = useState<{ maxPositionSec: number; durationSec: number | null } | null>(null)

  useVideoWatch({
    itemId: materialId,
    embedUrl: embed,
    enabled: countWatch,
    iframeRef,
    onProgress: setLive,
  })

  const watched =
    isVideoWatched(watchMark?.maxPositionSec ?? null, watchMark?.durationSec ?? null) ||
    isVideoWatched(live?.maxPositionSec ?? null, live?.durationSec ?? null)

  return (
    <div className="space-y-2">
      <div className={frameClassName ?? 'aspect-video w-full overflow-hidden rounded-xl bg-black'}>
        <iframe ref={iframeRef} src={embed} title={title} allow={allow} allowFullScreen className="h-full w-full" />
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
