import { Link } from 'react-router-dom'
import { ClipboardCheck, Plus } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { useServerNow } from '@/hooks/useServerNow'
import { useCourseAssessmentsSummary } from '@/hooks/useCourseAssessments'
import { teacherBlocks, type CourseAssessmentsSummary, type TeacherAction, type TeacherRow } from '@/lib/courseAssessments'
import { CourseMockExamsSection } from './CourseMockExamsSection'

/**
 * §241. Раздел «Контрольные, самостоятельные и пробники» у учителя — сверху
 * программы курса: сводка по классу, сгруппированная по типам (как у ученика),
 * и быстрые переходы. Сами темы остаются в своих модулях — там их редактируют.
 *
 * Кнопки: КР/проверочная — «Проверка» (очередь с фильтром по теме,
 * `/homework-queue?topic=`), «Кто пишет» у идущей и «Работы» у проверенной
 * (вкладка «Домашние задания» с раскрытой темой), «Окно темы» у
 * запланированной; пробник — «Кто пишет» (монитор §224), «Таблица» или
 * «Настройка» (`/mock-exams/:id`).
 *
 * На телефоне строки — карточками (одна разметка: на широком экране та же
 * сетка становится таблицей), страница вбок не едет.
 *
 * Шаблон курса (групп нет) — только список работ, без статистики.
 * RPC недоступна (миграция не применена, сбой) — прежний раздел пробников
 * группы (§224), как было до §241.
 */
export function CourseAssessmentsSummarySection({ courseId, isTemplate, groupId, groupName, refreshKey = 0, onOpenTopic, onShowWorks }: {
  courseId: string
  isTemplate: boolean
  groupId: string | null
  groupName: string | null
  refreshKey?: number
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  const { status, data } = useCourseAssessmentsSummary(courseId, refreshKey)
  const now = useServerNow(data?.serverNow ?? null, 30_000)

  if (status === 'error') {
    return !isTemplate && groupId ? <CourseMockExamsSection groupId={groupId} groupName={groupName} /> : null
  }
  if (!data) return null
  return <SummaryView data={data} now={now} groupName={groupName} onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} />
}

export function SummaryView({ data, now, groupName, onOpenTopic, onShowWorks }: {
  data: CourseAssessmentsSummary
  now: number
  groupName?: string | null
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  const profile = useAuthStore(s => s.profile)
  const canCreate = !data.isTemplate && !!data.groupId && !!profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const blocks = teacherBlocks(data, now)
  const template = data.isTemplate
  if (template && blocks.length === 0) return null
  const name = data.groupName ?? groupName

  return (
    <section
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
      data-testid="course-assessments"
      data-template={template ? 'true' : 'false'}
      aria-labelledby="course-assessments-title"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3">
        <h2 id="course-assessments-title" className="flex min-w-0 items-center gap-2 text-sm font-bold text-primary-900">
          <ClipboardCheck size={16} className="shrink-0 text-primary-600" aria-hidden />
          <span>Контрольные, самостоятельные и пробники{!template && name ? ` · ${name}` : ''}</span>
        </h2>
        <span className="text-xs text-graphite-600" data-testid="course-assessments-note">
          {template ? 'каркас: окно, сдача и результаты — в классах' : `в классе ${data.inClass}`}
        </span>
        <div className="flex-1" />
        {canCreate && (
          <Link
            to={`/mock-exams/new?group=${data.groupId}`}
            data-testid="course-mock-add"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0"
          >
            <Plus size={14} aria-hidden />Добавить пробник
          </Link>
        )}
      </div>

      {blocks.length === 0 ? (
        <p className="px-4 py-3 text-sm text-graphite-600" data-testid="course-assessments-empty">
          Контрольных, проверочных и пробников пока нет — ученики этого раздела не видят.
        </p>
      ) : (
        <div role="table" aria-label="Контрольные, самостоятельные и пробники" className="text-[13.5px]">
          <div role="rowgroup" className="hidden md:block">
            <div role="row" className={cn('grid items-center gap-3 border-b border-gray-100 bg-slate-50 px-4 py-2 text-[11px] font-extrabold uppercase tracking-wider text-graphite-600', template ? GRID_TPL : GRID)}>
              <span role="columnheader">Работа</span>
              {template ? <span role="columnheader">Раздел</span> : (
                <>
                  <span role="columnheader">Когда</span>
                  <span role="columnheader">Статус</span>
                  <span role="columnheader" className="text-right">Сдали</span>
                  <span role="columnheader" className="text-right">Средний</span>
                </>
              )}
              <span role="columnheader"><span className="sr-only">Действия</span></span>
            </div>
          </div>
          {blocks.map(b => (
            <div role="rowgroup" key={b.key} data-testid="course-assessments-block" data-block={b.key}>
              <div role="row" className="border-b border-gray-100 bg-slate-50 px-4 py-2 text-xs font-extrabold tracking-wide text-primary-900">
                <span role="cell" data-testid="course-assessments-block-head">
                  {b.title} · {b.count}{b.summary ? ` · ${b.summary}` : ''}
                </span>
              </div>
              {b.rows.map(r => (
                <Row key={r.key} row={r} template={template} onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const GRID = 'md:grid-cols-[minmax(0,1fr)_170px_150px_76px_76px_128px]'
const GRID_TPL = 'md:grid-cols-[minmax(0,1fr)_220px_128px]'

const STATUS_CLS: Record<TeacherRow['status']['tone'], string> = {
  live: 'bg-primary-50 text-primary-700',
  soon: 'bg-verdict-none-tint text-verdict-none-ink',
  check: 'bg-gold-50 text-gold-700',
  done: 'bg-verdict-ok-tint text-verdict-ok-ink',
}

function Row({ row, template, onOpenTopic, onShowWorks }: {
  row: TeacherRow
  template: boolean
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  // Телефон: название и кнопка — первой строкой, «когда · статус · сдали ·
  // средний» — второй. С md та же разметка — строка таблицы (обёртка
  // становится `display: contents`, ячейки встают в столбцы).
  return (
    <div
      role="row"
      data-testid="course-assessments-row"
      data-status={row.status.text}
      className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-gray-100 px-4 py-3 md:py-2.5', template ? GRID_TPL : GRID)}
    >
      <span role="cell" className="col-start-1 row-start-1 min-w-0 md:col-start-auto md:row-start-auto">
        <span className="block font-semibold text-graphite-900 md:font-medium">{row.title}</span>
        {row.module && <span className="block text-xs text-graphite-500">{row.module}</span>}
      </span>
      {template ? (
        <span role="cell" className="hidden text-graphite-600 md:block">{row.module ?? '—'}</span>
      ) : (
        <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
          <span role="cell" className="text-xs text-graphite-700 tabular-nums md:text-[13px]" data-testid="course-assessments-when">{row.when}</span>
          <span role="cell" className="flex flex-wrap items-center gap-1.5">
            <span className={cn('whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold', STATUS_CLS[row.status.tone])} data-testid="course-assessments-status">
              {row.status.text}
            </span>
            {row.note && <span className="text-[11.5px] text-graphite-600">{row.note}</span>}
          </span>
          <span role="cell" className={cn('text-xs text-graphite-700 tabular-nums md:block md:text-right md:text-[13px]', row.submitted === '—' && 'hidden')} data-testid="course-assessments-submitted">
            <span className="md:hidden">сдали </span>{row.submitted}
          </span>
          <span role="cell" className={cn('text-xs text-graphite-700 tabular-nums md:block md:text-right md:text-[13px]', row.avg === '—' && 'hidden')} data-testid="course-assessments-avg">
            <span className="md:hidden">средний </span>{row.avg}
          </span>
        </span>
      )}
      <span role="cell" className="col-start-2 row-start-1 flex flex-wrap justify-end gap-1.5 md:col-start-auto md:row-start-auto">
        {row.actions.map(a => <Action key={a.label} action={a} onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} />)}
      </span>
    </div>
  )
}

const ACTION_CLS = 'inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-primary-50 px-3 text-[12.5px] font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:min-h-8'

function Action({ action, onOpenTopic, onShowWorks }: {
  action: TeacherAction
  onOpenTopic: (topicId: string) => void
  onShowWorks: (topicId: string) => void
}) {
  switch (action.kind) {
    case 'queue':
      return <Link to={`/homework-queue?topic=${action.topicId}`} className={ACTION_CLS} data-testid="course-assessments-action">{action.label}</Link>
    case 'mock':
      return <Link to={action.to} className={ACTION_CLS} data-testid="course-assessments-action">{action.label}</Link>
    case 'works':
      return <button type="button" onClick={() => onShowWorks(action.topicId)} className={ACTION_CLS} data-testid="course-assessments-action">{action.label}</button>
    case 'topic':
      return <button type="button" onClick={() => onOpenTopic(action.topicId)} className={ACTION_CLS} data-testid="course-assessments-action">{action.label}</button>
  }
}
