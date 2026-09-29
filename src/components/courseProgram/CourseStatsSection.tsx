import { useState, type ReactNode } from 'react'
import { Users } from 'lucide-react'
import type { Module, Topic } from '@/hooks/useCourseProgram'
import type { TopicHomeworkRow } from '@/lib/topicHomeworkState'
import {
  DEFAULT_STUDENT_SORT, PERIOD_KEY, VIEW_KEY, readPeriod, readView, savePref,
  type StatsPeriod, type StatsView, type StudentSort,
} from '@/lib/courseStats'
import { useCourseStatsSummary, useCourseStudentsStats, useCourseTopicsStats } from '@/hooks/useCourseStats'
import {
  CourseStatsPanel, StatsStudentsTable, StatsTopicsTable, StatsViewSwitch, type LegacyHomeworkCount,
} from './CourseStats'

/**
 * §242. Статистика курса на вкладке «Программа курса» (только персонал): над
 * программой — панель за период, под ней переключатель «По темам / По
 * ученикам» и одна из двух таблиц. Период и разрез помнит localStorage.
 *
 * Запросы: сводка + таблица текущего разреза — две RPC на экран; ученики
 * темы — по раскрытию строки.
 *
 * Каркас курса (учеников нет) — без панели и без пустых столбцов: только
 * темы и пометка «статистика — в классах». В классе никого — так же, с
 * пометкой «пока нет учеников». RPC недоступна (миграция не применена, сбой)
 * — прежняя таблица программы (`fallback`), как было до §242.
 */
export function CourseStatsSection({
  courseId, isTemplate, modules, legacyHw, homeworkStateByTopic, refreshKey = 0,
  onOpenTopic, onOpenHomeworkTab, onToggleTopicOpen, fallback,
}: {
  courseId: string
  isTemplate: boolean
  modules: Module[]
  legacyHw: Record<string, LegacyHomeworkCount>
  homeworkStateByTopic: Record<string, TopicHomeworkRow[]>
  refreshKey?: number
  onOpenTopic: (topic: Topic, moduleTitle: string) => void
  onOpenHomeworkTab: () => void
  onToggleTopicOpen: (topicId: string, isOpen: boolean) => Promise<void>
  fallback: ReactNode
}) {
  const [period, setPeriodState] = useState<StatsPeriod>(readPeriod)
  const [view, setViewState] = useState<StatsView>(readView)
  const [sort, setSort] = useState<StudentSort>(DEFAULT_STUDENT_SORT)
  const setPeriod = (p: StatsPeriod) => { setPeriodState(p); savePref(PERIOD_KEY, p) }
  const setView = (v: StatsView) => { setViewState(v); savePref(VIEW_KEY, v) }

  const enabled = !isTemplate
  const summary = useCourseStatsSummary(courseId, period, enabled, refreshKey)
  const topics = useCourseTopicsStats(courseId, period, enabled && view === 'topics', refreshKey)
  const students = useCourseStudentsStats(courseId, period, enabled && view === 'students', refreshKey)

  const tableProps = { modules, courseId, period, legacyHw, homeworkStateByTopic, onOpenTopic, onOpenHomeworkTab, onToggleTopicOpen }

  if (isTemplate) {
    return (
      <div className="space-y-2" data-testid="course-stats-template">
        <p className="flex items-center gap-1.5 text-[12.5px] text-graphite-600">
          <Users size={13} className="shrink-0" aria-hidden />
          Каркас курса: статистика учеников — в классах.
        </p>
        <StatsTopicsTable {...tableProps} stats={null} inClass={0} plain />
      </div>
    )
  }

  // Без миграции (или при сбое) — прежняя таблица, ничего не ломаем.
  if (summary.status === 'error' || (view === 'topics' && topics.status === 'error' && !topics.data)) {
    return <>{fallback}</>
  }

  const inClass = summary.data?.inClass ?? topics.data?.inClass ?? students.data?.inClass ?? null
  if (summary.data && inClass === 0) {
    return (
      <div className="space-y-2" data-testid="course-stats-empty">
        <p className="flex items-center gap-1.5 text-[12.5px] text-graphite-600">
          <Users size={13} className="shrink-0" aria-hidden />
          В классе пока нет учеников — статистика появится, когда они начнут заниматься.
        </p>
        <StatsTopicsTable {...tableProps} stats={null} inClass={0} plain />
      </div>
    )
  }

  const periodNote = period === '7d' ? 'за 7 дней' : period === '30d' ? 'за 30 дней' : 'за всё время'

  return (
    <div className="space-y-3" data-testid="course-stats-section">
      {summary.data && (
        <CourseStatsPanel
          data={summary.data}
          period={period}
          onPeriod={setPeriod}
          loading={summary.status === 'loading'}
          onShowQuiet={() => { setView('students'); setSort(DEFAULT_STUDENT_SORT) }}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatsViewSwitch value={view} onChange={setView} />
        <span className="text-xs text-graphite-500" data-testid="stats-view-note">
          {view === 'topics'
            ? `Открыли, видео, ДЗ и средний — ${periodNote}; «Ждут» — сейчас. Нажмите на тему — кто из учеников что сделал.`
            : `Дни занятий, видео и средний — ${periodNote}; файлы, ДЗ и долги — за всё время. Нажмите на ученика — его карточка.`}
        </span>
      </div>
      {view === 'topics' ? (
        <StatsTopicsTable
          {...tableProps}
          stats={topics.data}
          inClass={topics.data?.inClass ?? inClass ?? 0}
          loading={topics.status === 'loading'}
        />
      ) : students.data ? (
        <StatsStudentsTable data={students.data} courseId={courseId} sort={sort} onSort={setSort} loading={students.status === 'loading'} />
      ) : students.status === 'error' ? (
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-verdict-bad-ink" data-testid="stats-students-error">
          Не удалось загрузить таблицу учеников. Обновите страницу.
        </p>
      ) : (
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-graphite-600">Загружаем учеников…</p>
      )}
    </div>
  )
}
