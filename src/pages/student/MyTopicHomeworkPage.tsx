import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock, Loader2, RefreshCw,
} from 'lucide-react'
import { useMyTopicHomework } from '@/hooks/useMyTopicHomework'
import {
  JOURNAL_HW_STATUS_LABEL,
  JOURNAL_HW_STATUS_TONE,
  formatHomeworkScore,
  type TopicJournalHomework,
} from '@/lib/topicJournal'
import { cn } from '@/utils/cn'

function formatDue(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function formatWhen(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
}

function HomeworkRow({
  row, href, showScore, showDue,
}: {
  row: TopicJournalHomework
  href: string | null
  showScore?: boolean
  showDue?: boolean
}) {
  const score = showScore ? formatHomeworkScore(row) : null
  const due = formatDue(row.due_at)

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{row.title}</span>
          <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', JOURNAL_HW_STATUS_TONE[row.status])}>
            {JOURNAL_HW_STATUS_LABEL[row.status]}
          </span>
          {row.is_overdue && (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              <AlertTriangle size={11} />
              Просрочено
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-xs text-gray-500">
          {row.course_title} · {row.topic_title}
        </p>

        {showDue && due && (
          <p className={cn('mt-1 inline-flex items-center gap-1 text-xs', row.is_overdue ? 'text-red-600' : 'text-gray-500')}>
            <Clock size={11} />
            Срок: {due}
          </p>
        )}

        {row.status === 'submitted' && formatWhen(row.submitted_at) && (
          <p className="mt-1 text-xs text-gray-400">Сдано {formatWhen(row.submitted_at)}</p>
        )}

        {score && (
          <p className="mt-1.5 inline-block rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            Оценка: {score}
          </p>
        )}

        {row.comment && (
          <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            {row.comment}
          </p>
        )}
      </div>
      {href && <ArrowRight size={16} className="mt-1 shrink-0 text-gray-300" />}
    </>
  )

  const shell = 'flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3.5'

  if (!href) {
    return <li data-testid="my-hw-row" data-status={row.status} className={shell}>{body}</li>
  }

  return (
    <li>
      <Link
        to={href}
        data-testid="my-hw-row"
        data-status={row.status}
        className={cn(shell, 'transition-colors hover:border-primary-300 hover:bg-primary-50/30')}
      >
        {body}
      </Link>
    </li>
  )
}

function Section({
  title, icon, count, tone, empty, children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  tone: string
  empty: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {icon}
        {title}
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', tone)}>{count}</span>
      </h2>
      {count === 0
        ? <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-400">{empty}</p>
        : <ul className="space-y-2">{children}</ul>}
    </section>
  )
}

/**
 * «Домашние задания» ученика — то, чего у него не было вовсе: единый список
 * предстоящих, сданных и проверенных работ.
 *
 * Раньше ДЗ было видно только внутри темы курса (надо было знать, куда идти),
 * а дашборд показывал лишь начатые попытки — предстоящая работа не появлялась
 * нигде. Источник здесь — get_student_topic_journal, единственная RPC,
 * отдающая и ещё не начатое ДЗ.
 */
export function MyTopicHomeworkPage() {
  const { buckets, summary, topicLink, loading, error, reload, noStudentRecord } = useMyTopicHomework()

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загружаем домашние задания…
      </div>
    )
  }

  if (noStudentRecord) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">
        Эта страница — для учеников.
      </div>
    )
  }

  const total = buckets.todo.length + buckets.awaiting.length + buckets.done.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Домашние задания</h1>
          <p data-testid="my-hw-count" className="mt-0.5 text-sm text-gray-500">
            {total === 0
              ? 'Заданий пока нет'
              : buckets.todo.length > 0
                ? `Нужно сделать: ${buckets.todo.length}${summary && summary.hw_overdue > 0 ? ` · просрочено: ${summary.hw_overdue}` : ''}`
                : 'Всё сдано — новых заданий нет'}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-14 text-center">
          <ClipboardList size={28} className="mx-auto text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">Домашних заданий пока нет</p>
          <p className="mt-1 text-xs text-gray-400">Они появятся здесь, как только преподаватель их выдаст</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Section
            title="Нужно сделать"
            icon={<ClipboardList size={13} />}
            count={buckets.todo.length}
            tone="bg-orange-100 text-orange-700"
            empty="Ничего не ждёт — все работы сданы"
          >
            {buckets.todo.map(row => (
              <HomeworkRow key={row.homework_id} row={row} href={topicLink(row)} showDue />
            ))}
          </Section>

          <Section
            title="На проверке"
            icon={<Clock size={13} />}
            count={buckets.awaiting.length}
            tone="bg-blue-100 text-blue-700"
            empty="Нет работ, ожидающих проверки"
          >
            {buckets.awaiting.map(row => (
              <HomeworkRow key={row.homework_id} row={row} href={topicLink(row)} />
            ))}
          </Section>

          <Section
            title="Проверено"
            icon={<CheckCircle2 size={13} />}
            count={buckets.done.length}
            tone="bg-emerald-100 text-emerald-700"
            empty="Пока нет проверенных работ"
          >
            {buckets.done.map(row => (
              <HomeworkRow key={row.homework_id} row={row} href={topicLink(row)} showScore />
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}
