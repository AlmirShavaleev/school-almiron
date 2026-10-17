import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { plural } from '@/lib/plural'
import { Sticker } from '@/components/student/skin/Sticker'
import type { StickerName } from '@/components/student/skin/skin'
import { DualRing } from '@/components/student/course/DualRing'
import type { CourseLadder, AccessLine } from '@/lib/myCourses'
import type { HwChips, LessonTile, SectionTile } from '@/lib/courseScreen'

/**
 * Страница курса ученика в стиле ЛК (письмо ЛК_стиль_страница_курса.md, 15.10;
 * макет QJwVY9L5NSenZSVSv8vP9z, версия 2): шапка-карточка с кольцом в два
 * слоя, преподаватель строкой, плитки разделов; в разделе — плитки уроков.
 * Правила — src/lib/courseScreen.ts, источники — те же, что у «Моих курсов».
 */

function stickerFor(subject: string): StickerName {
  const s = subject.toLowerCase()
  if (s.includes('phys') || s.includes('физ')) return 'rocket'
  if (s.includes('math') || s.includes('мат')) return 'calendar'
  return 'book'
}

function Chips({ chips }: { chips: HwChips }) {
  const items = [
    chips.toDo > 0 && <span key="t" className="stu-tag stu-tag-or">{chips.toDo} ДЗ сдать</span>,
    chips.review > 0 && <span key="r" className="stu-tag t-blue">{chips.review} на проверке</span>,
    chips.returned > 0 && <span key="b" className="stu-tag t-or">{chips.returned} вернули</span>,
  ].filter(Boolean)
  if (items.length === 0) return null
  return <div className="flex flex-wrap gap-2" data-testid="course-hw-chips">{items}</div>
}

export function CourseHero({ title, subject, examType, mode, ladder, current, chips, next, access, forecast }: {
  title: string
  subject: string
  examType: string
  mode: 'progress' | 'schedule'
  ladder: CourseLadder | null
  /** «Сейчас идёт раздел «…» — ещё N уроков до конца раздела». */
  current: { title: string; left: number } | null
  chips: HwChips
  next: { title: string; href: string; where: string | null } | null
  access: AccessLine | null
  /** Компактный «Прогноз ЕГЭ» курса (письмо 17.10); только у ЕГЭ по физике/математике. */
  forecast?: ReactNode
}) {
  return (
    <section className="stu-card stu-chero" data-testid="course-hero">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="stu-tag t-blue">{SUBJECT_LABELS[subject] || subject}</span>
            <span className="stu-tag t-or">{EXAM_LABELS[examType] || examType}</span>
            <span className="stu-muted text-[13px]">{mode === 'progress' ? 'по прохождению' : 'по расписанию'}</span>
          </div>
          <h1 className="stu-h2 mt-2 break-words" data-testid="course-title">{title}</h1>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          {forecast}
          <Sticker name={stickerFor(subject)} size={64} />
        </div>
      </div>

      {ladder && (
        <div className="stu-chero-stat">
          <DualRing ladder={ladder} size={104} />
          <div className="min-w-0">
            <p className="text-[17px] font-extrabold" data-testid="course-topics-counter">
              пройдено {ladder.done} из {ladder.total}
              {ladder.available != null && <span className="stu-muted font-medium"> · {ladder.available} можно делать сейчас</span>}
            </p>
            {current && current.left > 0 && (
              <p className="stu-muted mt-1 text-[14px]">Сейчас идёт раздел «{current.title}» — ещё {current.left} {plural(current.left, 'урок', 'урока', 'уроков')} до конца раздела</p>
            )}
            <div className="mt-2"><Chips chips={chips} /></div>
          </div>
        </div>
      )}

      {next && (
        <Link to={next.href} className="stu-btn stu-btn-p stu-chero-cta" data-testid="course-continue">
          <span className="min-w-0 truncate">Продолжить: {next.title}</span>
          {next.where && <small className="shrink-0 font-semibold opacity-85">{next.where}</small>}
        </Link>
      )}

      {access && (
        <div className="stu-mc-access" data-testid="course-access" data-kind={access.kind}>
          <span className="min-w-0">{access.text}</span>
          {access.action && (
            <Link to={access.action.to} className={access.action.primary ? 'stu-btn stu-btn-o stu-btn-sm' : 'stu-link'} data-testid={access.kind === 'trial' ? 'course-demo-buy' : undefined}>
              {access.action.label}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

/** Преподаватель одной строкой; куратор — только если назначен. Email не показываем. */
export function PeopleRow({ teacher, curator }: {
  teacher: { full_name: string; email: string | null; avatar_url?: string | null } | null
  curator: { full_name: string; email: string | null } | null
}) {
  if (!teacher && !curator) return null
  const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <section className="stu-card stu-people" data-testid="course-people">
      {teacher && (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="stu-ava">{teacher.avatar_url ? <img src={teacher.avatar_url} alt="" /> : initials(teacher.full_name)}</span>
          <span className="min-w-0 text-[14.5px]">Преподаватель: <b>{teacher.full_name}</b></span>
          {teacher.email && <a href={`mailto:${teacher.email}`} className="stu-btn stu-btn-g stu-btn-sm ml-auto">Написать</a>}
        </div>
      )}
      {curator && (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="stu-ava">{initials(curator.full_name)}</span>
          <span className="min-w-0 text-[14.5px]">Куратор: <b>{curator.full_name}</b></span>
          {curator.email && <a href={`mailto:${curator.email}`} className="stu-btn stu-btn-g stu-btn-sm ml-auto">Написать</a>}
        </div>
      )}
    </section>
  )
}

const PILL: Record<SectionTile['pill']['kind'], string> = {
  ok: 'stu-tag t-green', hw: 'stu-tag stu-tag-or', open: 'stu-tag t-blue', lock: 'stu-tag t-grey',
}

function Track({ done, open, total, thick }: { done: number; open: number; total: number; thick?: boolean }) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  return (
    <span className={thick ? 'stu-step-t stu-track-lg' : 'stu-step-t'} aria-label={`пройдено ${done} из ${total}, открыто ${open}`}>
      <i className="d" style={{ width: `${pct(done)}%` }} />
      <i className="o" style={{ width: `${pct(open - done)}%` }} />
    </span>
  )
}

/** Плитки разделов (десктоп — 3 в ряд): номер с 1 (у пройденного ✓), статус, полоска в 3 цвета. */
export function SectionTiles({ tiles, onOpen, programNote }: {
  tiles: SectionTile[]
  onOpen: (id: string) => void
  programNote: string
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="program-h">
      <div>
        <h2 id="program-h" className="stu-h2">Программа курса</h2>
        <p className="stu-muted text-[14px]">{programNote}</p>
      </div>
      <div className="stu-sgrid" data-testid="section-tiles">
        {tiles.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className={`stu-card stu-sc is-${t.state} stu-focus`}
            data-testid="module-card"
            data-state={t.state}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="stu-num">{t.state === 'done' ? '✓' : t.n}</span>
              <span className={PILL[t.pill.kind]}>{t.pill.text}</span>
            </span>
            <b className="stu-sc-n">{t.title}</b>
            <span className="stu-muted text-[13px]">{t.subtitle}</span>
            <Track done={t.done} open={t.open} total={t.total} />
            <span className="flex justify-between text-[13px]">
              <span className="stu-muted">Раздел {t.n}</span>
              <b className="tabular-nums">{t.done}/{t.total}</b>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Шапка раздела: «Раздел N · идёт сейчас», название, «пройдено 15 из 24 · 4 открыто», полоска, ДЗ. */
export function SectionHero({ tile, chips, courseTitle, onBack, openLine }: {
  tile: SectionTile
  chips: HwChips
  courseTitle: string
  onBack: () => void
  /** «открыто 5 из 29 · следующие 5 — пн 19 окт» (письмо 16.10). */
  openLine?: string
}) {
  return (
    <>
      <button type="button" onClick={onBack} className="stu-back stu-focus" data-testid="section-back">
        <ArrowLeft size={15} aria-hidden />{courseTitle}
      </button>
      <section className="stu-card stu-chero" data-testid="section-hero">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="stu-tag t-blue">Раздел {tile.n}</span>
            <span className="stu-muted text-[13px]">{tile.state === 'done' ? 'пройден' : tile.state === 'current' ? 'идёт сейчас' : tile.subtitle}</span>
          </div>
          <h1 className="stu-h2 mt-2 break-words">{tile.title}</h1>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[16px] font-extrabold" data-testid="section-counter">
            пройдено {tile.done} из {tile.total}
            {openLine
              ? <span className="stu-muted font-medium"> · {openLine}</span>
              : tile.open > tile.done && <span className="stu-muted font-medium"> · {tile.open - tile.done} открыто</span>}
          </p>
          <Track done={tile.done} open={tile.open} total={tile.total} thick />
          <Chips chips={chips} />
        </div>
      </section>
    </>
  )
}

const LESSON_CLASS: Record<LessonTile['state'], string> = {
  done: 'stu-lt', review: 'stu-lt', hw: 'stu-lt is-hw', open: 'stu-lt', nohw: 'stu-lt', locked: 'stu-lt is-locked',
}
const FOOT: Record<LessonTile['state'], string> = {
  done: 'f-ok', review: 'f-rev', hw: 'f-hw', open: 'f-open', nohw: 'f-open', locked: 'f-lock',
}

/**
 * Плитки уроков раздела (вариант Б, письмо ЛК_стиль_открытие_урока_в_плитке.md,
 * 16.10): внизу плитки — одна строка: статус открытого урока или условие
 * открытия закрытого. Открытый урок — ссылка в урок; закрытый — приглушён,
 * по нажатию подсказка с тем же условием, без перехода.
 */
export function LessonTiles({ lessons, hrefFor }: {
  lessons: Array<{ id: string; title: string; tile: LessonTile }>
  hrefFor: (id: string) => string
}) {
  const [tip, setTip] = useState<string | null>(null)
  useEffect(() => {
    if (!tip) return
    const t = window.setTimeout(() => setTip(null), 2500)
    return () => window.clearTimeout(t)
  }, [tip])
  return (
    <ul className="stu-lgrid" data-testid="lesson-tiles">
      {lessons.map((l, i) => {
        const body = (
          <>
            <span className="stu-muted text-[12px] font-bold">Урок {i + 1}</span>
            <b className="text-[14.5px] leading-snug break-words">{l.title}</b>
            <span className={`stu-lt-foot ${l.tile.overdue ? 'f-bad' : FOOT[l.tile.state]}`} data-testid="lesson-tile-pill">
              {l.tile.compact
                ? <><span className="stu-lt-full">{l.tile.pill}</span><span className="stu-lt-compact" aria-hidden>{l.tile.compact}</span></>
                : l.tile.pill}
            </span>
          </>
        )
        return (
          <li key={l.id} className="relative flex" data-testid="lesson-tile" data-state={l.tile.state} data-overdue={l.tile.overdue || undefined}>
            {l.tile.state === 'locked' ? (
              <button type="button" className={`${LESSON_CLASS.locked} stu-focus text-left`} onClick={() => setTip(tip === l.id ? null : l.id)}
                aria-describedby={tip === l.id ? `tip-${l.id}` : undefined}>
                {body}
              </button>
            ) : (
              <Link to={hrefFor(l.id)} className={`${LESSON_CLASS[l.tile.state]} stu-focus`}>{body}</Link>
            )}
            {tip === l.id && l.tile.tip && (
              <span role="tooltip" id={`tip-${l.id}`} className="stu-lt-tip" data-testid="lesson-tile-tip">{l.tile.tip}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
