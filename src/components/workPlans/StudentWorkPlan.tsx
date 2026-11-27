import { ArrowRight } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Sticker } from '@/components/student/skin/Sticker'
import type { StickerName } from '@/components/student/skin/skin'
import { useStudentWorkPlans } from '@/hooks/useStudentWorkPlan'
import {
  PLAN_ITEM_LABELS, planCompletionStatus, planDayLabel, planPeriod, planProgress, workPlanTopicHref,
  type PlanItemStatus, type WorkPlan, type WorkPlanItem, type WorkPlanRead,
} from '@/lib/studentWorkPlan'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

const statusStyle: Record<PlanItemStatus, string> = {
  todo: 'bg-[var(--bg2)] text-[var(--ink2)]',
  started: 'bg-[var(--blueS)] text-[var(--blueInk)]',
  review: 'bg-[var(--orangeS)] text-[var(--orInk)]',
  done: 'bg-[var(--greenS)] text-[var(--greenInk)]',
  early: 'bg-[var(--greenS)] text-[var(--greenInk)]',
  late: 'bg-[var(--orangeS)] text-[var(--orInk)]',
  overdue: 'bg-[var(--redS)] text-[var(--redInk)]',
}

const homePlanStickers: Record<ReturnType<typeof planCompletionStatus>, StickerName> = {
  todo: 'plan-clock',
  started: 'plan-rocket',
  done: 'plan-target',
}

function planCourses(plan: WorkPlan) {
  return plan.course_titles?.length ? plan.course_titles.join(' · ') : 'Предмет не указан'
}

function StudentPlanSummary({ plan }: { plan: WorkPlan }) {
  const deadline = plan.effective_until ?? plan.ends_on
  const status = planCompletionStatus(plan)
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight tabular-nums text-[var(--ink)] sm:text-2xl">
            {planPeriod(plan.starts_on, deadline)}
          </p>
          <p className="mt-1 break-words text-sm font-medium text-[var(--ink2)] sm:text-base">
            {planCourses(plan)}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-3 py-1 text-sm font-semibold', statusStyle[status])}>
          {PLAN_ITEM_LABELS[status]}
        </span>
      </div>
      <WorkPlanProgress plan={plan} />
    </>
  )
}

function PlanTask({ item }: { item: WorkPlanItem }) {
  const href = workPlanTopicHref(item)
  const status = item.progress_state === 'early' ? 'done' : item.progress_state
  return (
    <li className="grid gap-2 border-t border-[var(--line)] py-3 first:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        {href ? <Link to={href} className="break-words font-semibold text-[var(--blueInk)] hover:underline">{item.topic_title}</Link>
          : <span className="break-words font-semibold text-[var(--ink)]">{item.topic_title}</span>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink2)] tabular-nums">
          {item.course_title && <span>{item.course_title}</span>}
          {item.target > 0 && <span>{Math.min(item.solved, item.target)} из {item.target} задач</span>}
          {item.criterion === 'theory' && <span>Учебные видео</span>}
          {!item.required && <span>Дополнительно</span>}
          {item.repeat && <span>Повторение</span>}
        </div>
        {item.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.note}</p>}
        {!!item.task_codes?.length && <p className="mt-1 break-words text-xs text-[var(--ink2)]">Задачи {item.task_codes.join(', ')}</p>}
        {!href && <p className="mt-1 text-xs text-[var(--ink2)]">
          {!item.topic_id ? 'Тема удалена' : !item.group_id ? 'Доступ к курсу закрыт' :
            item.homework_available === false ? 'Домашнее задание недоступно' : 'Тема пока закрыта'}
        </p>}
        {item.completed_at && <p className="mt-1 text-xs text-[var(--ink2)]">
          Выполнено {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Europe/Moscow' }).format(new Date(item.completed_at))}
        </p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', statusStyle[status])}>
          {PLAN_ITEM_LABELS[status]}
        </span>
        {href && !item.completed_at && item.progress_state !== 'review' && (
          <Link to={href} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--blueS)] px-3 text-sm font-medium text-[var(--blueInk)] hover:underline">
            {item.progress_state === 'started' || item.solved > 0 ? 'Продолжить решение' : 'Открыть задание'} <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </li>
  )
}

export function WorkPlanProgress({ plan, compact = false }: { plan: WorkPlan; compact?: boolean }) {
  const percent = planProgress(plan)
  return (
    <div>
      <div className={cn('mb-1.5 flex flex-wrap justify-between gap-x-3 text-[color:var(--ink2,#475569)] tabular-nums', compact ? 'text-xs' : 'text-sm')}>
        <span>Выполнено {plan.done} из {plan.total} · осталось {Math.max(0, plan.total - plan.done)}</span>
        <strong className="text-[color:var(--ink,#13254d)]">{percent}%</strong>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--blueS,#eaf0fd)]" role="progressbar"
        aria-label="Выполнение плана" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full', compact ? 'stu-home-plan-fill' : 'bg-primary-600')} style={{ width: percent + '%' }} />
      </div>
    </div>
  )
}

export function StudentWorkPlanHome({ data }: { data: WorkPlanRead | null }) {
  if (!data?.plans.length) return null
  return (
    <section className="grid gap-4" aria-labelledby="home-work-plan" data-testid="home-work-plan">
      <h2 id="home-work-plan" className="stu-h2">Мой план работы</h2>
      <div className="stu-home-plan-grid">
        {data.plans.map(plan => {
          const status = planCompletionStatus(plan)
          const titleId = `home-work-plan-${plan.id}`
          const deadline = plan.effective_until ?? plan.ends_on
          return (
            <article key={plan.id} className="stu-card stu-home-plan" data-status={status} aria-labelledby={titleId}>
              <div className="flex items-start justify-between gap-2">
                <Sticker name={homePlanStickers[status]} size={72} />
                <span className={cn('stu-tag', statusStyle[status])}>{PLAN_ITEM_LABELS[status]}</span>
              </div>
              <div className="min-w-0">
                <h3 id={titleId} className="stu-h3 tabular-nums">Срок до {planDayLabel(deadline, true)}</h3>
                <p className="stu-muted mt-1 break-words text-sm leading-snug">{planCourses(plan)}</p>
              </div>
              <WorkPlanProgress plan={plan} compact />
              <Link
                to={`/my-work-plan/${plan.id}`} aria-describedby={titleId}
                className={cn('stu-btn', status === 'started' ? 'stu-btn-p' : 'stu-btn-g')}
              >
                Открыть весь план <ArrowRight size={16} aria-hidden />
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function MyWorkPlansPage() {
  const { planId } = useParams<{ planId?: string }>()
  const { data, error, loading, reload, unavailable } = useStudentWorkPlans(planId ? 'detail' : 'mine', planId)
  const plan = planId ? data?.plans[0] : null
  if (loading) return <p className="p-4 text-sm text-[var(--ink2)]" role="status">Загружаю план работы…</p>
  if (unavailable) return <p className="stu-card p-5" role="status">{error}</p>
  if (error) return <div className="stu-card grid gap-3 p-5"><p role="alert">Не удалось загрузить план работы.</p><Button onClick={reload} className="w-fit">Повторить</Button></div>
  return (
    <div className="mx-auto grid max-w-4xl gap-5 pb-8">
      <Link to={planId ? '/my-work-plan' : '/student'} className="w-fit py-2 text-sm font-medium text-[var(--blueInk)]">
        ← {planId ? 'Все мои планы' : 'Мой кабинет'}
      </Link>
      <h1 className="text-2xl font-bold">Мой план работы</h1>
      {!planId && (data?.plans.length ? data.plans.map(p => (
        <Link key={p.id} to={`/my-work-plan/${p.id}`} className="stu-card grid gap-3 p-4 hover:ring-1 hover:ring-primary-300 focus-visible:ring-2 focus-visible:ring-primary-500 sm:p-5">
          <StudentPlanSummary plan={p} />
        </Link>
      )) : <p className="stu-card p-4">Пока нет опубликованных планов.</p>)}
      {planId && (!plan ? <p className="stu-card p-4">План недоступен.</p> : <PlanDetails plan={plan} />)}
    </div>
  )
}

function PlanDetails({ plan }: { plan: WorkPlan }) {
  return (
    <>
      <section className="stu-card grid gap-3 p-4 sm:p-5">
        <StudentPlanSummary plan={plan} />
        {plan.note && <p className="whitespace-pre-wrap break-words text-sm">{plan.note}</p>}
      </section>
      <section className="stu-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Темы плана</h2>
        {plan.items.length ? <ul>{plan.items.map(item => <PlanTask item={item} key={item.id} />)}</ul>
          : <p className="mt-2 text-sm text-[var(--ink2)]">В плане пока нет тем.</p>}
      </section>
    </>
  )
}
