export type PlanStatus = 'draft' | 'published' | 'completed' | 'cancelled' | 'template'
export type PlanCriterion = 'homework' | 'task_count' | 'specific_tasks' | 'theory'
export type PlanAccess = 'keep' | 'now' | 'scheduled'
export type PlanItemStatus = 'todo' | 'started' | 'review' | 'done' | 'early' | 'overdue' | 'late'

export interface PlanItemInput {
  id: string
  topic_id: string | null
  scheduled_on: string
  due_on: string
  position: number
  minutes: number
  criterion: PlanCriterion
  target_tasks: number | null
  task_ids: string[]
  required: boolean
  note: string
  access_mode: PlanAccess
  repeat: boolean
}

export interface PlanInput {
  id: string
  student_id: string | null
  title: string
  starts_on: string
  ends_on: string
  daily_minutes: number
  rest_days: string[]
  course_ids: string[]
  note: string
  status: PlanStatus
  notify: boolean
}

export interface WorkPlanItem extends PlanItemInput {
  topic_title: string
  course_id: string | null
  homework_id: string | null
  course_title: string | null
  module_title: string | null
  group_id: string | null
  available: boolean
  manual_closed: boolean
  progressive?: boolean
  homework_available?: boolean
  completed_at: string | null
  progress_state: PlanItemStatus
  solved: number
  target: number
  theory_tab?: 'theory' | 'notes' | null
  task_codes?: string[]
}

export interface WorkPlan extends PlanInput {
  revision: number
  effective_until?: string
  items: WorkPlanItem[]
  student_name: string
  course_titles: string[]
  total: number
  done: number
  overdue: number
  review: number
  on_time: number
  minutes: number
  today_minutes: number
  solved: number
  remaining_tasks: number
  first_correct: number
  attempted: number
  activity_days: number
}

export interface WorkPlanRead {
  today: string
  total_plans?: number
  plans: WorkPlan[]
}

export interface PlanCatalogCourse {
  id: string
  title: string
  progressive: boolean
  group_id: string | null
}

export interface PlanCatalogTopic {
  id: string
  title: string
  course_id: string
  module_id: string
  module_title: string
  ege_numbers: number[]
  homework_id: string | null
  homework_title: string | null
  kind: string | null
  autocheck: boolean
  task_count: number
  solved: number
  started: boolean
  completed: boolean
  homework_status: string | null
  tasks: { id: string; code: string; solved: boolean }[]
  has_theory: boolean
  tracked_theory?: boolean
  available: boolean
  progressive: boolean
  manual_closed: boolean
}

export interface PlanCatalog {
  courses: PlanCatalogCourse[]
  topics: PlanCatalogTopic[]
}

const dayMs = 86_400_000
const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC',
})
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function utcDay(day: string) { return new Date(day + 'T00:00:00Z') }

export function shiftPlanDay(day: string, amount: number) {
  return new Date(utcDay(day).valueOf() + amount * dayMs).toISOString().slice(0, 10)
}

export function planWeekStart(day: string) {
  return shiftPlanDay(day, -((utcDay(day).getUTCDay() + 6) % 7))
}

export function planDuration(start: string, end: string) {
  return (utcDay(end).valueOf() - utcDay(start).valueOf()) / dayMs + 1
}

export function planDayLabel(day: string, short = false) {
  const date = utcDay(day)
  if (Number.isNaN(date.valueOf())) return '—'
  const formatted = (short ? shortDate : dayFormat).format(date)
  return short ? formatted : formatted.slice(0, 1).toUpperCase() + formatted.slice(1)
}

export function planPeriod(start: string, end: string) {
  return start === end ? planDayLabel(start, true) : `${planDayLabel(start, true)} — ${planDayLabel(end, true)}`
}

export function planProgress(plan: Pick<WorkPlan, 'done' | 'total'>) {
  if (!plan.total) return 0
  return plan.done >= plan.total ? 100 : Math.min(99, Math.round(100 * plan.done / plan.total))
}

export function planCompletionStatus(plan: Pick<WorkPlan, 'total' | 'done' | 'review' | 'attempted' | 'activity_days'>) {
  if (plan.total > 0 && plan.done >= plan.total) return 'done'
  return plan.done > 0 || plan.review > 0 || plan.attempted > 0 || plan.activity_days > 0 ? 'started' : 'todo'
}

export function planBucket(plan: Pick<WorkPlan, 'status' | 'starts_on' | 'ends_on' | 'effective_until'>, today: string) {
  if (plan.status === 'draft' || plan.status === 'template') return plan.status
  if (plan.status === 'cancelled') return 'cancelled'
  if (plan.status === 'completed' || (plan.effective_until ?? plan.ends_on) < today) return 'completed'
  return plan.starts_on > today ? 'future' : 'active'
}

export const PLAN_ITEM_LABELS: Record<PlanItemStatus, string> = {
  todo: 'Не начато', started: 'В процессе', review: 'Ожидает проверки',
  done: 'Выполнено', early: 'Выполнено досрочно', overdue: 'Просрочено', late: 'Выполнено с опозданием',
}

export function workPlanTopicHref(item: WorkPlanItem) {
  if (!item.available || !item.group_id || !item.topic_id) return null
  const params = new URLSearchParams({ tab: item.criterion === 'theory' ? item.theory_tab ?? 'theory' : 'homework' })
  if (item.repeat && item.criterion !== 'theory') {
    params.set('planItem', item.id)
    params.set('repeat', item.target_tasks ? 'tasks' : 'homework')
  }
  return `/my-course/${item.group_id}/topic/${item.topic_id}?${params}`
}

export function isWorkPlanItemId(id: string | null): id is string {
  return !!id && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
}
