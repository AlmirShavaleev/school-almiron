import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { planPeriod, planWeekStart, shiftPlanDay, type WorkPlan } from '@/lib/studentWorkPlan'

export interface WorkPlanGroup {
  id: string
  name: string
  courseId: string
  courseTitle: string
  students: { id: string; name: string }[]
}

const weeksPerPage = 4

export function WorkPlanGroupResults({ groups, plans, today, loading }: {
  groups: WorkPlanGroup[]; plans: WorkPlan[]; today: string; loading: boolean
}) {
  const [groupId, setGroupId] = useState('')
  const [windowOffset, setWindowOffset] = useState(0)
  const group = groups.find(entry => entry.id === groupId)
  const lastWeek = shiftPlanDay(planWeekStart(today), windowOffset * weeksPerPage * 7)
  const weeks = Array.from({ length: weeksPerPage }, (_, index) => shiftPlanDay(lastWeek, (index - weeksPerPage + 1) * 7))
  const weekSet = new Set(weeks)
  const cells = new Map<string, { done: number; total: number; planIds: string[] }>()
  const studentIds = new Set(group?.students.map(student => student.id))
  if (group) for (const plan of plans) {
    if (!plan.student_id || !studentIds.has(plan.student_id) || !plan.course_ids.includes(group.courseId)) continue
    const week = planWeekStart(plan.starts_on)
    if (!weekSet.has(week)) continue
    const key = `${plan.student_id}:${week}`
    const cell = cells.get(key) ?? { done: 0, total: 0, planIds: [] }
    cell.done += plan.done
    cell.total += plan.total
    cell.planIds.push(plan.id)
    cells.set(key, cell)
  }

  return (
    <details className="min-w-0">
      <summary className="w-fit cursor-pointer py-2 text-lg font-semibold text-graphite-950">Результаты по группам</summary>
      <Card className="mt-2 grid min-w-0 gap-3 p-4 sm:p-5">
        <label className="grid gap-1 text-sm font-medium text-graphite-700 sm:w-80">Группа
          <select aria-label="Группа для результатов" value={group?.id ?? ''} disabled={loading || !groups.length}
            onChange={e => { setGroupId(e.target.value); setWindowOffset(0) }}
            className="min-h-10 min-w-0 w-full rounded-xl border border-graphite-200 bg-white px-3 text-sm text-graphite-950 focus-visible:ring-2 focus-visible:ring-primary-500">
            <option value="">{loading ? 'Загружаю группы…' : groups.length ? 'Выберите группу' : 'Нет доступных групп'}</option>
            {groups.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        {group && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-graphite-950">{group.courseTitle}</p>
              <p className="text-xs text-graphite-600">Планы по курсу группы учитываются по неделе начала. В ячейках — выполненные темы из назначенных.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" className="min-h-10" onClick={() => setWindowOffset(n => n - 1)}>Раньше</Button>
              <Button size="sm" variant="secondary" className="min-h-10" disabled={windowOffset === 0} onClick={() => setWindowOffset(n => n + 1)}>Позже</Button>
            </div>
          </div>
          <div className="min-w-0 overflow-x-auto rounded-xl border border-graphite-200">
            <table aria-label={`Результаты группы ${group.name} по неделям`} className="w-full min-w-[39rem] border-collapse text-sm text-graphite-700">
              <thead className="bg-graphite-50">
                <tr>
                  <th scope="col" className="sticky left-0 bg-graphite-50 px-3 py-2 text-left font-semibold">ФИО ученика</th>
                  {weeks.map(week => <th key={week} scope="col" className="border-l border-graphite-200 px-3 py-2 text-center font-semibold whitespace-nowrap">{planPeriod(week, shiftPlanDay(week, 6))}</th>)}
                </tr>
              </thead>
              <tbody>
                {group.students.map(student => <tr key={student.id} className="border-t border-graphite-100">
                  <th scope="row" className="sticky left-0 max-w-48 bg-white px-3 py-2 text-left font-medium text-graphite-950">{student.name}</th>
                  {weeks.map(week => {
                    const cell = cells.get(`${student.id}:${week}`)
                    const value = cell ? `${cell.done} из ${cell.total}` : '—'
                    return <td key={week} className="border-l border-graphite-100 px-3 py-2 text-center whitespace-nowrap tabular-nums">
                      {cell?.planIds.length === 1
                        ? <Link className="inline-flex min-h-10 items-center font-semibold text-primary-700 hover:underline" to={`/student-work-plans/${cell.planIds[0]}`}>{value}</Link>
                        : value}
                    </td>
                  })}
                </tr>)}
              </tbody>
            </table>
          </div>
        </>}
      </Card>
    </details>
  )
}
