import { Link } from 'react-router-dom'
import { AlertTriangle, RotateCcw, CalendarClock, ListChecks, Sparkles, CheckCircle2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatDueIn, type StudentTodo, type TodoItem } from '@/lib/studentTodo'
import { gradeScaleMax } from '@/lib/topicHomework'

/**
 * «Что мне сдать» — первый экран кабинета ученика.
 *
 * Свёрстано СНАЧАЛА под телефон: одна колонка, крупные цели нажатия, ничего
 * горизонтального. Широкий экран получает две колонки только на `lg`, и это
 * единственное, что меняется, — ученики заходят с телефона.
 *
 * Порядок разделов — по срочности, он же задан вводной: просрочено → вернули
 * → сдать до → тестирования → открылось → проверено. Ссылок на решения здесь
 * нет вовсе: гейт §95 живёт на странице темы, и дублировать его показом
 * «посмотреть решение» в списке дел нельзя.
 */

interface StudentTodoListProps {
  todo:    StudentTodo
  loading: boolean
  error:   string | null
}

export function StudentTodoList({ todo, loading, error }: StudentTodoListProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
        Собираем список дел…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        {error}
      </div>
    )
  }

  if (todo.isClear && todo.checked.length === 0 && todo.newlyOpened.length === 0) {
    return <AllClear />
  }

  return (
    <div className="space-y-4" data-testid="student-todo">
      {todo.isClear && <AllClear compact />}

      <Section
        title="Просрочено"
        icon={<AlertTriangle size={16} />}
        tone="danger"
        count={todo.overdue.length}
      >
        {todo.overdue.map(item => <HomeworkRow key={item.key} item={item} tone="danger" />)}
      </Section>

      <Section
        title="Вернули на доработку"
        icon={<RotateCcw size={16} />}
        tone="warning"
        count={todo.returned.length}
      >
        {todo.returned.map(item => <HomeworkRow key={item.key} item={item} tone="warning" showComment />)}
      </Section>

      <Section
        title="Сдать до"
        icon={<CalendarClock size={16} />}
        tone="neutral"
        count={todo.dueSoon.length}
      >
        {todo.dueSoon.map(item => <HomeworkRow key={item.key} item={item} tone="neutral" />)}
      </Section>

      <Section
        title="Тестирования"
        icon={<ListChecks size={16} />}
        tone="neutral"
        count={todo.tests.length}
      >
        {todo.tests.map(test => (
          <div key={test.assignmentId} className="rounded-xl border border-slate-100 px-3 py-3">
            <div className="font-medium text-graphite-950">{test.testTitle}</div>
            <div className="mt-0.5 text-xs text-slate-500">{test.topicTitle}</div>
          </div>
        ))}
      </Section>

      <Section
        title="Новое открылось"
        icon={<Sparkles size={16} />}
        tone="neutral"
        count={todo.newlyOpened.length}
      >
        {todo.newlyOpened.map(topic => (
          <RowShell
            key={topic.topicId}
            to={topic.groupId ? `/my-course/${topic.groupId}/topic/${topic.topicId}` : null}
          >
            <div className="font-medium text-graphite-950">{topic.topicTitle}</div>
            <div className="mt-0.5 text-xs text-slate-500">{topic.courseTitle}</div>
          </RowShell>
        ))}
      </Section>

      <Section
        title="Проверено"
        icon={<CheckCircle2 size={16} />}
        tone="success"
        count={todo.checked.length}
      >
        {todo.checked.map(verdict => {
          const max = verdict.gradeScale ? gradeScaleMax(verdict.gradeScale) : null
          return (
            <div key={verdict.attemptId} className="rounded-xl border border-slate-100 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-graphite-950">{verdict.homeworkTitle}</div>
                  {verdict.comment && (
                    <div className="mt-1 text-xs text-slate-500 line-clamp-2">{verdict.comment}</div>
                  )}
                </div>
                <span className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                  verdict.decision === 'accepted'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700',
                )}>
                  {verdict.decision === 'accepted'
                    ? (verdict.score != null && max ? `${verdict.score}/${max}` : 'Принято')
                    : 'На доработке'}
                </span>
              </div>
            </div>
          )
        })}
      </Section>
    </div>
  )
}

function AllClear({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="student-todo-clear"
      className={cn(
        'rounded-2xl border border-green-200 bg-green-50/70 text-center',
        compact ? 'px-4 py-3' : 'px-4 py-8',
      )}
    >
      <div className="font-semibold text-green-800">Всё сдано, новых заданий нет</div>
      {!compact && (
        <div className="mt-1 text-sm text-green-700/80">
          Как только преподаватель выдаст работу, она появится здесь.
        </div>
      )}
    </div>
  )
}

const TONE_STYLES = {
  danger:  { head: 'text-red-700',    badge: 'bg-red-100 text-red-700',       card: 'border-red-200' },
  warning: { head: 'text-amber-700',  badge: 'bg-amber-100 text-amber-700',   card: 'border-amber-200' },
  neutral: { head: 'text-graphite-900', badge: 'bg-slate-100 text-slate-600', card: 'border-slate-200' },
  success: { head: 'text-green-700',  badge: 'bg-green-100 text-green-700',   card: 'border-green-200' },
} as const

type Tone = keyof typeof TONE_STYLES

function Section({
  title, icon, tone, count, children,
}: {
  title: string
  icon: React.ReactNode
  tone: Tone
  count: number
  children: React.ReactNode
}) {
  // Пустой раздел не рисуем вовсе: шесть пустых заголовков на телефоне — это
  // экран прокрутки вместо ответа на вопрос «что делать».
  if (count === 0) return null
  const styles = TONE_STYLES[tone]

  return (
    <section className={cn('rounded-2xl border bg-white p-3 sm:p-4', styles.card)}>
      <div className="mb-2 flex items-center gap-2">
        <span className={styles.head}>{icon}</span>
        <h2 className={cn('text-sm font-semibold', styles.head)}>{title}</h2>
        <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-bold', styles.badge)}>{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function RowShell({ to, children }: { to: string | null; children: React.ReactNode }) {
  const className = 'block rounded-xl border border-slate-100 px-3 py-3 transition-colors hover:border-slate-200 hover:bg-slate-50/70'
  if (!to) return <div className={className}>{children}</div>
  return <Link to={to} className={className}>{children}</Link>
}

function HomeworkRow({
  item, tone, showComment = false,
}: {
  item: TodoItem
  tone: Tone
  showComment?: boolean
}) {
  const styles = TONE_STYLES[tone]
  return (
    <RowShell to={item.groupId ? `/my-course/${item.groupId}/topic/${item.topicId}` : null}>
      {/* Колонка на телефоне, строка на планшете и шире: срок под названием
          читается лучше, чем сжатый в угол на 360px. */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="font-medium text-graphite-950">{item.title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {item.topicTitle} · {item.courseTitle}
          </div>
        </div>
        {item.dueAt && (
          <span className={cn(
            'shrink-0 self-start rounded-full px-2 py-0.5 text-xs font-semibold',
            styles.badge,
          )}>
            {formatDueIn(item.days)}
          </span>
        )}
      </div>
      {showComment && item.comment && (
        <div className="mt-2 rounded-lg bg-amber-50/70 px-2.5 py-2 text-xs text-amber-900">
          {item.comment}
        </div>
      )}
    </RowShell>
  )
}
