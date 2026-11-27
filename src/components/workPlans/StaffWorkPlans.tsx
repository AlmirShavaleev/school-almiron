import { useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Copy, Plus } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { safeRpc } from '@/lib/safeRpc'
import { useGroups } from '@/hooks/useGroups'
import { saveStudentWorkPlan, useStudentWorkPlans, useWorkPlanCatalog, useWorkPlanRequest, workPlansUnavailable } from '@/hooks/useStudentWorkPlan'
import { enrollableGroups } from '@/lib/enrollmentTargets'
import { mskDateKey } from '@/lib/homeworkDeadline'
import { plural } from '@/lib/plural'
import {
  PLAN_ITEM_LABELS, planCompletionStatus, planPeriod, planProgress, planWeekStart, shiftPlanDay,
  type WorkPlan,
} from '@/lib/studentWorkPlan'
import { WorkPlanProgress } from './StudentWorkPlan'
import { WorkPlanEditor } from './WorkPlanEditor'
import { WorkPlanGroupResults, type WorkPlanGroup } from './WorkPlanGroupResults'

const otherPlanSections = [
  ['draft', 'Черновики'], ['template', 'Шаблоны'], ['cancelled', 'Отменённые'],
] as const
const otherPlanStatus: Partial<Record<WorkPlan['status'], string>> = {
  draft: 'Черновик', template: 'Шаблон', cancelled: 'Отменён',
}
const progressFilters = ['todo', 'started', 'done'] as const
type ProgressFilter = 'all' | ReturnType<typeof planCompletionStatus>
const progressStyle = {
  todo: 'bg-graphite-100 text-graphite-700',
  started: 'bg-primary-50 text-primary-700',
  done: 'bg-verdict-good-tint text-verdict-good-ink',
}
const selectClass = 'min-h-10 rounded-xl border border-graphite-200 bg-white px-3 text-sm text-graphite-950 focus-visible:ring-2 focus-visible:ring-primary-500'
const selectLabel = 'grid min-w-0 gap-1 text-sm font-medium text-graphite-700'
const creatorSelect = `${selectClass} min-w-0 w-full disabled:bg-graphite-50 disabled:text-graphite-500`
type Sort = 'deadline' | 'progress' | 'student' | 'course'
const pageSize = 50

export function StaffWorkPlansPage() {
  const { planId } = useParams<{ planId?: string }>()
  return (
    <div className="mx-auto grid max-w-5xl gap-4 pb-8">
      <h1 className="text-2xl font-bold text-graphite-950">Планы учеников</h1>
      <StaffWorkPlans studentId={null} routePlanId={planId} />
    </div>
  )
}

export function StaffWorkPlans({ studentId, routePlanId }: { studentId: string | null; routePlanId?: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sort, setSort] = useState<Sort>('deadline')
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all')
  const [week, setWeek] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [page, setPage] = useState(0)
  const [localDay] = useState(() => mskDateKey(Date.now()))
  const planId = routePlanId ?? selected
  const index = useStudentWorkPlans('staff', null, studentId, !planId && !creating)
  const detail = useStudentWorkPlans('staff_detail', planId, studentId, !!planId)
  const today = detail.data?.today ?? index.data?.today ?? localDay
  const { groups, loading: groupsLoading, reload: reloadGroups } = useGroups(!studentId && !planId)
  const planGroups = useMemo(() => workPlanGroups(groups), [groups])
  const assigned = useMemo(() => (index.data?.plans ?? [])
    .filter(plan => plan.status === 'published' || plan.status === 'completed')
    .map(plan => ({ plan, week: planWeekStart(plan.starts_on), name: searchName(plan.student_name) })),
  [index.data])
  const currentWeek = planWeekStart(today)
  const weeks = useMemo(() => [...new Set([currentWeek, ...assigned.map(entry => entry.week)])].sort().reverse(),
    [currentWeek, assigned])

  function resetFilters() {
    setProgressFilter('all')
    setWeek('')
    setStudentSearch('')
    setGroupFilter('')
    setPage(0)
  }

  if (index.unavailable || detail.unavailable) return (
    <Card className="p-4">
      <p role="status" className="text-sm text-graphite-700">{workPlansUnavailable}</p>
    </Card>
  )
  if (creating && studentId) {
    return <WorkPlanEditor studentId={studentId} today={today}
      onCancel={() => setCreating(false)}
      onSaved={id => { setCreating(false); setSelected(id) }} />
  }
  if (planId) {
    const plan = detail.data?.plans[0]
    if (detail.loading) return <p role="status" className="py-6 text-sm text-graphite-600">Загружаю план…</p>
    if (detail.error || !plan) return (
      <Card className="grid gap-2 p-4">
        <p role="alert" className="text-sm text-verdict-bad-ink">{detail.error ?? 'План недоступен.'}</p>
        {detail.error && <Button onClick={detail.reload} className="w-fit">Повторить</Button>}
        {routePlanId ? <Link to="/student-work-plans" className="w-fit text-sm text-primary-700">Все планы</Link>
          : <Button variant="secondary" className="w-fit" onClick={() => setSelected(null)}>Все планы ученика</Button>}
      </Card>
    )
    if (editing) return <WorkPlanEditor key={plan.id + ':' + plan.revision} studentId={plan.student_id} today={today} plan={plan}
      onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); detail.reload() }} />
    return <StaffPlanDetail key={plan.id + ':' + plan.revision} plan={plan} today={today}
      onEdit={() => setEditing(true)} reload={detail.reload}
      back={routePlanId ? <Link to="/student-work-plans" className="w-fit py-2 text-sm font-medium text-primary-700">← Все планы</Link>
        : <Button variant="secondary" className="w-fit" onClick={() => { setSelected(null); index.reload() }}>← Все планы ученика</Button>} />
  }
  const plans = index.data?.plans ?? []
  const tokens = nameTokens(studentSearch)
  const group = planGroups.find(entry => entry.id === groupFilter)
  const members = group && new Set(group.students.map(student => student.id))
  const hasFilters = progressFilter !== 'all' || !!week || tokens.length > 0 || !!group
  const filtered = assigned.filter(({ plan, week: startsIn, name }) =>
    (!week || startsIn === week) &&
    tokens.every(token => name.includes(token)) &&
    (!group || !!plan.student_id && members?.has(plan.student_id) && plan.course_ids.includes(group.courseId)) &&
    (progressFilter === 'all' || planCompletionStatus(plan) === progressFilter),
  ).map(({ plan }) => plan).sort((a, b) => {
    if (sort === 'progress') return planProgress(a) - planProgress(b)
    if (sort === 'student') return a.student_name.localeCompare(b.student_name, 'ru')
    if (sort === 'course') return a.course_titles.join(' ').localeCompare(b.course_titles.join(' '), 'ru')
    return (a.effective_until ?? a.ends_on).localeCompare(b.effective_until ?? b.ends_on)
  })
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const other = otherPlanSections
    .map(([key, title]) => ({ title, rows: plans.filter(plan => plan.status === key) }))
    .filter(section => section.rows.length)
  return (
    <div className="grid gap-6">
      {!studentId && <WorkPlanCreator groups={planGroups} loading={groupsLoading} reloadGroups={reloadGroups} today={today} onSaved={() => {
        resetFilters()
        index.reload()
      }} />}
      <section className="grid gap-3" aria-label="Планы работы">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-graphite-950">Назначенные планы</h2>
          {studentId && <Button disabled={!index.data} onClick={() => setCreating(true)}><Plus size={16} /> Создать план</Button>}
          {assigned.length > 1 && <label className="flex flex-wrap items-center gap-2 text-sm text-graphite-700">
            Сортировка<select aria-label="Сортировка" className={selectClass} value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(0) }}>
              <option value="deadline">По сроку</option><option value="progress">По прогрессу</option>
              <option value="student">По ученику</option><option value="course">По курсу</option>
            </select>
          </label>}
        </div>
        {index.data && (
          <div className="grid gap-3">
            <div className={studentId ? 'max-w-xs' : 'grid gap-3 sm:grid-cols-3'}>
              <label className={selectLabel}>Неделя начала
                <select aria-label="Неделя начала" className={creatorSelect} value={week}
                  onChange={event => { setWeek(event.target.value); setPage(0) }}>
                  <option value="">Все недели</option>
                  {weeks.map(start => <option key={start} value={start}>
                    {start === currentWeek ? 'Текущая · ' : ''}{planPeriod(start, shiftPlanDay(start, 6))}
                    {start.slice(0, 4) !== today.slice(0, 4) ? ` ${start.slice(0, 4)}` : ''}
                  </option>)}
                </select>
              </label>
              {!studentId && <>
                <label className={selectLabel}>Поиск по ФИО
                  <input type="search" className={creatorSelect} value={studentSearch} placeholder="Фамилия или имя"
                    onChange={event => { setStudentSearch(event.target.value); setPage(0) }} />
                </label>
                <label className={selectLabel}>Группа
                  <select aria-label="Группа для фильтра" className={creatorSelect} value={group?.id ?? ''} disabled={!planGroups.length}
                    onChange={event => { setGroupFilter(event.target.value); setPage(0) }}>
                    <option value="">Все группы</option>
                    {planGroups.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
              </>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Фильтр по статусу" className="flex flex-wrap gap-2">
                {(['all', ...progressFilters] as const).map(filter => <Button key={filter}
                  variant={filter === progressFilter ? 'primary' : 'secondary'} size="sm" className="min-h-10"
                  aria-pressed={filter === progressFilter} onClick={() => { setProgressFilter(filter); setPage(0) }}>
                  {filter === 'all' ? 'Все' : PLAN_ITEM_LABELS[filter]}
                </Button>)}
              </div>
              {hasFilters && <Button size="sm" variant="ghost" className="min-h-10" onClick={resetFilters}>Сбросить фильтры</Button>}
            </div>
            <p role="status" className="text-sm text-graphite-600 tabular-nums">
              {filtered.length} {plural(filtered.length, 'план', 'плана', 'планов')}
            </p>
          </div>
        )}
        {index.loading && <p role="status" className="text-sm text-graphite-600">Загружаю планы…</p>}
        {index.error && <Card className="grid gap-2 p-4"><p role="alert" className="text-sm text-verdict-bad-ink">{index.error}</p>
          <Button variant="secondary" onClick={index.reload} className="w-fit">Повторить</Button></Card>}
        {index.data && (visible.length
          ? <PlanRows rows={visible} onSelect={studentId ? setSelected : undefined} />
          : <Card className="p-4 text-sm text-graphite-700">{hasFilters
            ? week || tokens.length || group ? 'По этим фильтрам планы не найдены.' : 'Нет планов с таким статусом.'
            : 'Пока нет планов работы.'}</Card>)}
        {!hasFilters && other.length > 0 && <details>
          <summary className="w-fit cursor-pointer py-2 text-sm font-medium text-graphite-700">Другие планы</summary>
          <div className="mt-2 grid gap-3">
            {other.map(section => <section key={section.title} className="grid gap-2">
              <h3 className="text-sm font-semibold text-graphite-700">{section.title}</h3>
              <PlanRows rows={section.rows} onSelect={studentId ? setSelected : undefined} />
            </section>)}
          </div>
        </details>}
        {lastPage > 0 && <nav aria-label="Страницы планов" className="flex flex-wrap items-center gap-2 text-sm text-graphite-700">
          <Button variant="secondary" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>Назад</Button>
          <span>Страница {currentPage + 1}</span>
          <Button variant="secondary" onClick={() => setPage(currentPage + 1)} disabled={currentPage === lastPage}>Далее</Button>
        </nav>}
      </section>
      {!studentId && index.data && <WorkPlanGroupResults groups={planGroups} plans={assigned.map(({ plan }) => plan)} today={today} loading={groupsLoading} />}
    </div>
  )
}

type RosterGroup = {
  id: string
  name: string
  is_active: boolean
  course_id: string | null
  courses: { title: string; is_template?: boolean; is_active?: boolean; is_draft?: boolean } | null
  group_students?: { student_id: string; students?: { is_active?: boolean; profiles?: { full_name: string | null } | null } | null }[]
}

function workPlanGroups(groups: RosterGroup[]): WorkPlanGroup[] {
  const available = enrollableGroups(groups).filter(group => group.is_active && group.course_id &&
    group.courses && group.courses.is_active !== false && !group.courses.is_draft)
  const nameCounts = new Map<string, number>()
  for (const group of available) nameCounts.set(group.name, (nameCounts.get(group.name) ?? 0) + 1)
  return available.flatMap(group => {
    const students = (group.group_students ?? []).flatMap(row => {
      const name = row.students?.profiles?.full_name?.trim()
      return name && row.students?.is_active !== false ? [{ id: row.student_id, name }] : []
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    if (!students.length || !group.course_id || !group.courses) return []
    const name = nameCounts.get(group.name) === 1 ? group.name : `${group.name} · ${group.courses.title}`
    return [{ id: group.id, name, courseId: group.course_id, courseTitle: group.courses.title, students }]
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
}

function searchName(name: string) {
  return name.toLocaleLowerCase('ru').replaceAll('ё', 'е')
}

function nameTokens(query: string) {
  return searchName(query).trim().split(/\s+/).filter(Boolean)
}

function WorkPlanCreator({ groups, loading, reloadGroups, today, onSaved }: {
  groups: WorkPlanGroup[]; loading: boolean; reloadGroups: () => void; today: string; onSaved: () => void
}) {
  const [groupId, setGroupId] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const groupPicker = useRef<HTMLSelectElement>(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const students = useMemo(() => {
    const byId = new Map(groups.flatMap(group => group.students.map(student => [student.id, student] as const)))
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [groups])
  const studentId = students.some(student => student.id === selectedStudent) ? selectedStudent : null
  const tokens = nameTokens(search)
  const matches = !studentId && tokens.length ? students.filter(student => tokens.every(part => searchName(student.name).includes(part))) : []
  const catalog = useWorkPlanCatalog(studentId, '')
  const courses = catalog.data?.courses.filter(course => course.group_id) ?? []
  const studentGroups = !studentId ? [] : groups.filter(group =>
    group.students.some(student => student.id === studentId) && courses.some(course => course.id === group.courseId))
  const group = studentGroups.find(entry => entry.id === groupId)
  const course = courses.find(entry => entry.id === group?.courseId)

  return (
    <section className="grid gap-3" aria-labelledby="work-plan-create">
      <h2 id="work-plan-create" className="text-lg font-semibold text-graphite-950">Новый план</h2>
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={selectLabel}>ФИО ученика<input type="search" className={creatorSelect} value={search} disabled={loading}
            placeholder={loading ? 'Загружаю учеников…' : 'Введите фамилию или имя'}
            onChange={event => { setSearch(event.target.value); setSelectedStudent(null); setGroupId(''); setEditorOpen(false); setMessage('') }} /></label>
          <label className={selectLabel}>Группа<select ref={groupPicker} aria-label="Группа" className={creatorSelect} value={group?.id ?? ''} disabled={!studentGroups.length}
            onChange={event => { setGroupId(event.target.value); if (event.target.value) setEditorOpen(true); setMessage('') }}>
            <option value="">{catalog.loading ? 'Загружаю группы…' : 'Выберите группу ученика'}</option>
            {studentGroups.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select></label>
          <div className={selectLabel}>Предмет
            <p className="flex min-h-10 items-center break-words rounded-xl bg-graphite-50 px-3 text-sm text-graphite-700">{course?.title ?? '—'}</p>
          </div>
        </div>
        {!studentId && tokens.length > 0 && (matches.length ? <ul aria-label="Найденные ученики" className="divide-y divide-graphite-100 rounded-xl border border-graphite-100">
          {matches.slice(0, 8).map(student => <li key={student.id}><button type="button"
            className="min-h-10 w-full px-3 py-2 text-left text-sm text-graphite-950 hover:bg-primary-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
            onClick={() => { setSelectedStudent(student.id); setSearch(student.name) }}>
            {student.name}
            {matches.some(other => other.id !== student.id && searchName(other.name) === searchName(student.name)) &&
              <span className="block text-xs text-graphite-600">
                {groups.filter(group => group.students.some(member => member.id === student.id)).map(group => group.name).join(' · ')}
              </span>}
          </button></li>)}
        </ul> : <p className="text-sm text-graphite-600">Ученики не найдены.</p>)}
        {!loading && !groups.length && <p className="text-sm text-graphite-600">Нет доступных групп с учениками. <button type="button" className="underline" onClick={reloadGroups}>Обновить</button></p>}
        {catalog.error && <p role="alert" className="text-sm text-verdict-bad-ink">{catalog.error} <button type="button" className="underline" onClick={catalog.reload}>Повторить</button></p>}
        {catalog.data && !studentGroups.length && <p className="text-sm text-graphite-600">У ученика нет доступных групп для назначения плана.</p>}
        {message && <p role="status" className="text-sm font-medium text-graphite-700">{message}</p>}
      </Card>
      {studentId && editorOpen && <WorkPlanEditor key={studentId} studentId={studentId} today={today}
        courseSelection={{
          courseId: course?.id ?? '', courses,
          chooseAnother: new Set(studentGroups.map(entry => entry.courseId)).size > 1 ? () => groupPicker.current?.focus() : undefined,
        }}
        onCancel={() => { setGroupId(''); setEditorOpen(false) }}
        onSaved={(_, status) => {
          setGroupId('')
          setEditorOpen(false)
          setMessage(status === 'draft' ? 'Черновик сохранён.' : 'План назначен.')
          onSaved()
        }} />}
    </section>
  )
}

function PlanRows({ rows, onSelect }: { rows: WorkPlan[]; onSelect?: (id: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-graphite-100">
        {rows.map(plan => {
          const deadline = plan.effective_until ?? plan.ends_on
          const subject = plan.course_titles.join(' · ') || 'Предмет не указан'
          const content = <>
            <div className="min-w-0">
              {!onSelect && plan.student_id ? <>
                <strong className="break-words text-graphite-950">{plan.student_name}</strong>
                <p className="break-words text-sm text-graphite-700">{subject}</p>
              </> : <strong className="break-words text-graphite-950">{subject}</strong>}
            </div>
            <span className="row-start-2 text-sm text-graphite-700 sm:row-start-auto">{planPeriod(plan.starts_on, deadline)}</span>
            <div className="col-start-2 row-start-2 text-right text-sm tabular-nums text-graphite-700 sm:col-start-auto sm:row-start-auto sm:text-left">
              <span>{plan.done} из {plan.total} · <strong className="text-graphite-950">{planProgress(plan)}%</strong></span>
              {(plan.status === 'published' || plan.status === 'completed') && <div className="mt-1"><PlanProgressBadge plan={plan} /></div>}
              {plan.overdue > 0 && <p className="text-xs font-semibold text-verdict-bad-ink">Просрочено · {plan.overdue}</p>}
            </div>
            <ArrowRight aria-hidden="true" size={17} className="col-start-2 row-start-1 shrink-0 text-primary-600 sm:col-start-auto sm:row-start-auto" />
          </>
          const rowClass = 'grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-500 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_auto] sm:px-5'
          return <li key={plan.id}>
            {onSelect ? <button type="button" className={rowClass} onClick={() => onSelect(plan.id)}>{content}</button>
              : <Link className={rowClass} to={`/student-work-plans/${plan.id}`}>{content}</Link>}
          </li>
        })}
      </ul>
    </Card>
  )
}

function PlanProgressBadge({ plan }: { plan: WorkPlan }) {
  const status = planCompletionStatus(plan)
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${progressStyle[status]}`}>{PLAN_ITEM_LABELS[status]}</span>
}

function StaffPlanDetail({ plan, today, onEdit, reload, back }: {
  plan: WorkPlan; today: string; onEdit: () => void; reload: () => void; back: React.ReactNode
}) {
  const [copying, setCopying] = useState(false)
  const [action, setAction] = useState<'completed' | 'cancelled' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plannedStatus = otherPlanStatus[plan.status]
  const stats = [
    ['Выполнено тем', `${plan.done} из ${plan.total}`], ['Решено задач', plan.solved],
    ['Осталось задач', plan.remaining_tasks], ['Просрочено', plan.overdue], ['На проверке', plan.review],
    ['Дней с учебной активностью', plan.activity_days], ['Выполнено в срок', plan.on_time],
    ['Верно с первой попытки', plan.attempted > 0 ? Math.round(plan.first_correct / plan.attempted * 100) + '%' : '—'],
  ]
  async function applyStatus() {
    if (!action || pending) return
    setPending(true)
    setError(null)
    try {
      await saveStudentWorkPlan({ ...plan, status: action }, [], crypto.randomUUID(), plan.revision)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось изменить статус.')
    } finally { setPending(false) }
  }
  return (
    <section className="grid gap-4">
      {back}
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold text-graphite-950">{plan.course_titles.join(' · ') || 'План работы'}</h2>
            {plan.status !== 'template' && <p className="text-sm text-graphite-700">
              {plan.student_id ? <Link className="text-primary-700 hover:underline" to={`/students/${plan.student_id}?tab=work-plan`}>{plan.student_name}</Link> : plan.student_name}
            </p>}
          </div>
          {plannedStatus ? <span className="h-fit rounded-full bg-graphite-100 px-3 py-1 text-xs font-semibold text-graphite-700">{plannedStatus}</span>
            : <div><PlanProgressBadge plan={plan} /></div>}
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-graphite-700">
          <CalendarDays size={17} /> {planPeriod(plan.starts_on, plan.effective_until ?? plan.ends_on)}
        </p>
        {plan.note && <p className="whitespace-pre-wrap break-words text-sm text-graphite-800">{plan.note}</p>}
        <WorkPlanProgress plan={plan} />
        <div className="flex flex-wrap gap-2">
          {plan.status !== 'completed' && plan.status !== 'cancelled' && <Button onClick={onEdit}>Редактировать</Button>}
          <Button variant="secondary" onClick={() => setCopying(v => !v)}><Copy size={16} /> Копировать или назначить</Button>
          {plan.status === 'published' && <>
            <Button variant="secondary" onClick={() => setAction('completed')}>Завершить план</Button>
            <Button variant="secondary" onClick={() => setAction('cancelled')}>Отменить план</Button>
          </>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gold-50 p-2.5 text-sm text-gold-900">
          <span>{action === 'completed' ? 'Завершить этот план?' : 'Отменить этот план?'}</span>
          <Button size="sm" onClick={() => void applyStatus()} loading={pending}>Подтвердить</Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setAction(null)}>Назад</Button>
        </div>}
        {error && <p role="alert" className="text-sm text-verdict-bad-ink">{error}</p>}
      </Card>
      {copying && <WorkPlanCopy plan={plan} />}
      {plan.status !== 'template' && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value]) => <Card key={label} className="p-3"><dt className="text-xs text-graphite-600">{label}</dt>
          <dd className="mt-1 font-semibold text-graphite-950 tabular-nums">{value}</dd></Card>)}
      </dl>}
      {plan.items.length > 0 && <Card className="grid gap-2 p-4 sm:p-5">
        <h3 className="font-semibold text-graphite-950">Задания</h3>
        <ul>{plan.items.map(item => <li key={item.id} className="grid gap-1 border-t border-graphite-100 py-2.5 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <strong className="break-words text-sm text-graphite-950">{item.topic_title}</strong>
            {(item.target > 0 || item.repeat) && <p className="text-xs text-graphite-600 tabular-nums">
              {[item.target > 0 ? `${Math.min(item.solved, item.target)} из ${item.target} задач` : null,
                item.repeat ? 'Повторение' : null].filter(Boolean).join(' · ')}
            </p>}
            {!item.topic_id && <p className="text-xs text-verdict-bad-ink">Тема удалена</p>}
            {item.topic_id && !item.available && plan.status !== 'template' && <p className="text-xs text-gold-900">
              {item.access_mode === 'scheduled' && item.scheduled_on > today && item.group_id && !item.manual_closed
                ? 'Запланировано индивидуальное открытие' : 'Задание сейчас недоступно ученику'}
            </p>}
          </div>
          {plan.status !== 'template' && <span className="text-xs font-medium text-graphite-600">{PLAN_ITEM_LABELS[item.progress_state]}</span>}
        </li>)}</ul>
      </Card>}
    </section>
  )
}

interface CopyTargets {
  groups: { id: string; name: string; course_title: string }[]
  students: { id: string; name: string; group_ids: string[] }[]
}
interface CopyResult { created: string[]; failed: { student_id: string | null; message: string }[] }

function WorkPlanCopy({ plan }: { plan: WorkPlan }) {
  const [day, setDay] = useState(shiftPlanDay(plan.starts_on, 7))
  const [targets, setTargets] = useState<string[]>(plan.student_id ? [plan.student_id] : [])
  const [group, setGroup] = useState('')
  const [search, setSearch] = useState('')
  const [publish, setPublish] = useState(false)
  const [notify, setNotify] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<CopyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState<{ signature: string; id: string } | null>(null)
  const options = useWorkPlanRequest<CopyTargets>('student_work_plan_copy_targets', JSON.stringify({ p_plan_id: plan.id }))
  async function copy(template: boolean) {
    if (pending || !day || !template && !targets.length && !group) return
    const body = {
      p_plan_id: plan.id, p_starts_on: day, p_template: template,
      p_student_ids: template ? [] : targets, p_group_id: template ? null : group || null,
      p_publish: publish && !template, p_notify: publish && notify && !template,
    }
    const signature = JSON.stringify(body)
    const id = request?.signature === signature ? request.id : crypto.randomUUID()
    setRequest({ signature, id })
    setPending(true)
    setError(null)
    setResult(null)
    const { data, error: failure } = await safeRpc('student_work_plan_copy', { ...body, p_request_id: id })
    if (failure) setError(failure.message)
    else { setResult(data as CopyResult); setRequest(null) }
    setPending(false)
  }
  const people = options.data?.students.filter(p => !search || p.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))) ?? []
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <h3 className="font-semibold text-graphite-950">Копирование плана</h3>
      <label className="flex flex-wrap items-center gap-2 text-sm">Начало копии<input type="date" value={day} onChange={e => setDay(e.target.value)} className={selectClass} /></label>
      <Button onClick={() => setDay(shiftPlanDay(plan.starts_on, 7))} variant="secondary" size="sm" className="w-fit">На следующую неделю</Button>
      {options.loading && <p role="status" className="text-sm text-graphite-600">Загружаю учеников…</p>}
      {options.error && <p role="alert" className="text-sm text-verdict-bad-ink">{options.error}</p>}
      {!!options.data?.groups.length && <label className="flex flex-wrap items-center gap-2 text-sm">Вся группа<select className={selectClass}
        value={group} onChange={e => setGroup(e.target.value)}>
        <option value="">Выбрать отдельных учеников</option>
        {options.data.groups.map(g => <option key={g.id} value={g.id}>{g.course_title} · {g.name}</option>)}</select>
      </label>}
      {!!options.data?.students.length && <div className="grid gap-1">
        <label className="flex flex-wrap items-center gap-2 text-sm">Поиск по ученикам<input className={selectClass} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <ul className="max-h-48 overflow-y-auto">
          {people.map(p => <li key={p.id}><label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={targets.includes(p.id) || !!group && p.group_ids.includes(group)}
              disabled={!!group && p.group_ids.includes(group)}
              onChange={e => setTargets(xs => e.target.checked ? [...xs, p.id] : xs.filter(id => id !== p.id))} /> {p.name}
          </label></li>)}
        </ul>
      </div>}
      <div className="flex flex-wrap gap-x-4">
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} /> Опубликовать копии</label>
        {publish && <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> Уведомить учеников</label>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy(false)} loading={pending} disabled={!day || !targets.length && !group}>{publish ? 'Назначить план' : 'Создать черновики'}</Button>
        <Button variant="secondary" disabled={pending || !day} onClick={() => void copy(true)}>Сохранить как шаблон</Button>
      </div>
      {error && <p role="alert" className="text-sm text-verdict-bad-ink">{error}</p>}
      {result && <div role="status" className="grid gap-1 text-sm text-graphite-700">
        <strong>Создано · {result.created.length}</strong>
        {result.created.map((id, i) => <Link className="w-fit text-primary-700 hover:underline" key={id} to={`/student-work-plans/${id}`}>Открыть копию {i + 1}</Link>)}
        {result.failed.map((item, i) => <p className="text-verdict-bad-ink" key={item.student_id ?? i}>
          {options.data?.students.find(p => p.id === item.student_id)?.name ?? 'Ученик или шаблон'} · {item.message}
        </p>)}
      </div>}
    </Card>
  )
}
