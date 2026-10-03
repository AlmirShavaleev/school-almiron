import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Lock } from 'lucide-react'
import { useWorkModeStore } from '@/store/workModeStore'
import { useServerNow } from '@/hooks/useTimedWork'
import { formatCountdown, formatMoscowTime, isTimerWarning } from '@/lib/timedWork'
import {
  WORK_MODE_POLL_MS, closedTitle, msUntilEnd, workGenitive, workHeadline, workPath, type WorkMode,
} from '@/lib/workMode'
import { cn } from '@/utils/cn'

/**
 * §263. Режим работы ученика (макет, вкладка Б): полоса «Идёт проверочная ·
 * до HH:MM · таймер» и закрытые разделы «<Раздел> закрыт до HH:MM ·
 * Вернуться к работе». Сама страница работы (условие, фото, сдача) открыта —
 * у неё свой таймер, полосы там нет; плавающая «Помощь» (сообщения учителю)
 * живёт поверх любой страницы.
 */

/** Держать режим свежим: вход, раз в минуту, возврат на вкладку, ровно в конце окна. */
export function useWorkModeSync(enabled: boolean) {
  const refresh = useWorkModeStore(s => s.refresh)
  const reset = useWorkModeStore(s => s.reset)
  const work = useWorkModeStore(s => s.work)
  const offsetMs = useWorkModeStore(s => s.offsetMs)

  useEffect(() => {
    if (!enabled) { reset(); return }
    void refresh()
    const id = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, WORK_MODE_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, refresh, reset])

  // Конец окна — режим снимается сразу, не дожидаясь минутного опроса.
  const closesAt = work?.closesAt ?? null
  useEffect(() => {
    if (!enabled || !closesAt) return
    const wait = msUntilEnd({ closesAt }, Date.now() + offsetMs)
    const id = window.setTimeout(() => { void refresh() }, Math.min(wait + 1500, 2 ** 31 - 1))
    return () => window.clearTimeout(id)
  }, [enabled, closesAt, offsetMs, refresh])
}

/** Полоса сверху на любой странице, кроме самой работы. */
export function WorkModeStrip({ work, offsetMs, showLink }: { work: WorkMode; offsetMs: number; showLink: boolean }) {
  const now = useServerNow(offsetMs, true)
  const left = Date.parse(work.closesAt) - now
  const warn = isTimerWarning(left)
  return (
    <div
      data-testid="work-mode-strip"
      role="status"
      className={cn(
        'sticky top-16 z-20 -mx-4 mb-3 flex items-center gap-3 px-4 py-2.5 text-white shadow-md sm:-mx-6 sm:px-6 md:-mx-8 md:rounded-b-2xl md:px-8',
        warn ? 'bg-verdict-bad-ink' : 'bg-primary-900',
      )}
    >
      <Clock size={18} className="shrink-0 opacity-80" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] text-primary-100">{workHeadline(work)} · до {formatMoscowTime(work.closesAt)}</div>
        <div className="truncate text-sm font-extrabold">{work.title}</div>
      </div>
      <b className="text-[22px] font-extrabold leading-none tabular-nums" data-testid="work-mode-countdown">{formatCountdown(left)}</b>
      {showLink && (
        <Link
          to={workPath(work)}
          className="hidden min-h-9 items-center rounded-lg bg-white/15 px-3 text-[13px] font-bold hover:bg-white/25 sm:inline-flex"
        >
          К работе
        </Link>
      )}
    </div>
  )
}

const CLOSED_LIST: { text: string; open: boolean }[] = [
  { text: 'Каталог заданий, ответы', open: false },
  { text: 'Теория, конспекты, видео', open: false },
  { text: 'Решения ДЗ, ответы и критерии', open: false },
  { text: 'Другие темы и ДЗ', open: false },
  { text: 'Страница работы, загрузка фото', open: true },
  { text: 'Сообщения учителю (кнопка «Помощь»)', open: true },
]

/** Вместо закрытого раздела. Одна главная кнопка — «Вернуться к работе». */
export function WorkModeClosed({ work, section }: { work: WorkMode; section: string | null }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 py-2" data-testid="work-mode-closed">
      <section className="rounded-[20px] border border-dashed border-graphite-300 bg-white px-5 py-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-verdict-none-tint text-graphite-500">
          <Lock size={20} aria-hidden />
        </span>
        <h1 className="text-[17px] font-extrabold text-graphite-900" data-testid="work-mode-closed-title">{closedTitle(section, work)}</h1>
        <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-graphite-600">
          Во время {workGenitive(work)} закрыты каталог, теория, решения и ответы — и на сайте, и на сервере.
          Как только сдашь работу или время выйдет, всё откроется.
        </p>
        <Link
          to={workPath(work)}
          data-testid="work-mode-back"
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-action hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
        >
          Вернуться к работе
        </Link>
      </section>
      <section className="rounded-[18px] bg-white px-4 py-3 ring-1 ring-graphite-200" aria-labelledby="work-mode-list-title">
        <h2 id="work-mode-list-title" className="mb-1.5 text-[13px] font-extrabold text-graphite-900">Что закрыто на время работы</h2>
        <ul className="divide-y divide-graphite-100 text-[13px]">
          {CLOSED_LIST.map(r => (
            <li key={r.text} className="flex items-center justify-between gap-3 py-1.5">
              <span className={r.open ? 'text-graphite-800' : 'text-graphite-500'}>{r.text}</span>
              <span className={cn('shrink-0 text-xs font-bold', r.open ? 'text-verdict-ok-ink' : 'text-graphite-400')}>
                {r.open ? 'открыто' : 'закрыто'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Предупреждение на странице работы (без счётчика уходов — его видит только учитель). */
export function WorkModeNotice({ className }: { className?: string }) {
  return (
    <p data-testid="work-mode-notice" className={cn('rounded-xl bg-gold-50 px-3 py-2 text-[12.5px] leading-snug text-gold-900', className)}>
      Пока идёт работа, остальной сайт закрыт. Учитель видит, если ты уходишь со страницы работы.
    </p>
  )
}
