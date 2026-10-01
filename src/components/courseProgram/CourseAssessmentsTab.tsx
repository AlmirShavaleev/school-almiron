import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Download, Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useServerNow } from '@/hooks/useServerNow'
import { useCourseAssessmentsSummary } from '@/hooks/useCourseAssessments'
import { useCourseGrades } from '@/hooks/useCourseGrades'
import type { CourseAssessmentsSummary, TeacherAction } from '@/lib/courseAssessments'
import {
  journalMeta, journalSheet, journalView, worksList, worksMeta,
  type CellView, type CourseGrades, type Distribution, type GradeTone, type JournalView,
  type KindFilter, type SortMode, type WorkListRow,
} from '@/lib/courseGrades'
import { SummaryView } from './CourseAssessmentsSummary'
import { CourseMockExamsSection } from './CourseMockExamsSection'

/**
 * §249. Вкладка курса «Проверочные и контрольные» (вместо «Результатов тестов»,
 * макет владельца 01.10):
 *
 * - «Работы» — работы по времени курса по дате: плашка типа, дата, статус,
 *   «сдали X из Y», полоска 5/4/3/2 (+ждут), средний, «Проверить N» → очередь
 *   с фильтром по теме / «Работы» → вкладка ДЗ с раскрытой темой (§241);
 * - «Оценки по ученикам» — журнал ученик × работа с липкой колонкой имён и
 *   прокруткой вбок ВНУТРИ таблицы; нажатие на клетку — строка с работой
 *   ученика и переходом в очередь проверки (`/homework-queue?attempt=`);
 * - «Пробники» — тот же блок, что в сводке §241 (с «Добавить пробник»).
 *
 * Сводка §241 раньше стояла над программой курса — теперь она здесь.
 * Каркас (групп нет) — только список работ, журнала нет.
 */
export function CourseAssessmentsTab({ courseId, isTemplate, groupId, groupName, refreshKey = 0, onOpenTopic, onShowWorks, onGoToProgram }: {
  courseId: string
  isTemplate: boolean
  groupId: string | null
  groupName: string | null
  refreshKey?: number
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
  onGoToProgram: () => void
}) {
  const summary = useCourseAssessmentsSummary(courseId, refreshKey)
  const grades = useCourseGrades(courseId, refreshKey, !isTemplate)
  const now = useServerNow(summary.data?.serverNow ?? grades.data?.serverNow ?? null, 30_000)

  const rows = useMemo(
    () => (summary.data ? worksList(summary.data, grades.data, now) : []),
    [summary.data, grades.data, now],
  )

  const loading = summary.status === 'loading' || summary.status === 'idle'
  if (loading && !summary.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-graphite-500" data-testid="assessments-tab-loading">
        <Loader2 size={18} className="animate-spin" aria-hidden />Загрузка работ…
      </div>
    )
  }

  const noWorks = summary.data ? rows.length === 0 : (grades.data?.works.length ?? 0) === 0

  return (
    <div className="space-y-4" data-testid="assessments-tab">
      {summary.status === 'error' ? (
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-graphite-600" data-testid="assessments-works-error">
          Список работ сейчас не загрузился — обновите страницу чуть позже.
        </p>
      ) : noWorks ? (
        <EmptyWorks isTemplate={isTemplate} onGoToProgram={onGoToProgram} />
      ) : summary.data && (
        <WorksCard rows={rows} summary={summary.data} onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} />
      )}

      {!isTemplate && !noWorks && (
        <JournalCard status={grades.status} data={grades.data} now={now} groupName={groupName} />
      )}

      {!isTemplate && (summary.status === 'error'
        ? (groupId ? <CourseMockExamsSection groupId={groupId} groupName={groupName} /> : null)
        : summary.data && (
          <SummaryView
            data={{ ...summary.data, works: [] }}
            now={now}
            groupName={groupName}
            onOpenTopic={onOpenTopic}
            onShowWorks={onShowWorks}
            title="Пробники"
            emptyText="Пробников пока нет."
            testId="course-mocks"
          />
        ))}
    </div>
  )
}

// ─── Пусто ──────────────────────────────────────────────────────────────────

function EmptyWorks({ isTemplate, onGoToProgram }: { isTemplate: boolean; onGoToProgram: () => void }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center" data-testid="assessments-empty">
      <ClipboardCheck size={32} className="mx-auto mb-3 text-primary-300" aria-hidden />
      <h2 className="text-base font-extrabold text-graphite-900">Проверочных и контрольных пока нет</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-graphite-600">
        Работа по времени — это тема курса с типом «Проверочная работа» или «Контрольная работа».
        Откройте тему в программе курса, в окне темы выберите <b className="font-semibold text-graphite-800">Тип темы</b>,
        {isTemplate ? ' а время назначьте уже в классах.' : ' затем назначьте время в блоке «Домашнее задание».'}
        {' '}Работа появится здесь сама — со сводкой и оценками учеников.
      </p>
      <button
        type="button"
        onClick={onGoToProgram}
        className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-4 text-sm font-bold text-white shadow-action hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
      >
        Открыть программу курса
      </button>
    </section>
  )
}

// ─── Работы ─────────────────────────────────────────────────────────────────

/** Цвета оценок — из утверждённого макета (5 и 4 — два зелёных, 3 — охра, 2 — терракота). */
export const GRADE_CLS: Record<GradeTone, string> = {
  5: 'bg-[#e3f4e8] text-[#15803d]',
  4: 'bg-[#eef6e2] text-[#3f7d1f]',
  3: 'bg-[#fdf1e2] text-[#b45309]',
  2: 'bg-[#fde6dc] text-[#c2410c]',
}
const BAR: { key: keyof Distribution; color: string; label: string }[] = [
  { key: 'five', color: 'bg-[#15803d]', label: '5' },
  { key: 'four', color: 'bg-[#3f7d1f]', label: '4' },
  { key: 'three', color: 'bg-[#b45309]', label: '3' },
  { key: 'two', color: 'bg-[#c2410c]', label: '2' },
]
const WAIT_CLS = 'bg-[#f0eafd] text-[#6d28d9]'

const STATUS_TEXT: Record<WorkListRow['status']['tone'], string> = {
  live: 'text-primary-700',
  soon: 'text-graphite-600',
  check: 'text-[#6d28d9]',
  done: 'text-verdict-ok-ink',
}

function WorksCard({ rows, summary, onOpenTopic, onShowWorks }: {
  rows: WorkListRow[]
  summary: CourseAssessmentsSummary
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  const template = summary.isTemplate
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-labelledby="assessments-works-title" data-testid="assessments-works">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4">
        <h2 id="assessments-works-title" className="text-base font-extrabold text-graphite-900">Работы</h2>
        <span className="text-[13px] text-graphite-600" data-testid="assessments-works-meta">
          {worksMeta(rows, summary)}{template ? ' · каркас: окно, сдача и оценки — в классах' : ''}
        </span>
      </div>
      <ul className="mt-2">
        {rows.map(r => <WorkRow key={r.key} row={r} template={template} onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} />)}
      </ul>
    </section>
  )
}

function WorkRow({ row, template, onOpenTopic, onShowWorks }: {
  row: WorkListRow
  template: boolean
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  // Телефон: название и кнопка — первой строкой, статус и «сдали» — второй,
  // полоска — третьей. С md та же разметка — строка из пяти столбцов.
  return (
    <li
      data-testid="assessments-work-row"
      data-kind={row.kind}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-gray-100 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_104px_minmax(0,1.3fr)_132px]"
    >
      <div className="col-start-1 row-start-1 min-w-0 md:col-start-auto md:row-start-auto">
        <div className="font-bold text-graphite-900">
          <span className={cn('mr-1.5 rounded-md px-1.5 py-px align-[1px] text-[11px] font-extrabold', row.kind === 'check' ? 'bg-primary-50 text-primary-700' : 'bg-[#fde6dc] text-[#c2410c]')}>
            {row.kind === 'check' ? 'Проверочная' : 'КР'}
          </span>
          {row.title}
        </div>
        <div className="text-xs text-graphite-500" data-testid="assessments-work-when">{template ? (row.module ?? '') : row.when}</div>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
        <span className={cn('text-[13px] font-bold', STATUS_TEXT[row.status.tone])} data-testid="assessments-work-status">
          {row.status.text}
          {row.note && <span className="ml-1.5 font-medium text-graphite-500">· {row.note}</span>}
        </span>
        <span className={cn('text-[13px] text-graphite-700 tabular-nums', row.submitted === '—' && 'md:invisible')} data-testid="assessments-work-submitted">
          {row.submitted === '—' ? '' : <>сдали <b className="text-base font-extrabold text-graphite-900">{row.submitted.split(' из ')[0]}</b> из {row.submitted.split(' из ')[1]}</>}
        </span>
      </div>
      <div className={cn('col-span-2 md:col-span-1', !row.dist && 'hidden md:block')}>
        {row.dist && <DistBar dist={row.dist} avg={row.avg} />}
      </div>
      <div className="col-start-2 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
        {row.actions.map(a => <WorkAction key={a.label} action={a} onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} />)}
      </div>
    </li>
  )
}

function DistBar({ dist, avg }: { dist: Distribution; avg: string }) {
  const total = Math.max(dist.total, 1)
  const graded = dist.five + dist.four + dist.three + dist.two
  return (
    <div data-testid="assessments-work-dist">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {BAR.map(b => (dist[b.key] > 0
          ? <i key={b.key} className={cn('block', b.color)} style={{ width: `${(dist[b.key] / total) * 100}%` }} />
          : null))}
        {dist.wait > 0 && <i className="block bg-[#6d28d9] opacity-45" style={{ width: `${(dist.wait / total) * 100}%` }} />}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2.5 text-[11.5px] text-graphite-600 tabular-nums">
        {BAR.map(b => <span key={b.key}>{b.label}: {dist[b.key]}</span>)}
        {dist.wait > 0 && <span>ждут: {dist.wait}</span>}
        <span>средний {graded > 0 ? avg : '—'}</span>
      </div>
    </div>
  )
}

const ACTION_BASE = 'inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-[13px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:min-h-9'
const ACTION_SOFT = `${ACTION_BASE} bg-primary-50 text-primary-700 hover:bg-primary-100`
const ACTION_PLAIN = `${ACTION_BASE} border border-gray-200 bg-white text-graphite-800 hover:border-primary-200`

function WorkAction({ action, onOpenTopic, onShowWorks }: {
  action: TeacherAction
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  switch (action.kind) {
    case 'queue':
      return <Link to={`/homework-queue?topic=${action.topicId}`} className={ACTION_SOFT} data-testid="assessments-work-action">{action.label}</Link>
    case 'mock':
      return <Link to={action.to} className={ACTION_PLAIN} data-testid="assessments-work-action">{action.label}</Link>
    case 'works':
      return <button type="button" onClick={() => onShowWorks(action.topicId)} className={ACTION_PLAIN} data-testid="assessments-work-action">{action.label}</button>
    case 'topic':
      return <button type="button" onClick={() => onOpenTopic(action.topicId)} className={ACTION_PLAIN} data-testid="assessments-work-action">{action.label}</button>
  }
}

// ─── Журнал ─────────────────────────────────────────────────────────────────

function Seg<K extends string>({ label, value, options, onChange, testId }: {
  label: string
  value: K
  options: { key: K; label: string }[]
  onChange: (k: K) => void
  testId: string
}) {
  return (
    <span role="group" aria-label={label} data-testid={testId} className="inline-flex max-w-full flex-wrap overflow-hidden rounded-lg border border-gray-200">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          data-key={o.key}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'min-h-11 px-3 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400 md:min-h-9',
            value === o.key ? 'bg-primary-600 text-white' : 'bg-white text-graphite-600 hover:text-graphite-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

function JournalCard({ status, data, now, groupName }: {
  status: string
  data: CourseGrades | null
  now: number
  groupName: string | null
}) {
  const [sort, setSort] = useState<SortMode>('name')
  const [kind, setKind] = useState<KindFilter>('all')
  const [picked, setPicked] = useState<{ topicId: string; studentId: string } | null>(null)
  const view = useMemo(() => (data ? journalView(data, { kind, sort, nowMs: now }) : null), [data, kind, sort, now])

  const head = (meta?: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4">
      <h2 id="assessments-journal-title" className="text-base font-extrabold text-graphite-900">Оценки по ученикам</h2>
      {meta && <span className="text-[13px] text-graphite-600" data-testid="assessments-journal-meta">{meta}</span>}
    </div>
  )
  const shell = (children: ReactNode, meta?: string) => (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-labelledby="assessments-journal-title" data-testid="assessments-journal">
      {head(meta)}
      {children}
    </section>
  )

  if (!data) {
    return shell(status === 'error'
      ? <p className="px-4 pb-4 pt-2 text-sm text-graphite-600" data-testid="assessments-journal-error">Журнал оценок сейчас недоступен — обновите страницу чуть позже.</p>
      : <p className="flex items-center gap-2 px-4 pb-4 pt-2 text-sm text-graphite-500"><Loader2 size={16} className="animate-spin" aria-hidden />Загрузка оценок…</p>)
  }
  if (!view) return null
  if (data.students.length === 0) {
    return shell(<p className="px-4 pb-4 pt-2 text-sm text-graphite-600" data-testid="assessments-journal-empty">В классе пока нет учеников.</p>)
  }
  if (!view.hasAnyColumns) {
    return shell(<p className="px-4 pb-4 pt-2 text-sm text-graphite-600" data-testid="assessments-journal-empty">Оценки появятся здесь, когда откроется первая работа.</p>, journalMeta(view))
  }

  const pickedIndex = picked ? view.columns.findIndex(c => c.work.topic_id === picked.topicId) : -1
  const pickedRow = picked ? view.rows.find(r => r.student.student_id === picked.studentId) : undefined
  const pickedCell = pickedRow && pickedIndex >= 0 ? pickedRow.cells[pickedIndex] : undefined
  const hasHundred = view.columns.some(c => c.work.grade_scale === 'hundred')

  const download = async () => {
    const { exportAssessmentGrades } = await import('@/utils/exportExcel')
    exportAssessmentGrades(journalSheet(view), groupName)
  }

  return shell(
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
        <Seg label="Порядок" testId="grades-sort" value={sort} onChange={setSort}
          options={[{ key: 'name', label: 'По алфавиту' }, { key: 'weak', label: 'Сначала слабые' }]} />
        <Seg label="Тип работ" testId="grades-kind" value={kind} onChange={k => { setKind(k); setPicked(null) }}
          options={[{ key: 'all', label: 'Все' }, { key: 'check', label: 'Проверочные' }, { key: 'control', label: 'Контрольные' }]} />
        <span className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={() => { void download() }}
          disabled={view.columns.length === 0}
          data-testid="grades-export"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-bold text-graphite-800 hover:border-primary-200 disabled:opacity-50 md:min-h-9"
        >
          <Download size={14} aria-hidden />Скачать таблицу (Excel)
        </button>
      </div>
      <Legend />

      {pickedRow && pickedCell && pickedCell.kind !== 'empty' && (
        <CellDetail name={pickedRow.student.name} title={view.columns[pickedIndex].work.title} cell={pickedCell} />
      )}

      {view.columns.length === 0 ? (
        <p className="border-t border-gray-100 px-4 py-4 text-sm text-graphite-600" data-testid="assessments-journal-filter-empty">
          {kind === 'check' ? 'Проверочных' : 'Контрольных'} в журнале пока нет.
        </p>
      ) : (
        <JournalTable view={view} picked={picked} onPick={(topicId, studentId) => setPicked({ topicId, studentId })} />
      )}
      <p className="px-4 pb-4 pt-2.5 text-[13px] text-graphite-600">
        Нажмите на оценку — откроется работа ученика. Средний считается только по проверенным работам
        {hasHundred ? '; стобалльные переводятся в пятибалльную: 90 % и выше — 5, от 70 % — 4, от 50 % — 3.' : '.'}
      </p>
    </>,
    journalMeta(view),
  )
}

function Legend() {
  const sw = 'inline-block h-3.5 w-3.5 rounded'
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-2.5 text-[12px] text-graphite-600" data-testid="grades-legend">
      {([5, 4, 3, 2] as const).map(t => <span key={t} className="inline-flex items-center gap-1.5"><i className={cn(sw, GRADE_CLS[t])} aria-hidden />{t}</span>)}
      <span className="inline-flex items-center gap-1.5"><i className={cn(sw, WAIT_CLS)} aria-hidden />сдал, ждёт проверки</span>
      <span>— не сдавал</span>
      <span>дораб. — вернули на доработку</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1.5 w-1.5 rounded-full bg-[#c2410c]" aria-hidden />две и больше двоек</span>
    </div>
  )
}

function CellDetail({ name, title, cell }: { name: string; title: string; cell: Exclude<CellView, { kind: 'empty' }> }) {
  const text = cell.kind === 'wait'
    ? (cell.auto ? 'сдано автоматически, ждёт проверки' : 'сдал, ждёт проверки')
    : cell.kind === 'returned' ? 'возвращена на доработку' : cell.text === 'зачёт' ? 'принята' : <>оценка <b className="font-extrabold">{cell.text}</b></>
  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm" data-testid="grades-detail" aria-live="polite">
      <span><b className="font-extrabold">{name}</b> · {title}</span>
      <span>{text}</span>
      <span className="flex-1" />
      {cell.attemptId && (
        <Link to={`/homework-queue?attempt=${cell.attemptId}`} className={ACTION_SOFT} data-testid="grades-detail-open">
          {cell.kind === 'wait' ? 'Проверить' : 'Открыть работу'}
        </Link>
      )}
    </div>
  )
}

const NAME_CELL = 'sticky left-0 z-[1] border-r border-gray-200 px-3 text-left'

function JournalTable({ view, picked, onPick }: {
  view: JournalView
  picked: { topicId: string; studentId: string } | null
  onPick: (topicId: string, studentId: string) => void
}) {
  return (
    <div className="overflow-x-auto border-t border-gray-200" data-testid="grades-scroll">
      <table className="w-full min-w-max border-separate border-spacing-0 tabular-nums" data-testid="grades-table">
        <thead>
          <tr>
            <th className={cn(NAME_CELL, 'bg-white')} aria-hidden />
            {view.groups.map(g => (
              <th key={g.kind} colSpan={g.span} className="bg-white px-1.5 pt-2 text-center text-[11px] font-bold uppercase tracking-wider text-graphite-400" data-testid="grades-group">
                {g.title}
              </th>
            ))}
            <th className="bg-white" aria-hidden />
          </tr>
          <tr>
            <th scope="col" className={cn(NAME_CELL, 'border-b bg-white py-2 align-bottom text-xs font-bold text-graphite-600')}>Ученик</th>
            {view.columns.map(c => (
              <th key={c.work.topic_id} scope="col" className="w-[104px] max-w-[104px] border-b border-gray-200 bg-white px-1.5 py-2 align-bottom text-center text-[12px] font-bold leading-tight text-graphite-900" data-testid="grades-col">
                <span className="block">{c.work.title}</span>
                <span className="mt-0.5 block font-semibold text-graphite-400">{c.dateLabel}</span>
              </th>
            ))}
            <th scope="col" className="border-b border-l border-gray-200 bg-white px-3 py-2 align-bottom text-xs font-bold text-graphite-600">Средний</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, ri) => {
            const zebra = ri % 2 === 1 ? 'bg-slate-50' : 'bg-white'
            return (
              <tr key={r.student.student_id} data-testid="grades-row" data-flagged={r.flagged ? 'true' : 'false'}>
                <th scope="row" className={cn(NAME_CELL, zebra, 'whitespace-nowrap border-b py-0 text-[14px] font-semibold text-graphite-900 min-w-[150px] sm:min-w-[180px]')}>
                  <span data-testid="grades-name">{r.student.name}</span>
                  {r.flagged && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#c2410c] align-[2px]" title="две и больше двоек" data-testid="grades-flag" aria-label="две и больше двоек" role="img" />}
                </th>
                {r.cells.map((c, ci) => {
                  const col = view.columns[ci]
                  const on = picked?.topicId === col.work.topic_id && picked.studentId === r.student.student_id
                  return (
                    <td key={col.work.topic_id} className={cn(zebra, 'border-b border-gray-200 px-1.5 py-1 text-center')}>
                      <GradeCellButton cell={c} on={on} label={`${r.student.name}, ${col.work.title}`} onClick={() => onPick(col.work.topic_id, r.student.student_id)} />
                    </td>
                  )
                })}
                <td className={cn(zebra, 'border-b border-l border-gray-200 px-3 text-center text-[14px] font-extrabold text-graphite-900')} data-testid="grades-avg">
                  {r.avg == null ? '—' : (Math.round(r.avg * 10) / 10).toFixed(1).replace('.', ',')}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr data-testid="grades-class-row">
            <td className={cn(NAME_CELL, 'bg-white py-2 text-[13px] font-extrabold text-graphite-900')}>Средний по классу</td>
            {view.columns.map(c => (
              <td key={c.work.topic_id} className="bg-white px-1.5 py-2 text-center text-[13px] font-bold text-graphite-600" data-testid="grades-class-avg">{c.classAvg}</td>
            ))}
            <td className="border-l border-gray-200 bg-white px-3 py-2 text-center text-[13px] font-extrabold text-graphite-900" data-testid="grades-class-total">
              {view.classAvg == null ? '—' : (Math.round(view.classAvg * 10) / 10).toFixed(1).replace('.', ',')}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function GradeCellButton({ cell, on, label, onClick }: { cell: CellView; on: boolean; label: string; onClick: () => void }) {
  const base = 'inline-grid h-[30px] w-11 place-items-center rounded-lg font-extrabold'
  if (cell.kind === 'empty') {
    return <span className={cn(base, 'font-semibold text-graphite-400')} data-testid="grades-cell" data-state="empty" aria-label={`${label}: не сдавал`}>—</span>
  }
  const cls = cell.kind === 'grade'
    ? (cell.tone ? GRADE_CLS[cell.tone] : 'bg-slate-100 text-graphite-700 text-[11px]')
    : cell.kind === 'wait' ? cn(WAIT_CLS, 'text-[11px]') : 'bg-slate-100 text-[11px] text-graphite-600'
  const spoken = cell.kind === 'wait' ? 'ждёт проверки' : cell.kind === 'returned' ? 'на доработке' : cell.text
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${label}: ${spoken}`}
      data-testid="grades-cell"
      data-state={cell.kind}
      className={cn(base, cls, 'text-[15px] hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-primary-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-500', (cell.kind !== 'grade' || !cell.tone) && 'text-[11px]', on && 'outline outline-2 outline-offset-1 outline-primary-600')}
    >
      {cell.text}
    </button>
  )
}
