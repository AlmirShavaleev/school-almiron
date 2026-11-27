import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StaffWorkPlans } from '../StaffWorkPlans'
import { MyWorkPlansPage } from '../StudentWorkPlan'

const rpc = vi.hoisted(() => vi.fn())
const roster = vi.hoisted(() => ({ groups: [] as unknown[] }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ groups: roster.groups, loading: false, reload: vi.fn() }) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (select: (state: { profile: { id: string } }) => unknown) => select({ profile: { id: 'test-user' } }),
}))

const missing = {
  data: null,
  error: { code: 'PGRST202', message: 'Could not find the function public.student_work_plan_read in the schema cache' },
}
const empty = { data: { today: '2026-11-27', plans: [], total_plans: 0 }, error: null }

beforeEach(() => {
  rpc.mockReset()
  roster.groups = []
})

describe('Планы работы без подключённой миграции', () => {
  it('заменяет ошибку схемы понятным сообщением в списке и убирает вход в создание', async () => {
    rpc.mockResolvedValue(missing)
    render(<MemoryRouter><StaffWorkPlans studentId={null} /></MemoryRouter>)
    expect(await screen.findByText('Планы работы пока не подключены к этой базе.')).toBeVisible()
    expect(screen.queryByText(/schema cache/)).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Группа' })).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('показывает тот же статус ученику', async () => {
    rpc.mockResolvedValue(missing)
    render(<MemoryRouter><MyWorkPlansPage /></MemoryRouter>)
    expect(await screen.findByText('Планы работы пока не подключены к этой базе.')).toBeVisible()
  })

  it('отличает временный сбой от отсутствия функции и включает создание после успешного повтора', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Сеть недоступна' } }).mockResolvedValueOnce(empty)
    render(<MemoryRouter><StaffWorkPlans studentId="student-1" /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна')
    expect(screen.getByRole('button', { name: 'Создать план' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Пока нет планов работы.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Создать план' })).toBeEnabled()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})

it('показывает ученику предмет, общий срок и статус по выполнению плана', async () => {
  const common = {
    title: 'Служебное название плана', starts_on: '2026-11-27', ends_on: '2026-12-03',
    status: 'published', total: 4, done: 0, attempted: 0, activity_days: 0, review: 0,
  }
  rpc.mockResolvedValue({
    data: { today: '2026-11-27', plans: [
      { ...common, id: 'one', course_titles: ['Математика'], done: 4 },
      { ...common, id: 'two', course_titles: ['Физика', 'Механика'], attempted: 1 },
      { ...common, id: 'three', course_titles: ['Информатика'], effective_until: '2026-12-04' },
      { ...common, id: 'four', course_titles: ['Геометрия'], total: 365, done: 364 },
    ] },
    error: null,
  })
  render(<MemoryRouter><MyWorkPlansPage /></MemoryRouter>)
  const math = within(await screen.findByRole('link', { name: /Математика/ }))
  expect(math.getByText('27 нояб. — 3 дек.')).toBeVisible()
  expect(math.getByText('Выполнено', { exact: true })).toBeVisible()
  expect(within(screen.getByRole('link', { name: /Физика · Механика/ })).getByText('В процессе')).toBeVisible()
  const computing = within(screen.getByRole('link', { name: /Информатика/ }))
  expect(computing.getByText('Не начато')).toBeVisible()
  expect(computing.getByText('27 нояб. — 4 дек.')).toBeVisible()
  const geometry = within(screen.getByRole('link', { name: /Геометрия/ }))
  expect(geometry.getByText('В процессе')).toBeVisible()
  expect(geometry.getByText('99%')).toBeVisible()
  expect(screen.queryByText(common.title)).toBeNull()
})

it('фильтрует планы по прогрессу на всех страницах выборки', async () => {
  const plan = {
    student_id: 'student-1', student_name: 'Тестовый ученик', course_titles: ['Физика'], course_ids: ['course-1'],
    title: 'Служебное название', starts_on: '2026-11-27', ends_on: '2026-12-03',
    status: 'published', total: 4, done: 0, attempted: 0, activity_days: 0, review: 0, overdue: 0,
  }
  rpc.mockResolvedValueOnce({
    data: { today: '2026-11-27', plans: Array.from({ length: 250 }, (_, i) => ({ ...plan, id: String(i) })), total_plans: 251 },
    error: null,
  }).mockResolvedValueOnce({
    data: { today: '2026-11-27', plans: [{ ...plan, id: 'completed', done: 4 }], total_plans: 251 },
    error: null,
  })
  render(<MemoryRouter><StaffWorkPlans studentId={null} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Выполнено' }))
  const list = within(screen.getByRole('region', { name: 'Планы работы' }))
  expect(list.getAllByRole('link')).toHaveLength(1)
  expect(list.getByRole('link')).toHaveAttribute('href', '/student-work-plans/completed')
  expect(list.queryByText(plan.title)).toBeNull()
  expect(rpc).toHaveBeenLastCalledWith('student_work_plan_read', expect.objectContaining({ p_offset: 250 }))
  fireEvent.click(list.getByRole('button', { name: 'В процессе' }))
  expect(list.getByText('Нет планов с таким статусом.')).toBeVisible()
  fireEvent.click(list.getByRole('button', { name: 'Не начато' }))
  expect(list.getAllByRole('link')).toHaveLength(50)
  expect(rpc).toHaveBeenCalledTimes(2)
})

it('объединяет неделю начала, ФИО, группу и статус без повторного запроса', async () => {
  const plan = {
    student_id: 'student-1', student_name: 'Иван Соловьёв', course_titles: ['Физика'], course_ids: ['physics'],
    starts_on: '2026-11-27', ends_on: '2026-12-10',
    status: 'published', total: 4, done: 4, attempted: 0, activity_days: 0, review: 0, overdue: 0,
  }
  roster.groups = [{
    id: 'group-1', name: '11А', is_active: true, course_id: 'physics', courses: { title: 'Физика' },
    group_students: [{ student_id: 'student-1', students: { profiles: { full_name: 'Иван Соловьёв' } } }],
  }]
  rpc.mockResolvedValue({
    data: { today: '2026-11-27', plans: [
      { ...plan, id: 'current' },
      { ...plan, id: 'next', starts_on: '2026-12-01' },
      { ...plan, id: 'other-course', course_ids: ['math'], course_titles: ['Математика'] },
      { ...plan, id: 'classmate', student_id: 'student-2', student_name: 'Пётр Соловьёв', done: 0 },
    ] },
    error: null,
  })
  render(<MemoryRouter><StaffWorkPlans studentId={null} /></MemoryRouter>)
  const list = within(screen.getByRole('region', { name: 'Планы работы' }))
  const week = await list.findByRole('combobox', { name: 'Неделя начала' })
  expect(week).toHaveDisplayValue('Все недели')
  fireEvent.change(week, { target: { value: '2026-11-30' } })
  expect(list.getByRole('link')).toHaveAttribute('href', '/student-work-plans/next')
  fireEvent.change(week, { target: { value: '2026-11-23' } })
  expect(list.getAllByRole('link')).toHaveLength(3)
  fireEvent.change(list.getByRole('searchbox', { name: 'Поиск по ФИО' }), { target: { value: 'соловьев иван' } })
  expect(list.getAllByRole('link')).toHaveLength(2)
  fireEvent.change(list.getByRole('combobox', { name: 'Группа для фильтра' }), { target: { value: 'group-1' } })
  expect(list.getByRole('link')).toHaveAttribute('href', '/student-work-plans/current')
  expect(list.getByRole('status')).toHaveTextContent('1 план')
  fireEvent.click(list.getByRole('button', { name: 'Не начато' }))
  expect(list.getByText('По этим фильтрам планы не найдены.')).toBeVisible()
  fireEvent.click(list.getByRole('button', { name: 'Сбросить фильтры' }))
  expect(list.getAllByRole('link')).toHaveLength(4)
  expect(rpc).toHaveBeenCalledTimes(1)
})
