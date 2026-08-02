import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, ClipboardList, Clock, Loader2, RefreshCw,
} from 'lucide-react'
import { useMyTopicHomework } from '@/hooks/useMyTopicHomework'
import {
  JOURNAL_HW_STATUS_LABEL,
  JOURNAL_HW_STATUS_TONE,
  formatHomeworkScore,
  type TopicJournalHomework,
} from '@/lib/topicJournal'
import { dueUrgency } from '@/lib/topicHomework'
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

function pluralizeDays(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня'
  return 'дней'
}

function getDueText(urgency: ReturnType<typeof dueUrgency>): string {
  switch (urgency.level) {
    case 'calm':
      return `осталось ${urgency.days} ${pluralizeDays(urgency.days)}`
    case 'soon':
      if (urgency.days === 0) return 'сдать сегодня'
      return `осталось ${urgency.days} ${pluralizeDays(urgency.days)}`
    case 'overdue':
      if (urgency.days === 0) return 'срок истёк сегодня'
      return `просрочено на ${urgency.days} ${pluralizeDays(urgency.days)}`
    default:
      return ''
  }
}

function getDueTone(level: string): string {
  switch (level) {
    case 'calm':
      return 'text-gray-600'
    case 'soon':
      return 'text-amber-600'
    case 'overdue':
      return 'text-red-600'
    default:
      return 'text-gray-500'
  }
}

function HomeworkRow({
  row, href, showScore, showDue, action,
}: {
  row: TopicJournalHomework
  href: string | null
  showScore?: boolean
  showDue?: boolean
  action?: 'submit' | 'open'
}) {
  const score = showScore ? formatHomeworkScore(row) : null
  const urgency = showDue ? dueUrgency(row.due_at) : null

  // Только показывать row.title, если он осмысленный (не равен 'Домашнее задание')
  const hasCustomTitle = row.title.trim() !== 'Домашнее задание'

  const body = (
    <>
      <div className="min-w-0 flex-1">
        {/* Заголовок с темой */}
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-gray-900">{row.topic_title}</h3>
          {/* Статус — одна плашка, приоритет на is_overdue */}
          {row.is_overdue ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              <AlertTriangle size={11} />
              Просрочено
            </span>
          ) : (
            <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', JOURNAL_HW_STATUS_TONE[row.status])}>
              {JOURNAL_HW_STATUS_LABEL[row.status]}
            </span>
          )}
          {/* Оценка справа от заголовка, если есть */}
          {score && (
            <span className="ml-auto rounded-lg bg-emerald-50 px-2.5 py-1 text-sm font-bold text-emerald-700">
              {score}
            </span>
          )}
        </div>

        {/* Курс мелким текстом под заголовком */}
        <p className="mt-1 truncate text-xs text-gray-500">
          {row.course_title}
          {hasCustomTitle && ` · ${row.title}`}
        </p>

        {/* Срок с цветом по urgency */}
        {showDue && urgency && urgency.level !== 'none' && (
          <p className={cn('mt-1 inline-flex items-center gap-1 text-xs', getDueTone(urgency.level))}>
            <Clock size={11} />
            {getDueText(urgency)}
          </p>
        )}

        {/* Когда сдано */}
        {row.status === 'submitted' && formatWhen(row.submitted_at) && (
          <p className="mt-1 text-xs text-gray-400">Сдано {formatWhen(row.submitted_at)}</p>
        )}

        {/* Комментарий преподавателя с подписью */}
        {row.comment && (
          <div className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            <span className="font-bold">Комментарий преподавателя: </span>
            {row.comment}
          </div>
        )}
      </div>

      {/* Кнопка действия справа */}
      {href && action && (
        <span className={cn(
          'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
          action === 'submit'
            ? row.is_overdue
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-gray-900 text-white hover:bg-gray-950'
            : 'border border-gray-200 text-gray-600 bg-white hover:border-gray-300'
        )}>
          {action === 'submit' ? 'Сдать' : 'Открыть'}
        </span>
      )}
    </>
  )

  const shell = 'flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5'

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
  if (count === 0) {
    return null
  }

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {icon}
        {title}
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', tone)}>{count}</span>
      </h2>
      <ul className="space-y-2">{children}</ul>
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
          {/* Если нужно сделать пусто, но есть другие — зелёная строка */}
          {buckets.todo.length === 0 && (buckets.awaiting.length > 0 || buckets.done.length > 0) && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              ✓ Всё сдано — новых заданий нет
            </div>
          )}

          <Section
            title="Нужно сделать"
            icon={<ClipboardList size={13} />}
            count={buckets.todo.length}
            tone="bg-orange-100 text-orange-700"
            empty="Ничего не ждёт — все работы сданы"
          >
            {buckets.todo.map(row => (
              <HomeworkRow
                key={row.homework_id}
                row={row}
                href={topicLink(row)}
                showDue
                action="submit"
              />
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
              <HomeworkRow
                key={row.homework_id}
                row={row}
                href={topicLink(row)}
                action="open"
              />
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
              <HomeworkRow
                key={row.homework_id}
                row={row}
                href={topicLink(row)}
                showScore
                action="open"
              />
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}
