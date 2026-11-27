import { Fragment, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ListChecks, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { plural } from '@/lib/plural'
import { saveStudentWorkPlan, useWorkPlanCatalog } from '@/hooks/useStudentWorkPlan'
import {
  planDayLabel, planDuration, shiftPlanDay,
  type PlanCatalogCourse, type PlanCatalogTopic, type PlanCriterion, type PlanInput, type PlanItemInput, type WorkPlan,
} from '@/lib/studentWorkPlan'

const planLengths = [7, 14]
const defaultMinutes = 60
const field = 'min-h-10 w-full rounded-xl border border-graphite-200 bg-white px-3 py-2 text-sm text-graphite-950 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-graphite-50'
const label = 'grid min-w-0 gap-1 text-sm font-medium text-graphite-700'
const homeworkLabels: Record<string, string> = {
  draft: 'Черновик ДЗ', submitted: 'ДЗ на проверке', accepted: 'ДЗ принято',
  returned_for_revision: 'ДЗ на доработке',
}
const criterionLabels: Record<PlanCriterion, string> = {
  homework: 'Полностью выполнить ДЗ',
  task_count: 'Решить заданное количество задач',
  specific_tasks: 'Решить выбранные задачи',
  theory: 'Посмотреть учебные видео',
}

type PlanDraft = Omit<PlanInput, 'ends_on' | 'rest_days'>

function initialPlan(studentId: string | null, today: string, plan?: WorkPlan): PlanDraft {
  return plan ? {
    id: plan.id, student_id: plan.student_id, title: plan.title, starts_on: plan.starts_on,
    daily_minutes: plan.daily_minutes, course_ids: plan.course_ids,
    note: plan.note, status: plan.status, notify: plan.notify,
  } : {
    id: crypto.randomUUID(), student_id: studentId, title: '', starts_on: today,
    daily_minutes: defaultMinutes, course_ids: [], note: '', status: 'draft', notify: false,
  }
}

export function WorkPlanEditor({ studentId, today, plan, courseSelection, onSaved, onCancel }: {
  studentId: string | null
  today: string
  plan?: WorkPlan
  courseSelection?: { courseId: string; courses: PlanCatalogCourse[]; chooseAnother?: () => void }
  onSaved: (id: string, status: PlanInput['status']) => void
  onCancel: () => void
}) {
  const savedDuration = plan ? planDuration(plan.starts_on, plan.ends_on) : planLengths[0]
  const [draft, setDraft] = useState(() => initialPlan(studentId, today, plan))
  const [duration, setDuration] = useState(savedDuration)
  const [items, setItems] = useState<PlanItemInput[]>(() => plan?.items ?? [])
  const [selectedCourseId, setCourseId] = useState(() => plan?.course_ids[0] ?? '')
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedTopics, setSavedTopics] = useState<Record<string, PlanCatalogTopic>>({})
  const [request, setRequest] = useState<{ signature: string; id: string } | null>(null)
  const courseId = courseSelection?.courseId ?? selectedCourseId
  const catalog = useWorkPlanCatalog(courseSelection && !courseId ? null : studentId, courseId)
  const topics = catalog.data?.topics ?? []
  const courses = courseSelection?.courses ?? catalog.data?.courses ?? []
  const metadata = useMemo(() => new Map([...Object.values(savedTopics), ...(catalog.data?.topics ?? [])].map(t => [t.id, t])), [savedTopics, catalog.data])

  const end = draft.starts_on ? shiftPlanDay(draft.starts_on, duration - 1) : ''
  const durationOptions = planLengths.includes(savedDuration) ? planLengths : [...planLengths, savedDuration]
  const defaultTitle = `План на ${duration} ${plural(duration, 'день', 'дня', 'дней')}`
  const added = new Set(items.map(item => item.topic_id))
  const savedItems = new Map(plan?.items.map(item => [item.id, item]))
  const courseTitles = new Map(courses.map(course => [course.id, course.title]))

  function itemCourseId(item: PlanItemInput) {
    return (item.topic_id ? metadata.get(item.topic_id)?.course_id : undefined) ?? savedItems.get(item.id)?.course_id
  }

  const itemCourses = new Set(items.map(itemCourseId).filter((id): id is string => !!id))
  const courseIds = courseSelection
    ? items.length ? [...itemCourses] : courseId ? [courseId] : []
    : draft.course_ids
  const selectedCourses = courses.filter(course => courseIds.includes(course.id))

  function change<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }
  function changeItem(id: string, patch: Partial<PlanItemInput>) {
    setItems(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row))
  }
  function selectCourse(id: string) {
    setSavedTopics(rows => ({ ...rows, ...Object.fromEntries(topics.map(t => [t.id, t])) }))
    setCourseId(id)
  }
  function toggleCourse(id: string, enabled: boolean) {
    const next = enabled ? [...draft.course_ids, id] : draft.course_ids.filter(c => c !== id)
    change('course_ids', next)
    if (enabled || courseId === id) selectCourse(enabled ? id : next[0] ?? '')
  }
  function addTopic(topic: PlanCatalogTopic) {
    if (!end || added.has(topic.id)) return
    setSavedTopics(current => ({ ...current, [topic.id]: topic }))
    const criterion = topic.homework_id ? 'homework' : topic.task_count ? 'task_count' : 'theory'
    setItems(rows => [...rows, {
      id: crypto.randomUUID(), topic_id: topic.id, scheduled_on: draft.starts_on, due_on: end,
      position: rows.length, minutes: defaultMinutes, criterion,
      target_tasks: criterion === 'task_count' ? topic.task_count : null, task_ids: [], required: true, note: '',
      access_mode: 'keep', repeat: criterion !== 'theory' && topic.kind !== 'check' && topic.kind !== 'control' &&
        (topic.completed || topic.homework_status === 'accepted'),
    }])
  }
  function reorder(index: number, delta: number) {
    setItems(rows => {
      const next = index + delta
      if (next < 0 || next >= rows.length) return rows
      const ordered = rows.slice()
      ordered[index] = rows[next]
      ordered[next] = rows[index]
      return ordered
    })
  }

  async function save(status: PlanInput['status']) {
    const title = draft.title || selectedCourses.map(course => course.title).join(' · ').slice(0, 150) || defaultTitle
    if (!end) {
      setError('Укажите дату начала плана.')
      return
    }
    if (status === 'published' && !items.length) {
      setError('Добавьте хотя бы одно задание.')
      return
    }
    if (items.some(item => item.criterion === 'specific_tasks' && !item.task_ids.length)) {
      setError('Выберите задачи для заданий с критерием «Решить выбранные задачи».')
      return
    }
    const payload = { ...draft, course_ids: courseIds, ends_on: end, rest_days: [], status, title }
    const planItems = items.map((item, position) => ({
      ...item, scheduled_on: payload.starts_on, due_on: payload.ends_on, position,
    }))
    const signature = JSON.stringify([payload, planItems])
    const requestId = request?.signature === signature ? request.id : crypto.randomUUID()
    setRequest({ signature, id: requestId })
    setPending(true)
    setError(null)
    try {
      const saved = await saveStudentWorkPlan(payload, planItems, requestId, plan?.revision)
      onSaved(saved.id, status)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить план.')
    } finally { setPending(false) }
  }

  const startField = <label className={label}>Начало<input className={field} type="date" value={draft.starts_on}
    onChange={e => change('starts_on', e.target.value)} /></label>
  return (
    <section className="grid gap-4" aria-label="Редактор плана работы">
      {!courseSelection && <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-graphite-950">{plan ? 'Редактирование плана' : 'Новый план работы'}</h2>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Назад</Button>
      </div>}
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <Card className="grid gap-3 p-4 sm:p-5">
          <div className={courseSelection ? undefined : 'grid items-start gap-3 sm:grid-cols-2'}>
            {!courseSelection && startField}
            <fieldset className="min-w-0">
              <legend className="mb-1 text-sm font-medium text-graphite-700">Срок плана</legend>
              <div className="flex flex-wrap gap-2">
                {durationOptions.map(days => <label key={days} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-graphite-200 px-3 text-sm has-[:checked]:border-primary-300 has-[:checked]:bg-primary-50">
                  <input type="radio" name="work-plan-duration" checked={duration === days} onChange={() => setDuration(days)} />
                  {days} {plural(days, 'день', 'дня', 'дней')}
                </label>)}
              </div>
              {end && <p className="mt-1 text-sm text-graphite-600">Выполнить до {planDayLabel(end, true)} включительно</p>}
            </fieldset>
          </div>
          {courseSelection && <details>
            <summary className="w-fit cursor-pointer py-2 text-sm font-medium text-graphite-700">Дата начала</summary>
            <div className="mt-2 max-w-xs">{startField}</div>
          </details>}
        </Card>

        {studentId && (
          <Card className="grid gap-3 p-4 sm:p-5">
            <h3 className="font-semibold text-graphite-950">{courseSelection ? 'Выберите темы' : 'Курсы и задания'}</h3>
            {catalog.error && <p role="alert" className="text-sm text-verdict-bad-ink">{catalog.error} <button onClick={catalog.reload} className="underline">Повторить</button></p>}
            {!catalog.loading && courses.length === 0 && !catalog.error && <p className="text-sm text-graphite-600">У ученика нет курсов в вашем доступе.</p>}
            {!courseSelection && courses.length > 0 && <div className="flex flex-wrap gap-2">
              {courses.map(c => <label key={c.id} className="flex min-h-10 items-center gap-2 rounded-xl bg-graphite-50 px-3 py-1 text-sm">
                <input type="checkbox" checked={draft.course_ids.includes(c.id)} disabled={!c.group_id || itemCourses.has(c.id)}
                  onChange={e => toggleCourse(c.id, e.target.checked)} />
                {c.title}{!c.group_id && ' · доступ закрыт'}
              </label>)}
            </div>}
            {catalog.loading && <p role="status" className="text-sm text-graphite-600">Загружаю курсы и темы…</p>}
            {!courseSelection && selectedCourses.length > 0 && <label className={label}>Курс<select className={field} value={courseId} onChange={e => selectCourse(e.target.value)}>
              <option value="">Выберите курс</option>{selectedCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select></label>}
            {courseSelection && !courseId && <p className="text-sm text-graphite-600">Выберите группу выше, чтобы увидеть темы курса.</p>}
            {courseId && catalog.data && <TopicPicker key={courseId} topics={topics} added={added} canAdd={!!end}
              defaultFilter={courseSelection ? 'all' : 'unfinished'} onAdd={addTopic} />}
          </Card>
        )}

        <Card className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold text-graphite-950"><ListChecks size={18} /> Темы плана</h3>
            {items.length > 0 && <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-graphite-600 tabular-nums">{items.length} {plural(items.length, 'тема', 'темы', 'тем')}</span>
              {courseSelection?.chooseAnother && <Button variant="ghost" size="sm" className="min-h-10" onClick={courseSelection.chooseAnother}>Добавить из другого курса</Button>}
            </div>}
          </div>
          {items.length ? (
            <table aria-label="Темы плана" className="mt-2 w-full table-fixed text-left text-sm">
              <thead className="text-xs text-graphite-600">
                <tr className="border-b border-graphite-100">
                  <th scope="col" className="py-2 font-medium">Тема и курс</th>
                  <th scope="col" className="hidden w-40 py-2 font-medium sm:table-cell">Критерий</th>
                  <th scope="col" className="w-20"><span className="sr-only">Действия</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-100">
                {items.map((item, index) => {
                  const topic = item.topic_id ? metadata.get(item.topic_id) : undefined
                  const saved = savedItems.get(item.id)
                  const title = topic?.title ?? saved?.topic_title ?? 'Тема'
                  const course = courseTitles.get(itemCourseId(item) ?? '') ?? saved?.course_title
                  const expanded = expandedItemId === item.id
                  const unavailable = topic ? !topic.available : saved ? !saved.available : false
                  const criterion = itemCriterion(item)
                  return <Fragment key={item.id}>
                    <tr>
                      <th scope="row" className="break-words py-2 pr-2 font-semibold text-graphite-950">
                        {title}
                        <span className="mt-0.5 block text-xs font-normal text-graphite-600">
                          {[course, !item.required && 'Дополнительно', item.repeat && 'Повторение'].filter(Boolean).join(' · ')}
                        </span>
                        <span className="block text-xs font-normal text-graphite-600 sm:hidden">{criterion}</span>
                        {unavailable && <span className="block text-xs font-medium text-gold-900">{item.topic_id ? 'Тема закрыта' : 'Тема удалена'}</span>}
                      </th>
                      <td className="hidden break-words py-2 pr-2 text-graphite-700 sm:table-cell">{criterion}</td>
                      <td>
                        <div className="flex justify-end">
                          <button type="button" aria-label={`Настроить тему «${title}»`} title="Настроить тему" aria-expanded={expanded}
                            onClick={() => setExpandedItemId(expanded ? null : item.id)} className="grid h-10 w-10 place-items-center rounded-lg text-graphite-700 hover:bg-graphite-50"><SlidersHorizontal size={16} /></button>
                          <button type="button" aria-label={`Убрать тему «${title}»`} title="Убрать из плана"
                            onClick={() => setItems(old => old.filter(row => row.id !== item.id))} className="grid h-10 w-10 place-items-center rounded-lg text-verdict-bad-ink hover:bg-graphite-50"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                    {expanded && <tr><td colSpan={3} className="pb-3 pt-2">
                      <ItemSettings item={item} topic={topic} saved={saved} first={index === 0} last={index === items.length - 1}
                        change={patch => changeItem(item.id, patch)} moveBy={delta => reorder(index, delta)} />
                    </td></tr>}
                  </Fragment>
                })}
              </tbody>
            </table>
          ) : <p className="mt-2 text-sm text-graphite-600">Добавьте темы из списка выше.</p>}
        </Card>
        {draft.status !== 'template' && <label className="flex min-h-10 items-center gap-2 text-sm text-graphite-700">
          <input type="checkbox" checked={draft.notify} onChange={e => change('notify', e.target.checked)} /> Уведомлять о плане. Итог получат ученик и автор плана
        </label>}
      </fieldset>
      {error && <p role="alert" className="rounded-xl bg-verdict-bad-tint p-3 text-sm text-verdict-bad-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {draft.status === 'draft' && <Button variant="secondary" onClick={() => void save('draft')} disabled={pending}>Сохранить черновик</Button>}
        <Button onClick={() => void save(draft.status === 'template' ? 'template' : 'published')} loading={pending}>
          {draft.status === 'draft' ? courseSelection ? 'Назначить план' : 'Опубликовать' : 'Сохранить изменения'}
        </Button>
        {courseSelection && <Button variant="ghost" onClick={onCancel} disabled={pending}>Отмена</Button>}
      </div>
    </section>
  )
}

function TopicPicker({ topics, added, canAdd, defaultFilter, onAdd }: {
  topics: PlanCatalogTopic[]
  added: Set<string | null>
  canAdd: boolean
  defaultFilter: string
  onAdd: (topic: PlanCatalogTopic) => void
}) {
  const [moduleId, setModuleId] = useState('')
  const [filter, setFilter] = useState(defaultFilter)
  const [number, setNumber] = useState('')
  const [search, setSearch] = useState('')
  const term = search.trim().toLocaleLowerCase('ru')
  const modules = new Map(topics.map(topic => [topic.module_id, topic.module_title]))
  const filtered = topics.filter(topic =>
    (!moduleId || topic.module_id === moduleId) &&
    (!number || topic.ege_numbers.includes(Number(number))) &&
    (!term || topic.title.toLocaleLowerCase('ru').includes(term)) &&
    (filter !== 'unfinished' || !topic.completed) &&
    (filter !== 'started' || topic.started && !topic.completed) &&
    (filter !== 'autocheck' || topic.autocheck) &&
    (filter !== 'available' || topic.available),
  )
  return (
    <>
      <label className={label}>Поиск по теме<input className={field} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <details>
        <summary className="w-fit cursor-pointer py-2 text-sm font-medium text-graphite-700">Фильтры тем</summary>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>Раздел<select className={field} value={moduleId} onChange={e => setModuleId(e.target.value)}>
            <option value="">Все разделы</option>{[...modules].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label className={label}>Темы<select className={field} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="unfinished">Невыполненные</option><option value="all">Все темы</option>
            <option value="started">Начатые</option><option value="autocheck">С автопроверкой</option>
            <option value="available">Доступные</option>
          </select></label>
          <label className={label}>Номер ЕГЭ<input type="number" min={1} className={field} value={number} onChange={e => setNumber(e.target.value)} placeholder="Любой номер" /></label>
        </div>
      </details>
      <ul className="max-h-80 overflow-y-auto rounded-xl border border-graphite-100 px-3">
        {filtered.map(topic => (
          <li key={topic.id} className="grid gap-1 border-t border-graphite-100 py-2 first:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <strong className="break-words text-sm text-graphite-950">{topic.title}</strong>
              <p className="text-xs text-graphite-600">
                {[topic.ege_numbers.length ? 'ЕГЭ №' + topic.ege_numbers.join(', ') : null, topic.module_title,
                  topic.homework_title, topic.task_count ? `${topic.solved} из ${topic.task_count} задач` : null,
                  topic.completed ? 'Выполнено' : topic.homework_status ? homeworkLabels[topic.homework_status] : null,
                  topic.has_theory ? 'Теория' : null, topic.autocheck ? 'Автопроверка' : null,
                  topic.available ? 'Доступна' : 'Закрыта'].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button variant="secondary" size="sm" className="min-h-10 w-fit" disabled={added.has(topic.id) || !canAdd || (!topic.homework_id && !topic.task_count && !topic.tracked_theory)}
              onClick={() => onAdd(topic)}><Plus size={15} />{added.has(topic.id) ? 'В плане' : topic.completed ? 'На повторение' : 'Добавить'}</Button>
          </li>
        ))}
        {!filtered.length && <li className="py-3 text-sm text-graphite-600">Темы по этим фильтрам не найдены.</li>}
      </ul>
    </>
  )
}

function itemCriterion(item: PlanItemInput) {
  if (item.criterion === 'homework') return 'Выполнить ДЗ'
  if (item.criterion === 'theory') return 'Посмотреть видео'
  const count = item.criterion === 'specific_tasks' ? item.task_ids.length : item.target_tasks
  return count ? `Решить ${count} ${plural(count, 'задачу', 'задачи', 'задач')}` : criterionLabels[item.criterion]
}

function ItemSettings({ item, topic, saved, first, last, change, moveBy }: {
  item: PlanItemInput
  topic?: PlanCatalogTopic
  saved?: WorkPlan['items'][number]
  first: boolean
  last: boolean
  change: (patch: Partial<PlanItemInput>) => void
  moveBy: (delta: number) => void
}) {
  const unavailable = topic ? !topic.available : saved ? !saved.available : false
  const progressive = topic?.progressive ?? saved?.progressive ?? item.access_mode !== 'keep'
  const manualClosed = topic?.manual_closed ?? saved?.manual_closed
  const options = [
    ...(topic?.homework_id || item.criterion === 'homework' ? ['homework' as const] : []),
    ...(topic?.task_count || item.criterion === 'task_count' || item.criterion === 'specific_tasks' ? ['task_count', 'specific_tasks'] as const : []),
    ...(topic?.tracked_theory || item.criterion === 'theory' ? ['theory' as const] : []),
  ]
  return (
    <div className="grid gap-2 rounded-xl bg-graphite-50 p-3">
      {item.topic_id ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>Критерий<select className={field} value={item.criterion} onChange={e => {
              const criterion = e.target.value as PlanCriterion
              change({
                criterion, target_tasks: criterion === 'task_count' ? Math.max(1, topic?.task_count ?? item.target_tasks ?? 1) : null,
                ...(criterion === 'theory' ? { repeat: false } : {}),
              })
            }}>{options.map(value => <option value={value} key={value}>{criterionLabels[value]}</option>)}</select></label>
            {item.criterion === 'task_count' && <label className={label}>Количество задач<input className={field} type="number" min={1} max={topic?.task_count ?? 500}
              value={item.target_tasks ?? ''} onChange={e => change({ target_tasks: e.target.valueAsNumber || null })} /></label>}
          </div>
          {item.criterion === 'specific_tasks' && <div className="flex max-h-36 flex-wrap items-center gap-2 overflow-auto">
            {topic?.tasks.map(task => <label key={task.id} className="flex min-h-10 items-center gap-2 rounded-lg bg-white px-2 text-sm">
              <input type="checkbox" checked={item.task_ids.includes(task.id)} onChange={e => change({
                task_ids: e.target.checked ? [...item.task_ids, task.id] : item.task_ids.filter(id => id !== task.id),
              })} /> {task.code}{task.solved && ' · решена'}
            </label>)}{!topic?.tasks.length && <p className="text-xs text-graphite-600">{item.task_ids.length} задач выбрано. Откройте курс, чтобы изменить список.</p>}
          </div>}
          {unavailable && <p className="text-sm font-medium text-gold-900">{manualClosed ? 'Тема закрыта ручной отметкой' : 'Тема сейчас закрыта для ученика'}</p>}
          {progressive && !manualClosed && (unavailable || item.access_mode !== 'keep') && (
            <label className={label}>Доступ к теме<select className={field} value={item.access_mode} onChange={e => change({ access_mode: e.target.value as PlanItemInput['access_mode'] })}>
              <option value="keep">Оставить текущий режим</option><option value="now">Открыть ученику при публикации</option>
              <option value="scheduled">Открыть в день начала плана</option>
            </select></label>
          )}
          <div className="flex flex-wrap gap-x-4">
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={item.required} onChange={e => change({ required: e.target.checked })} /> Обязательное</label>
            {item.criterion !== 'theory' && <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={item.repeat} disabled={topic?.kind === 'check' || topic?.kind === 'control'}
              onChange={e => change({ repeat: e.target.checked })} /> На повторение</label>
            }
          </div>
        </>
      ) : <p className="text-sm text-graphite-600">Тема удалена.</p>}
      {(!first || !last) && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={first} onClick={() => moveBy(-1)}><ArrowUp size={16} /> Переместить выше</Button>
        <Button size="sm" variant="ghost" disabled={last} onClick={() => moveBy(1)}><ArrowDown size={16} /> Переместить ниже</Button>
      </div>}
    </div>
  )
}
