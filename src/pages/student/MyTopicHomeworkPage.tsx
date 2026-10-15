import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Loader2, RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import { useMyTopicHomework } from '@/hooks/useMyTopicHomework'
import { Sticker } from '@/components/student/skin/Sticker'
import type { BoardRow } from '@/lib/homeworkBoard'
import { useStudentTodo } from '@/hooks/useStudentTodo'
import { useAuthStore } from '@/store/authStore'
import {
  HOMEWORK_SHOW_TITLE, homeworkIdsFor, parseHomeworkShow, type HomeworkShow,
} from '@/lib/studentTodo'
import {
  JOURNAL_HW_STATUS_LABEL,
  JOURNAL_HW_STATUS_TONE,
  formatHomeworkScore,
  type HomeworkCourseOption,
  type TopicJournalHomework,
} from '@/lib/topicJournal'
import { dueUrgency } from '@/lib/topicHomework'
import { getSubjectColor } from '@/lib/subjectColors'
import { cn } from '@/utils/cn'

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

/**
 * Ряд переключателей по курсам. Курсов у ученика единицы, поэтому ряд, а не
 * выпадающий список: выбор виден целиком, попасть пальцем проще. При одном
 * курсе ряда нет вовсе — выбирать не из чего.
 */
function CourseFilter({
  options, active, onPick, total,
}: {
  options: HomeworkCourseOption[]
  active:  string | null
  onPick:  (courseId: string | null) => void
  total:   number
}) {
  if (options.length < 2) return null

  return (
    <div data-testid="my-hw-course-filter" className="flex flex-wrap gap-2">
      <Chip label="Все" count={total} active={active === null} onClick={() => onPick(null)} />
      {options.map(option => (
        <Chip
          key={option.id}
          label={option.title}
          count={option.count}
          dot={getSubjectColor(option.subject).dot}
          active={active === option.id}
          onClick={() => onPick(option.id)}
        />
      ))}
    </div>
  )
}

function Chip({
  label, count, active, onClick, dot,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  dot?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={active ? 'stu-chip is-active' : 'stu-chip'}
    >
      {dot && <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />}
      <span className="max-w-[12rem] truncate">{label}</span>
      <span className="stu-chip-n">{count}</span>
    </button>
  )
}

function HomeworkRow({
  row, href, subject, showScore, showDue, action,
}: {
  row: TopicJournalHomework
  href: string | null
  subject: string | null
  showScore?: boolean
  showDue?: boolean
  action?: 'submit' | 'open'
}) {
  const score = showScore ? formatHomeworkScore(row) : null
  const urgency = showDue ? dueUrgency(row.due_at) : null
  const color = getSubjectColor(subject)

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

        {/* Курс — метка, а не бледная подпись: цвет от предмета, начертание
            заметнее названия работы. Своё название ДЗ остаётся серым хвостом. */}
        {/* `truncate` стоит на ряду-флексе, а text-overflow применяется к
            потомку — поэтому на телефоне название курса резалось по букве и
            без многоточия (§183). Многоточие ставит сама подпись курса, но
            ужимается она только ниже 640px: на компьютере её по-прежнему
            хватает целиком, а сокращается хвост со своим названием работы. */}
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', color.dot)} aria-hidden />
          <span className="truncate font-medium text-gray-700 sm:shrink-0">{row.course_title}</span>
          {hasCustomTitle && <span className="truncate text-gray-500">· {row.title}</span>}
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

  // Полоса слева цветом предмета: в смешанном списке двух курсов карточки
  // различаются краем, ещё до чтения подписи.
  const shell = cn(
    'flex items-center gap-3 rounded-xl border border-gray-200 border-l-4 bg-white p-3.5',
    color.bar,
  )

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
  // Выбранный курс живёт в адресе: ученик уходит в тему сдавать работу и
  // возвращается «назад» — состояние страницы должно вернуться вместе с ней.
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('course')
  // §254. `?show=overdue|returned|soon|later|checked|nodue` — список, который
  // открывает кнопка главной. Состав списка берётся из того же `studentTodo`,
  // что считает кнопку, — число на кнопке и строки здесь не могут разойтись.
  const show = parseHomeworkShow(searchParams.get('show'))
  const profileId = useAuthStore(s => s.profile?.id)
  const { todo, loading: todoLoading } = useStudentTodo(show ? profileId : undefined)

  const {
    buckets, totalRows, courseOptions, activeCourseId, topicLink, courseSubject, lessonCourseIds,
    loading: hwLoading, error, reload, noStudentRecord,
  } = useMyTopicHomework(requested)
  const loading = hwLoading || (show != null && todoLoading)

  const pickCourse = (courseId: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (courseId) next.set('course', courseId)
    else next.delete('course')
    // replace, а не push: иначе «назад» отматывало бы переключения фильтра по
    // одному, вместо возврата на предыдущую страницу.
    setSearchParams(next, { replace: true })
  }

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

  if (show) {
    const all = [...buckets.todo, ...buckets.awaiting, ...buckets.done]
    const byId = new Map(all.map(row => [row.homework_id, row]))
    const rows = homeworkIdsFor(todo, show)
      .map(id => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
    const rest = new URLSearchParams(searchParams)
    rest.delete('show')
    const allHref = `/my-homework${rest.toString() ? `?${rest}` : ''}`
    return (
      <ShowList
        show={show}
        rows={rows}
        allHref={allHref}
        error={error}
        topicLink={topicLink}
        courseSubject={courseSubject}
      />
    )
  }

  const total = buckets.todo.length + buckets.awaiting.length + buckets.done.length
  // Просрочки считаем по видимым строкам, а не по summary журнала: под отбором
  // «просрочено: 3» из другого курса было бы прямой ложью.
  const overdue = buckets.todo.filter(row => row.is_overdue).length
  // «Уроки» — курсы «Мой курс» (ДЗ открытых уроков), «Школа» — школьные группы
  // и контрольные (письмо 15.10, п. 6).
  const isLesson = (row: BoardRow) => lessonCourseIds.has(row.course_id)
  const groups = [
    { key: 'lessons', title: 'Уроки', rows: buckets, filter: isLesson },
    { key: 'school', title: 'Школа', rows: buckets, filter: (r: BoardRow) => !isLesson(r) },
  ].map(g => ({
    key: g.key,
    title: g.title,
    todo: g.rows.todo.filter(g.filter),
    awaiting: g.rows.awaiting.filter(g.filter),
    done: g.rows.done.filter(g.filter),
  })).filter(g => g.todo.length + g.awaiting.length + g.done.length > 0)

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5 pb-10 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="stu-kicker">Учёба</span>
          <h1 className="stu-h2">Домашние задания</h1>
          <p data-testid="my-hw-count" className="stu-muted mt-1 text-[14px]">
            {total === 0
              ? 'Заданий пока нет'
              : buckets.todo.length > 0
                ? `Нужно сделать: ${buckets.todo.length}${overdue > 0 ? ` · просрочено: ${overdue}` : ''}`
                : 'Всё сдано — новых заданий нет'}
          </p>
        </div>
        <button type="button" onClick={reload} className="stu-btn stu-btn-g stu-btn-sm">
          <RefreshCw size={14} />
          Обновить
        </button>
      </div>

      {/* Одно число «сдать» — то же, что бейдж «Домашние задания» в меню (п. 5). */}
      <div className="stu-hw-stats" data-testid="my-hw-stats">
        <div className="stu-card stu-hw-stat is-todo"><b>{buckets.todo.length}</b><span>Сдать</span></div>
        <div className="stu-card stu-hw-stat is-review"><b>{buckets.awaiting.length}</b><span>На проверке</span></div>
        <div className="stu-card stu-hw-stat is-done"><b>{buckets.done.length}</b><span>Принято</span></div>
      </div>

      {error && <div className="stu-card stu-note is-or text-[14px]">{error}</div>}

      <CourseFilter
        options={courseOptions}
        active={activeCourseId}
        onPick={pickCourse}
        total={totalRows}
      />

      {total === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center" data-testid="my-hw-empty">
          <Sticker name="check" size={96} />
          {activeCourseId ? (
            <>
              {/* Отбор ничего не нашёл — это надо сказать словами, иначе пустой
                  экран читается как «задания пропали». */}
              <p data-testid="my-hw-empty-filter" className="stu-h3">По этому курсу заданий нет</p>
              <button type="button" onClick={() => pickCourse(null)} className="stu-link">Показать все курсы</button>
            </>
          ) : (
            <>
              <p className="stu-h3">Домашних заданий пока нет</p>
              <p className="stu-muted text-[14px]">Они появятся здесь, как только откроется урок с ДЗ</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map(g => (
            <HwGroup
              key={g.key}
              title={groups.length > 1 ? g.title : null}
              todo={g.todo}
              awaiting={g.awaiting}
              done={g.done}
              topicLink={topicLink}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Тип ДЗ пилюлей: автопроверка или вторая часть (проверяет преподаватель). */
function TypePill({ row }: { row: BoardRow }) {
  return row.autocheck
    ? <span className="stu-tag t-blue">автопроверка</span>
    : <span className="stu-tag t-grey">2 часть</span>
}

function StatusPill({ row }: { row: BoardRow }) {
  if (row.status === 'submitted') return <span className="stu-tag t-blue" data-testid="hw-status">на проверке</span>
  if (row.status === 'accepted') {
    const score = row.autocheck ? null : formatHomeworkScore(row)
    return <span className="stu-tag t-green" data-testid="hw-status">принято{score ? ` · ${score}` : ''}</span>
  }
  return <span className="stu-tag stu-tag-or" data-testid="hw-status">{row.status === 'returned' ? 'вернули · сдать' : 'сдать'}</span>
}

/**
 * Карточка ДЗ (письмо 15.10, п. 2): курс · раздел · урок, тип, статус, срок;
 * у автопроверки — сколько задач осталось; «Перейти к ДЗ» — урок на вкладке ДЗ.
 */
function HwCard({ row, href }: { row: BoardRow; href: string | null }) {
  const urgency = row.status === 'accepted' || row.status === 'submitted' ? null : dueUrgency(row.due_at)
  const due = urgency ? getDueText(urgency) : null
  return (
    <li className={row.status === 'not_started' || row.status === 'draft' || row.status === 'returned' ? 'stu-card stu-hw is-todo' : 'stu-card stu-hw'} data-testid="my-hw-row" data-status={row.status}>
      <div className="min-w-0 flex-1">
        <p className="stu-muted truncate text-[12.5px] font-semibold">
          {row.course_title}{row.module_title ? ` · ${row.module_title}` : ''}
        </p>
        <h3 className="stu-h3 mt-0.5 break-words text-[16px]">{row.topic_title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TypePill row={row} />
          <StatusPill row={row} />
          {row.autocheck && row.left != null && row.left > 0 && row.total != null && (
            <span className="stu-muted text-[13px]" data-testid="hw-left">осталось {row.left} из {row.total} задач</span>
          )}
          {due && urgency && <span className={cn('text-[13px] font-semibold', getDueTone(urgency.level))}>{due}</span>}
        </div>
        {row.comment && (row.status === 'accepted' || row.status === 'returned') && (
          <p className="stu-muted mt-2 text-[13.5px]" data-testid="hw-comment">
            <b className="text-[var(--ink)]">Комментарий преподавателя:</b> {row.comment}
          </p>
        )}
      </div>
      {href && (
        <Link to={`${href}?tab=homework`} className={row.status === 'accepted' ? 'stu-btn stu-btn-g stu-btn-sm' : 'stu-btn stu-btn-p stu-btn-sm'} data-testid="hw-open">
          Перейти к ДЗ
        </Link>
      )}
    </li>
  )
}

/** Группа «Уроки» / «Школа»: сначала «сдать», потом «на проверке»; «Принято» свёрнуто внизу. */
function HwGroup({ title, todo, awaiting, done, topicLink }: {
  title: string | null
  todo: BoardRow[]
  awaiting: BoardRow[]
  done: BoardRow[]
  topicLink: (row: TopicJournalHomework) => string | null
}) {
  const [showDone, setShowDone] = useState(false)
  return (
    <section className="flex flex-col gap-3" data-testid="my-hw-group">
      {title && <h2 className="stu-kicker">{title}</h2>}
      {todo.length + awaiting.length > 0 && (
        <ul className="flex flex-col gap-3">
          {[...todo, ...awaiting].map(row => <HwCard key={row.homework_id} row={row} href={topicLink(row)} />)}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <button type="button" className="stu-hw-done-toggle stu-focus" aria-expanded={showDone} onClick={() => setShowDone(v => !v)} data-testid="my-hw-done-toggle">
            <CheckCircle2 size={16} aria-hidden />
            Принято: {done.length}
            <span className="stu-muted">{showDone ? 'скрыть' : 'показать'}</span>
          </button>
          {showDone && (
            <ul className="flex flex-col gap-3">
              {done.map(row => <HwCard key={row.homework_id} row={row} href={topicLink(row)} />)}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/**
 * §254. Один список по кнопке главной: «Просрочено», «Сдать за 2 недели»,
 * «Новые оценки»… Над ним — путь ко всем заданиям: отбор не должен
 * запирать ученика в одном списке.
 */
function ShowList({
  show, rows, allHref, error, topicLink, courseSubject,
}: {
  show: HomeworkShow
  rows: TopicJournalHomework[]
  allHref: string
  error: string | null
  topicLink: (row: TopicJournalHomework) => string | null
  courseSubject: (row: TopicJournalHomework) => string | null
}) {
  const title = HOMEWORK_SHOW_TITLE[show]
  const done = show === 'checked'
  return (
    <div className="space-y-5" data-testid="my-hw-show" data-show={show}>
      <div>
        <Link
          to={allHref}
          data-testid="my-hw-show-all"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline"
        >
          <ArrowLeft size={14} />
          Все задания
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-900">{title}</h1>
        <p data-testid="my-hw-count" className="mt-0.5 text-sm text-gray-500">
          {rows.length === 0
            ? 'Здесь пусто'
            : show === 'checked'
              ? `Принято за последние 7 дней: ${rows.length}`
              : show === 'soon'
                ? `Срок в ближайшие 14 дней: ${rows.length}`
                : `Работ: ${rows.length}`}
        </p>
      </div>

      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {rows.length === 0 ? (
        <div data-testid="my-hw-show-empty" className="rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
          <p className="mt-2 text-sm font-medium text-gray-700">В этом списке ничего не осталось</p>
          <Link to={allHref} className="mt-2 inline-block text-xs font-medium text-primary-600 hover:text-primary-700">
            Показать все задания
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => (
            <HomeworkRow
              key={row.homework_id}
              row={row}
              href={topicLink(row)}
              subject={courseSubject(row)}
              showDue={!done}
              showScore={done}
              action={done ? 'open' : 'submit'}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
