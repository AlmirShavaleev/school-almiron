import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from '@/store/toastStore'
import { formatWeekRange, type BoardTopic, type StudyPlanBoard } from '@/lib/studyPlanBoard'
import { cn } from '@/utils/cn'

/**
 * Раскладка тем по неделям с правкой по одной теме.
 *
 * У каждой темы — выбор недели; «снять с плана» — тоже пункт списка. Это не
 * перетаскивание: на телефоне, где владелец правит раскладку, список из 169
 * строк с select читается и правится точнее, чем drag-and-drop.
 */
export function PlanWeeksEditor({
  board, canEdit, busy, onSetTopicWeek,
}: {
  board: StudyPlanBoard
  canEdit: boolean
  busy: boolean
  onSetTopicWeek: (topicId: string, week: number | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const plan = board.plan!

  const byWeek = useMemo(() => {
    const map = new Map<number, BoardTopic[]>()
    const unplanned: BoardTopic[] = []
    for (const t of board.topics) {
      if (t.week_no === null) { unplanned.push(t); continue }
      const list = map.get(t.week_no) ?? []
      list.push(t)
      map.set(t.week_no, list)
    }
    const weeks = Array.from(map.keys()).sort((a, b) => a - b)
    return { weeks, map, unplanned }
  }, [board.topics])

  const maxWeek = Math.max(plan.weeks_total, ...byWeek.weeks, 0)
  // Можно перенести в любую существующую неделю и в одну следующую за последней.
  const weekOptions = Array.from({ length: maxWeek + 1 }, (_, i) => i + 1)

  async function move(topic: BoardTopic, value: string) {
    const week = value === '' ? null : Number(value)
    try {
      await onSetTopicWeek(topic.topic_id, week)
      toast.saved(week === null ? 'Тема снята с плана' : `Тема перенесена в неделю ${week}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось перенести тему')
    }
  }

  const planned = board.topics.length - byWeek.unplanned.length

  return (
    <section className="bg-white rounded-xl border border-gray-200" data-testid="plan-weeks-editor">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full min-h-11 items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <span className="text-sm font-semibold text-gray-900">Раскладка по неделям</span>
        <span className="text-xs text-gray-500">
          {planned} из {board.topics.length} тем в плане
          {byWeek.unplanned.length > 0 && ` · вне плана: ${byWeek.unplanned.length}`}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {byWeek.weeks.map(week => (
            <WeekBlock
              key={week}
              title={`Неделя ${week} · ${formatWeekRange(plan.start_date, week)}`}
              current={week === plan.current_week}
              topics={byWeek.map.get(week) ?? []}
              weekOptions={weekOptions}
              canEdit={canEdit}
              busy={busy}
              onMove={move}
            />
          ))}
          {byWeek.unplanned.length > 0 && (
            <WeekBlock
              title="Вне плана"
              current={false}
              topics={byWeek.unplanned}
              weekOptions={weekOptions}
              canEdit={canEdit}
              busy={busy}
              onMove={move}
            />
          )}
          {byWeek.weeks.length === 0 && byWeek.unplanned.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-500">В курсе нет тем.</p>
          )}
        </div>
      )}
    </section>
  )
}

function WeekBlock({
  title, current, topics, weekOptions, canEdit, busy, onMove,
}: {
  title: string
  current: boolean
  topics: BoardTopic[]
  weekOptions: number[]
  canEdit: boolean
  busy: boolean
  onMove: (topic: BoardTopic, value: string) => Promise<void>
}) {
  return (
    <div className={cn('px-4 py-3', current && 'bg-primary-50/40')} data-testid="plan-week-block">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-gray-900">{title}</span>
        {current && <span className="text-[10px] font-semibold uppercase text-primary-700">сейчас</span>}
        <span className="text-xs text-gray-400">{topics.length} тем</span>
      </div>
      <ul className="space-y-1">
        {topics.map(topic => (
          <li key={topic.topic_id} className="flex items-center gap-2 min-h-9">
            <span className="min-w-0 flex-1 text-sm text-gray-800 break-words">
              {topic.title}
              <span className="ml-1 text-xs text-gray-400">{topic.module_title}</span>
            </span>
            {canEdit ? (
              <select
                value={topic.week_no ?? ''}
                disabled={busy}
                onChange={e => { void onMove(topic, e.target.value) }}
                aria-label={`Неделя темы «${topic.title}»`}
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs"
              >
                <option value="">— снять с плана —</option>
                {weekOptions.map(w => <option key={w} value={w}>Неделя {w}</option>)}
              </select>
            ) : (
              <span className="text-xs text-gray-500">{topic.week_no === null ? 'вне плана' : `неделя ${topic.week_no}`}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
