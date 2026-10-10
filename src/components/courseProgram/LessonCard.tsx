import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, BookOpen, CalendarClock, Check, CheckCircle, ClipboardCheck, Clock, ListChecks, Lock, Play, RotateCcw, Upload,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { TopicKindMark } from '@/components/courseProgram/TopicKindMark'
import { LessonFormatMark } from '@/components/courseProgram/LessonFormatMark'
import {
  bunnyThumbnailUrl, lessonChips, lessonStatus, tasksPercent,
  type LessonCardTopic, type LessonChipKey, type LessonTone,
} from '@/lib/lessonCard'
import { mskDateKey } from '@/lib/homeworkDeadline'

/**
 * §274. Карточка урока в разделе курса ученика (вид «Карточки»).
 *
 * Слева — превью видео урока (обложка Bunny) или заглушка с номером; справа —
 * номер, название, плашки «что внутри» и строка состояния (срок ДЗ, «Сдано»,
 * «Просрочено», «Откроется 12 окт»), под ней — полоска задач к уроку.
 *
 * Вся карточка — ссылка на страницу темы (сдача ДЗ тоже там, §10). Закрытая
 * тема — не ссылка, а серая карточка с замком: правило то же `isTopicOpen`
 * (§59), что у списка. Кнопки «Сдать ДЗ» внутри нет — кнопка внутри ссылки
 * недопустима, и вела она туда же.
 */

export interface LessonCardData extends LessonCardTopic {
  id: string
  title: string
  kind?: string | null
  video_guid?: string | null
  video_thumb?: string | null
}

const TONE: Record<LessonTone, { cls: string; icon: React.ReactNode }> = {
  locked: { cls: 'text-graphite-500', icon: <Lock size={13} aria-hidden /> },
  done: { cls: 'text-verdict-ok-ink', icon: <CheckCircle size={13} aria-hidden /> },
  wait: { cls: 'text-verdict-unk-ink', icon: <Clock size={13} aria-hidden /> },
  warn: { cls: 'text-verdict-part-ink', icon: <RotateCcw size={13} aria-hidden /> },
  bad: { cls: 'text-verdict-bad-ink', icon: <AlertCircle size={13} aria-hidden /> },
  todo: { cls: 'text-primary-700', icon: <CalendarClock size={13} aria-hidden /> },
  none: { cls: 'text-graphite-500', icon: null },
}

const CHIP_ICON: Record<LessonChipKey, React.ReactNode> = {
  video: <Play size={11} aria-hidden />,
  theory: <BookOpen size={11} aria-hidden />,
  tasks: <ListChecks size={11} aria-hidden />,
  homework: <Upload size={11} aria-hidden />,
  test: <ClipboardCheck size={11} aria-hidden />,
}

export function LessonCard({
  topic, index, href, today, openToday, thumbnailUrl,
}: {
  topic: LessonCardData
  /** Порядковый номер в разделе с нуля — на карточке «Урок N». */
  index: number
  href: string
  /** Сегодня по Москве; по умолчанию — сейчас. Для тестов и снимков. */
  today?: string
  /** День для правила открытости (локальный, как у `isTopicOpen`); по умолчанию — сегодня. */
  openToday?: string
  /** Явное превью (снимки); по умолчанию — обложка Bunny по `video_guid`. */
  thumbnailUrl?: string | null
}) {
  const [nowDay] = useState(() => mskDateKey(Date.now()))
  const day = today ?? nowDay
  const status = lessonStatus(topic, day, openToday)
  const locked = status?.tone === 'locked'
  const chips = lessonChips(topic)
  const pct = locked ? null : tasksPercent(topic)
  const done = !locked && topic.hw_status === 'accepted'
  const number = index + 1
  const thumb = thumbnailUrl !== undefined ? thumbnailUrl : bunnyThumbnailUrl(topic.video_guid, undefined, topic.video_thumb)

  const body = (
    <>
      <LessonThumb number={number} src={locked ? null : thumb} hasVideo={topic.sections.has('video')} locked={locked} done={done} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-graphite-500">
          Урок {number}
          <TopicKindMark kind={topic.kind} />
          <LessonFormatMark format={topic.lesson_format} kind={topic.kind} />
        </span>
        <span
          className={cn(
            'line-clamp-3 break-words text-[15px] font-extrabold leading-snug sm:text-[17px]',
            locked ? 'text-graphite-500' : 'text-graphite-950 group-hover:text-primary-700',
          )}
          data-testid="lesson-card-title"
        >
          {topic.title}
        </span>
        {!locked && chips.length > 0 && (
          <span className="flex flex-wrap gap-1" data-testid="lesson-chips">
            {chips.map(c => (
              <span
                key={c.key}
                data-chip={c.key}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-graphite-100 px-2 py-0.5 text-[11px] font-bold text-graphite-700 sm:px-2.5 sm:py-1 sm:text-xs"
              >
                {CHIP_ICON[c.key]}{c.label}
              </span>
            ))}
          </span>
        )}
        {status && (
          <span
            className={cn('mt-auto inline-flex items-center gap-1 text-[13px] font-bold sm:text-sm', TONE[status.tone].cls)}
            data-testid="lesson-status"
            data-tone={status.tone}
          >
            {TONE[status.tone].icon}{status.label}
          </span>
        )}
        {pct != null && (
          <span className="flex items-center gap-2 text-[11px] font-semibold text-graphite-500">
            <span
              className="block h-1.5 flex-1 overflow-hidden rounded-full bg-graphite-100"
              role="progressbar"
              aria-label="Задачи к уроку"
              aria-valuemin={0}
              aria-valuemax={topic.tasks_total}
              aria-valuenow={topic.tasks_closed}
            >
              <i className={cn('block h-full rounded-full', pct >= 100 ? 'bg-verdict-ok' : 'bg-primary-500')} style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular-nums">{topic.tasks_closed}/{topic.tasks_total}</span>
          </span>
        )}
      </span>
    </>
  )

  const cls = cn(
    // §274.1: крупнее и одной высоты в ряду (h-full) — владелец: «ячейка маленькая».
    'group flex h-full w-full min-h-[132px] gap-3 rounded-card border p-3 transition-all duration-150 sm:min-h-[176px] sm:gap-4 sm:p-4',
    locked
      ? 'cursor-default border-graphite-200 bg-graphite-50'
      : 'border-graphite-200 bg-white shadow-card hover:-translate-y-px hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
    status?.tone === 'bad' && 'border-verdict-bad/40',
  )

  if (locked) {
    return (
      <div className={cls} data-testid="lesson-card" data-locked>
        {body}
      </div>
    )
  }
  return (
    <Link
      to={href}
      className={cls}
      data-testid="lesson-card"
      aria-label={`Урок ${number}: ${topic.title}${status ? `. ${status.label}` : ''}`}
    >
      {body}
    </Link>
  )
}

/**
 * Превью: обложка видео либо заглушка (мягкий градиент, крупный номер, тонкая
 * «доска» с линиями). Обложка не загрузилась — тоже заглушка.
 * §277: та же обложка — у карточки темы учителя (вкладка «Курс»).
 */
export function LessonThumb({ number, src, hasVideo, locked, done }: {
  number: number; src: string | null; hasVideo: boolean; locked: boolean; done: boolean
}) {
  const [failed, setFailed] = useState(false)
  const showImg = !!src && !failed
  return (
    <span
      className={cn(
        'relative aspect-[4/3] w-[112px] shrink-0 self-start overflow-hidden rounded-2xl sm:aspect-[4/3] sm:w-[184px]',
        locked ? 'bg-graphite-100' : 'bg-gradient-to-br from-primary-50 via-primary-100 to-gold-50',
      )}
      data-testid="lesson-thumb"
      data-kind={showImg ? 'video' : 'placeholder'}
      aria-hidden
    >
      {showImg ? (
        <img src={src!} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <>
          <svg viewBox="0 0 160 90" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
            <circle cx="138" cy="14" r="26" className={locked ? 'fill-graphite-200' : 'fill-gold-200/70'} />
            <path d="M14 66 H72 M14 76 H52" strokeWidth="4" strokeLinecap="round" className={locked ? 'stroke-graphite-200' : 'stroke-primary-200'} />
            <path d="M96 70 l14 -18 l12 12 l16 -24" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className={locked ? 'stroke-graphite-200' : 'stroke-primary-300'} />
          </svg>
          <span className={cn(
            'absolute left-2.5 top-1.5 text-[34px] font-extrabold leading-none tabular-nums sm:left-3 sm:top-2 sm:text-[40px]',
            locked ? 'text-graphite-300' : 'text-primary-600',
          )}>
            {number}
          </span>
        </>
      )}
      {hasVideo && !locked && (
        <span className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-primary-700 shadow-sm">
          <Play size={13} className="translate-x-px" fill="currentColor" />
        </span>
      )}
      {locked && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-graphite-500"><Lock size={15} /></span>
        </span>
      )}
      {done && (
        <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-verdict-ok text-white shadow-sm">
          <Check size={14} strokeWidth={3} />
        </span>
      )}
    </span>
  )
}
