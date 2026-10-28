import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePreviewMode } from '@/store/staffModeStore'
import { useVideoWatch } from '@/hooks/useVideoWatch'
import { getVideoEmbedUrl } from '@/lib/topicMaterialItems'
import { playUrl } from '@/lib/videoPlayback'
import { noteUrgentNav } from '@/lib/perf/rum'

/**
 * Отдельная лёгкая страница просмотра одного ролика (письмо
 * ЛК_СРОЧНО_iPhone_видео_отдельная_страница.md, 27.10).
 *
 * На iPhone ▶ в уроке ронял вкладку: урок с рубриками, картинками и десятками
 * запросов плюс декодер видео — и WebKit убивал процесс страницы. Сам Bunny,
 * открытый напрямую, играет. Поэтому на телефоне ▶ ведёт сюда: шапка «← К
 * уроку», название и ОДИН iframe — без меню кабинета, без запросов урока, без
 * рубрик. Подсчёт просмотра — тот же `useVideoWatch` (§204).
 *
 * Доступ — как у урока: строку материала отдаёт RLS `topic_material_items`;
 * не отдал — «видео недоступно».
 */
export interface WatchVideoState {
  /** Адрес урока, откуда пришли: «← К уроку» без истории (после перезагрузки). */
  from?: string
}

interface VideoRow { id: string; title: string | null; url: string | null; kind: string }

export function WatchVideoPage() {
  const { materialId } = useParams<{ materialId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as WatchVideoState | null)?.from ?? null
  const profile = useAuthStore(s => s.profile)
  const preview = usePreviewMode()
  const [row, setRow] = useState<VideoRow | null | undefined>(undefined)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    if (!materialId) return
    let cancelled = false
    void Promise.resolve(
      supabase.from('topic_material_items').select('id, title, url, kind').eq('id', materialId).maybeSingle(),
    ).then(({ data }) => { if (!cancelled) setRow((data as VideoRow | null) ?? null) },
      () => { if (!cancelled) setRow(null) })
    return () => { cancelled = true }
  }, [materialId])

  const embed = row?.kind === 'video' && row.url ? getVideoEmbedUrl(row.url) : null

  useVideoWatch({
    itemId: materialId ?? '',
    embedUrl: embed,
    enabled: !!embed && profile?.role === 'student' && !preview,
    iframeRef,
    onReady: () => noteUrgentNav('play-ready'),
  })

  function back() {
    // Пришли из урока этой вкладкой — назад по истории: урок поднимет раздел
    // и прокрутку. Открыли адрес напрямую (или после перезагрузки) — на урок.
    if (from && window.history.length > 1) navigate(-1)
    else if (from) navigate(from, { replace: true })
    else navigate('/dashboard', { replace: true })
  }

  const title = row?.title || 'Видео'

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        <button type="button" onClick={back} data-testid="watch-back"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
          <ArrowLeft size={16} />К уроку
        </button>
      </div>
      <div className="mx-auto max-w-3xl px-4 pb-6">
        <h1 className="mb-3 text-base font-semibold leading-snug">{row === undefined ? '' : title}</h1>
        {row === undefined ? (
          <div className="aspect-video w-full animate-pulse rounded-xl bg-white/10" />
        ) : embed ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              ref={iframeRef}
              src={playUrl(embed)}
              title={title}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              {...{ playsinline: 'true' }}
              onLoad={() => noteUrgentNav('play-load')}
              className="h-full w-full"
              data-testid="watch-iframe"
            />
          </div>
        ) : (
          <p data-testid="watch-unavailable" className="rounded-xl bg-white/10 p-4 text-sm text-white/80">
            Видео недоступно. Вернитесь к уроку и попробуйте ещё раз.
          </p>
        )}
      </div>
    </div>
  )
}
