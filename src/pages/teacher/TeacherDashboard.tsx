import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { useTeacherHome } from '@/hooks/useTeacherHome'
import { plural } from '@/lib/plural'
import {
  bannerDate, bannerPhrase, dayLabel, dropRows, homeworkReviewGroups, mockReviewGroups, mskClock,
  overdueWhen, remindLabel, remindNote, remindPlan, reviewGroups, upcomingHref, upcomingText,
  type DropRow, type OverdueRow, type ReviewGroup, type UpcomingRow,
} from '@/lib/teacherHome'
import { cn } from '@/utils/cn'

/**
 * §233. Главная преподавателя — дизайн v2, экран 03.
 *
 * Вместо плиток со статистикой — ответ «что делать сегодня» одной фразой в
 * синем баннере и ОДНА главная кнопка: проверка самой давней работы. Ниже —
 * четыре блока: «На проверке», «Не сдали к сроку» (+ «Напомнить всем»),
 * «Просели», «Ближайшее»; каждая строка ведёт к конкретной работе или ученику.
 * Пустой блок не рисуется: спокойная фраза в баннере говорит это за него.
 *
 * Владелец платформы в режиме учителя видит свои группы (`useMyTeachingScope`
 * внутри `useTeacherHome`); «Панель админа» — отдельный экран, не этот.
 */

const OVERDUE_VISIBLE = 8

export function TeacherDashboard() {
  const { pending, home, loading, error, remind } = useTeacherHome()
  const [sending, setSending] = useState(false)
  const [remindError, setRemindError] = useState<string | null>(null)
  const [showAllOverdue, setShowAllOverdue] = useState(false)

  const groupNameOf = useMemo(() => {
    const by = new Map<string, string[]>()
    for (const g of home.groups) by.set(g.course_id, [...(by.get(g.course_id) ?? []), g.name])
    return (courseId: string) => by.get(courseId)?.join(' · ') ?? null
  }, [home.groups])

  const groups = useMemo(
    () => reviewGroups(homeworkReviewGroups(pending, groupNameOf), mockReviewGroups(home.mock_pending)),
    [pending, groupNameOf, home.mock_pending],
  )
  const pendingTotal = groups.reduce((a, g) => a + g.count, 0)
  const lateTotal = groups.reduce((a, g) => a + g.late, 0)
  const drops = useMemo(() => dropRows(home.series), [home.series])
  const droppedStudents = new Set(drops.map(d => d.studentId)).size
  const plan = useMemo(() => remindPlan(home.overdue), [home.overdue])
  const manyGroups = home.groups.length > 1

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const phrase = bannerPhrase({ pending: pendingTotal, late: lateTotal, overdue: home.overdue, dropped: droppedStudents })
  const oldest = groups[0] ?? null

  async function onRemind() {
    setSending(true)
    setRemindError(null)
    try {
      await remind(Array.from(new Set(home.overdue.map(r => r.student_id))))
    } catch (e) {
      setRemindError(e instanceof Error ? e.message : 'Не удалось отправить напоминания')
    } finally {
      setSending(false)
    }
  }

  const left: ReactNode[] = []
  const right: ReactNode[] = []
  if (groups.length > 0) left.push(<ReviewBlock key="review" groups={groups} total={pendingTotal} />)
  if (home.overdue.length > 0) {
    left.push(
      <OverdueBlock
        key="overdue"
        rows={home.overdue}
        today={home.today}
        plan={plan}
        sending={sending}
        error={remindError}
        showAll={showAllOverdue}
        onShowAll={() => setShowAllOverdue(true)}
        onRemind={onRemind}
      />,
    )
  }
  if (drops.length > 0) right.push(<DropBlock key="drop" rows={drops} showGroup={manyGroups} />)
  if (home.upcoming.length > 0) right.push(<UpcomingBlock key="up" rows={home.upcoming} />)
  const columns = [left, right].filter(c => c.length > 0)

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 sm:space-y-8" data-testid="teacher-home">
      <h1 className="sr-only">Главная</h1>

      <section
        data-testid="teacher-home-banner"
        className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(120deg,#1f55e0_0%,#2d67f5_65%,#3b7bff_100%)] px-5 py-5 text-white shadow-[0_16px_40px_rgba(31,85,224,0.28)] sm:px-[30px] sm:py-[26px]"
      >
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-28 w-28 rounded-full bg-gold-300 sm:-right-[50px] sm:-top-[70px] sm:h-[240px] sm:w-[240px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-10 right-24 h-[90px] w-[90px] rounded-full bg-white/[0.12] sm:right-[150px]" />
        <div className="relative flex flex-col gap-3">
          <p className="pr-16 text-[17px] font-bold text-gold-200 sm:pr-0 sm:text-[19px]">{bannerDate(home.today)}</p>
          <p data-testid="teacher-home-phrase" className="max-w-[640px] text-[19px] font-semibold leading-[1.4] sm:text-2xl">
            {phrase}
          </p>
          {oldest && (
            <div>
              <Link
                to={oldest.oldestHref}
                data-testid="teacher-home-start"
                className="inline-flex min-h-11 items-center rounded-full bg-gold-300 px-[22px] py-2 text-sm font-bold text-graphite-900 shadow-[0_6px_16px_rgba(0,0,0,0.15)] transition hover:bg-gold-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Начать проверку — с самых давних →
              </Link>
            </div>
          )}
        </div>
      </section>

      {error && <p className="rounded-xl bg-verdict-bad-tint px-3 py-2 text-sm text-verdict-bad-ink">Не всё загрузилось: {error}</p>}

      {columns.length > 0 && (
        <div className={cn('grid gap-8 lg:gap-10', columns.length === 2 && 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]')}>
          {columns.map((c, i) => <div key={i} className="flex min-w-0 flex-col gap-7">{c}</div>)}
        </div>
      )}
    </div>
  )
}

function BlockHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
      <h2 className="text-[17px] font-semibold text-graphite-900">{title}</h2>
      {aside}
    </div>
  )
}

const ROW_LINK = 'rounded-md transition-colors hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'

function ReviewBlock({ groups, total }: { groups: ReviewGroup[]; total: number }) {
  return (
    <section data-testid="home-review" className="flex flex-col">
      <BlockHead
        title="На проверке"
        aside={<span className="text-[13px] text-graphite-500">{total} {plural(total, 'работа', 'работы', 'работ')}</span>}
      />
      {groups.map(g => (
        <Link
          key={g.key}
          to={g.href}
          data-testid="home-review-row"
          className={cn('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-graphite-200 py-[11px]', ROW_LINK)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-graphite-900">{g.title}</span>
            <span className="block truncate text-[13px] text-graphite-500">
              {g.groupLine}{g.kind === 'mock' ? ' · пробник, вторая часть' : ''}
            </span>
          </span>
          <span className="text-[13px] text-verdict-bad-ink">
            {g.late > 0 ? `${g.late} ${plural(g.late, 'просрочена', 'просрочены', 'просрочены')}` : ''}
          </span>
          <span className="min-w-7 text-right text-[15px] font-semibold text-graphite-900">{g.count}</span>
        </Link>
      ))}
    </section>
  )
}

function OverdueBlock({
  rows, today, plan, sending, error, showAll, onShowAll, onRemind,
}: {
  rows: OverdueRow[]
  today: string
  plan: ReturnType<typeof remindPlan>
  sending: boolean
  error: string | null
  showAll: boolean
  onShowAll: () => void
  onRemind: () => void
}) {
  const visible = showAll ? rows : rows.slice(0, OVERDUE_VISIBLE)
  const note = remindNote(plan)
  const aside = plan.toSend > 0 ? (
    <button
      type="button"
      data-testid="home-remind"
      onClick={onRemind}
      disabled={sending}
      className="text-[13px] font-medium text-graphite-900 underline decoration-graphite-300 underline-offset-[3px] hover:decoration-primary-600 disabled:cursor-wait disabled:opacity-60"
    >
      {sending ? 'Отправляем…' : remindLabel(plan.toSend)}
    </button>
  ) : plan.lastRemindedAt ? (
    <span data-testid="home-reminded" className="inline-flex items-center gap-1 text-[13px] text-graphite-500">
      <Check size={13} aria-hidden /> Напомнили в {mskClock(plan.lastRemindedAt)}
    </span>
  ) : null

  return (
    <section data-testid="home-overdue" className="flex flex-col">
      <BlockHead title="Не сдали к сроку" aside={aside} />
      {(note || error) && (
        <p data-testid="home-remind-note" className={cn('pb-2 text-[13px]', error ? 'text-verdict-bad-ink' : 'text-graphite-500')}>
          {error ?? note}
        </p>
      )}
      {visible.map(r => (
        <Link
          key={`${r.homework_id}:${r.student_id}`}
          to={`/students/${r.student_id}`}
          data-testid="home-overdue-row"
          className={cn('grid grid-cols-[20px_minmax(0,1fr)] items-center gap-3 border-t border-graphite-200 py-2.5 sm:grid-cols-[20px_minmax(0,1fr)_auto]', ROW_LINK)}
        >
          <VerdictMark state="none" label="не сдано" />
          {/* На телефоне — две строки: имя, ниже «ДЗ · когда»; с sm — как в макете, одной. */}
          <span className="min-w-0">
            <span className="block truncate">
              <span className="text-[15px] font-medium text-graphite-900">{r.student_name}</span>
              <span className="hidden text-[13px] text-graphite-500 sm:inline"> · {r.title}</span>
            </span>
            <span className="block truncate text-[13px] text-graphite-500 sm:hidden">
              {r.title} · {overdueWhen(r.due_date, today)}{r.reminded_at ? ' · напомнили' : ''}
            </span>
          </span>
          <span className="hidden text-right text-[13px] text-graphite-500 sm:block">
            {overdueWhen(r.due_date, today)}
            {r.reminded_at ? ' · напомнили' : null}
          </span>
        </Link>
      ))}
      {!showAll && rows.length > OVERDUE_VISIBLE && (
        <button
          type="button"
          onClick={onShowAll}
          className="self-start border-t border-graphite-200 pt-2.5 text-[13px] font-medium text-primary-600 hover:text-primary-700"
        >
          Показать всех · ещё {rows.length - OVERDUE_VISIBLE}
        </button>
      )}
    </section>
  )
}

function Bars({ row }: { row: DropRow }) {
  return (
    <span
      role="img"
      aria-label={`Последние результаты: ${row.bars.map(b => Math.round(b.value)).join(', ')}`}
      className="flex h-9 items-end gap-[3px]"
    >
      {row.bars.map((b, i) => (
        <span
          key={i}
          data-recent={b.recent ? 'true' : 'false'}
          className={cn('w-[7px] rounded-[1px]', b.recent ? 'bg-verdict-bad' : 'bg-graphite-300')}
          style={{ height: `${b.height}%` }}
        />
      ))}
    </span>
  )
}

function DropBlock({ rows, showGroup }: { rows: DropRow[]; showGroup: boolean }) {
  return (
    <section data-testid="home-drop" className="flex flex-col">
      <BlockHead title="Просели" />
      {rows.map(r => (
        <Link
          key={`${r.studentId}:${r.groupName ?? ''}`}
          to={`/students/${r.studentId}`}
          data-testid="home-drop-row"
          className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-t border-graphite-200 py-3', ROW_LINK)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-graphite-900">
              {r.name}{showGroup && r.groupName ? <span className="text-[13px] font-normal text-graphite-500"> · {r.groupName}</span> : null}
            </span>
            <span className="block text-[13px] leading-[1.45] text-graphite-500">{r.text}</span>
          </span>
          <Bars row={r} />
        </Link>
      ))}
    </section>
  )
}

function UpcomingBlock({ rows }: { rows: UpcomingRow[] }) {
  return (
    <section data-testid="home-upcoming" className="flex flex-col">
      <BlockHead title="Ближайшее" />
      <div className="border-b border-graphite-200">
        {rows.map(u => (
          <Link
            key={`${u.kind}:${u.id}`}
            to={upcomingHref(u)}
            data-testid="home-upcoming-row"
            className={cn('grid gap-0.5 border-t border-graphite-200 py-2.5 text-sm sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3', ROW_LINK)}
          >
            <span className="text-[13px] text-graphite-500 sm:text-sm">{dayLabel(u.day)}</span>
            <span className="line-clamp-2 min-w-0 text-graphite-900">
              {upcomingText(u)}<span className="text-graphite-500"> · {u.group_name}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
