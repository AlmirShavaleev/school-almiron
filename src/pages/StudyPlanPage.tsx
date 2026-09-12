import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { useStudyPlanBoard } from '@/hooks/useStudyPlanBoard'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'
import { toast } from '@/store/toastStore'
import { Button } from '@/components/ui/Button'
import { PlanWeeksEditor } from '@/components/studyPlan/PlanWeeksEditor'
import { PlanBoardTable } from '@/components/studyPlan/PlanBoardTable'
import { WeekReport } from '@/components/studyPlan/WeekReport'
import { StudentWeekDetail } from '@/components/studyPlan/StudentWeekDetail'
import {
  formatDayShort, isoWeekday, nextMonday, spreadConfirmText, weekNumbers,
} from '@/lib/studyPlanBoard'
import { todayLocal } from '@/lib/topicAvailability'

/**
 * Учебный план курса по неделям (§151): дата старта, раскладка тем,
 * таблица ученики × недели и отчёт по неделе.
 *
 * Открытие страницы — ОДИН запрос к базе (`study_plan_board`): зачёт и
 * просрочка посчитаны там, здесь только раскладываем. Каждая запись —
 * своя RPC, после неё доска перечитывается.
 */
export function StudyPlanPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const { board, loading, busy, error, actions } = useStudyPlanBoard(courseId)
  const { readOnly } = useMyTeachingScope()

  const [startDate, setStartDate] = useState('')
  const [autoOpen, setAutoOpen] = useState(true)
  const [perWeek, setPerWeek] = useState(2)
  const [week, setWeek] = useState<number>(1)
  const [selected, setSelected] = useState<{ si: number; week: number } | null>(null)

  // Форма настройки следует за доской, но не затирает то, что человек уже
  // начал печатать: подставляем только при смене плана.
  useEffect(() => {
    if (!board) return
    if (board.plan) {
      setStartDate(board.plan.start_date)
      setAutoOpen(board.plan.auto_open)
      setWeek(Math.min(Math.max(1, board.plan.current_week), Math.max(1, board.plan.weeks_total)))
    } else {
      setStartDate(nextMonday(todayLocal()))
    }
  }, [board?.plan?.start_date, board?.plan?.auto_open, board?.plan?.weeks_total, !!board])

  const weeks = useMemo(() => board ? weekNumbers(board) : [], [board])
  const hasItems = !!board && board.topics.some(t => t.week_no !== null)
  const startIsMonday = startDate !== '' && isoWeekday(startDate) === 1

  async function handleSavePlan() {
    if (!startIsMonday) { toast.error('Дата старта должна быть понедельником'); return }
    try {
      await actions.savePlan(startDate, autoOpen)
      toast.saved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить план')
    }
  }

  async function handleSpread() {
    if (!board?.plan) { toast.error('Сначала сохраните дату старта'); return }
    if (!window.confirm(spreadConfirmText(perWeek, hasItems))) return
    try {
      const n = await actions.spread(perWeek)
      toast.success(`Разложено тем: ${n}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось разложить темы')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={28} className="animate-spin text-primary-600" />
      </div>
    )
  }

  const backLink = (
    <Link
      to={courseId ? `/course-program?courseId=${courseId}` : '/course-program'}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1"
    >
      <ArrowLeft size={14} /> К программе курса
    </Link>
  )

  if (error || !board) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        {backLink}
        <h1 className="text-xl font-bold text-gray-900 mb-2">Учебный план</h1>
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error ?? 'Нет доступа к плану этого курса'}</span>
        </div>
      </div>
    )
  }

  const plan = board.plan
  const canEdit = !readOnly

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div>
        {backLink}
        <h1 className="text-xl font-bold text-gray-900">Учебный план</h1>
        <p className="text-sm text-gray-500">
          {plan
            ? <>Старт {formatDayShort(plan.start_date)} · недель в раскладке: {plan.weeks_total} · сейчас неделя {plan.current_week}</>
            : 'Плана ещё нет: задайте дату старта, затем разложите темы по неделям.'}
        </p>
      </div>

      {/* Настройка */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-testid="plan-settings">
        <h2 className="text-sm font-semibold text-gray-900">Настройка плана</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-gray-600">
            <span className="block text-xs text-gray-500 mb-1">Старт (понедельник)</span>
            <input
              type="date"
              value={startDate}
              disabled={!canEdit}
              onChange={e => setStartDate(e.target.value)}
              data-testid="plan-start-date"
              className="min-h-11 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoOpen}
              disabled={!canEdit}
              onChange={e => setAutoOpen(e.target.checked)}
              data-testid="plan-auto-open"
            />
            План сам открывает темы в их неделю
          </label>
          {canEdit && (
            <Button variant="primary" size="sm" disabled={busy || !startIsMonday} onClick={() => { void handleSavePlan() }}>
              {plan ? 'Сохранить' : 'Создать план'}
            </Button>
          )}
          {startDate !== '' && !startIsMonday && (
            <span className="text-xs text-red-600">Нужен понедельник</span>
          )}
        </div>
        {autoOpen && (
          <p className="text-xs text-gray-500">
            Тема открывается в понедельник своей недели. Тумблер остаётся: «открыть раньше» — включить руками.
            Дата срабатывает в 03:00 по Москве.
          </p>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-gray-100">
            <label className="text-sm text-gray-600">
              <span className="block text-xs text-gray-500 mb-1">Тем в неделю</span>
              <input
                type="number" min={1} max={50} value={perWeek}
                onChange={e => setPerWeek(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                data-testid="plan-per-week"
                className="w-20 min-h-11 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </label>
            <Button variant="secondary" size="sm" disabled={busy || !plan} onClick={() => { void handleSpread() }} data-testid="plan-spread">
              Разложить по {perWeek} в неделю
            </Button>
            <span className="text-xs text-gray-500">Тем в курсе: {board.topics.length}. Потом раскладку можно править по одной теме.</span>
          </div>
        )}
      </section>

      {plan && (
        <>
          <PlanWeeksEditor board={board} canEdit={canEdit} busy={busy} onSetTopicWeek={actions.setTopicWeek} />

          <section className="space-y-3" data-testid="plan-board">
            {/* Таблица есть только на широком экране; на телефоне за неё работает отчёт по неделе */}
            <h2 className="hidden sm:block text-sm font-semibold text-gray-900">Ученики по неделям</h2>
            <PlanBoardTable
              board={board}
              weeks={weeks}
              selected={selected}
              onSelect={(si, w) => { setSelected({ si, week: w }); setWeek(w) }}
            />
          </section>

          <WeekReport
            board={board}
            weeks={weeks}
            week={week}
            onWeekChange={w => { setWeek(w); setSelected(null) }}
            onSelectStudent={si => setSelected({ si, week })}
          />

          {selected && (
            <StudentWeekDetail
              board={board}
              si={selected.si}
              week={selected.week}
              weeks={weeks}
              canEdit={canEdit}
              busy={busy}
              onClose={() => setSelected(null)}
              onSetOverride={actions.setOverride}
            />
          )}
        </>
      )}
    </div>
  )
}
