/**
 * §288. Вкладка «Прохождение» и переключатель режима: ячейки и подсказки,
 * меню ручной отметки с подтверждением, массовые действия, фильтры; режим —
 * только админ и с подтверждением. База подменена на уровне `@/lib/progressUnlock`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProgressMatrix } from '@/lib/progressUnlock'

const api = vi.hoisted(() => ({
  fetchCourseProgressMatrix: vi.fn(),
  setTopicOverride: vi.fn(),
  openTopicForCourse: vi.fn(),
  openModuleForStudent: vi.fn(),
  setCourseUnlockMode: vi.fn(),
}))
vi.mock('@/lib/progressUnlock', async (orig) => ({ ...(await orig<object>()), ...api }))

import { CourseProgressTab } from '../CourseProgressTab'
import { CourseUnlockModeSetting } from '../CourseUnlockModeSetting'

const MATRIX: ProgressMatrix = {
  mode: 'progress',
  topics: [
    { id: 't1', title: 'Кинематика', module_id: 'm1', module_title: 'Механика' },
    { id: 't2', title: 'Динамика', module_id: 'm1', module_title: 'Механика' },
    { id: 'u1', title: 'Газы', module_id: 'm2', module_title: 'Молекулярка' },
  ],
  students: [
    { id: 's1', full_name: 'Аня Петрова', email: 'a@t.ru', last_closed_at: new Date().toISOString(), closed: 1,
      cells: [['closed', 'first2', 0, 'accepted', 85, null], ['open', 'prev_closed', 2, 'none', null, null], ['open', 'first2', 0, 'none', null, null]] },
    { id: 's2', full_name: 'Борис Иванов', email: 'b@t.ru', last_closed_at: null, closed: 0,
      cells: [['pending_review', 'first2', 0, 'submitted', null, null], ['locked', null, 3, 'none', null, 'closed'], ['open', 'first2', 0, 'none', null, null]] },
  ],
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><CourseProgressTab courseId="c1" /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchCourseProgressMatrix.mockResolvedValue(MATRIX)
})

describe('«Прохождение»', () => {
  it('ячейки первого раздела: значки, % у закрытого, подсказка с причиной/недостающим', async () => {
    renderTab()
    const cells = await screen.findAllByTestId('progress-cell')
    expect(cells).toHaveLength(4) // 2 ученика × 2 урока раздела «Механика»
    expect(cells[0]).toHaveTextContent('✓ 85%')
    expect(cells[1]).toHaveAttribute('title', 'открыт: закрыт предыдущий урок; осталось задач автопроверки: 2')
    expect(cells[2]).toHaveAttribute('data-state', 'pending_review')
    expect(cells[3]).toHaveTextContent('🔒 ✋')
    expect(cells[3]).toHaveAttribute('title', 'закрыт вручную; осталось задач автопроверки: 3')
  })

  it('клик → меню; «Открыть вручную» только после подтверждения; данные перечитываются', async () => {
    api.setTopicOverride.mockResolvedValue({ state: 'open' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    renderTab()
    fireEvent.click((await screen.findAllByTestId('progress-cell'))[3])
    const menu = screen.getByTestId('progress-menu')
    expect(menu).toHaveTextContent('Борис Иванов · «Динамика»')
    fireEvent.click(within(menu).getByTestId('progress-set-open'))
    expect(api.setTopicOverride).not.toHaveBeenCalled()
    fireEvent.click(within(menu).getByTestId('progress-set-open'))
    await waitFor(() => expect(api.setTopicOverride).toHaveBeenCalledWith('s2', 't2', 'open'))
    await waitFor(() => expect(api.fetchCourseProgressMatrix).toHaveBeenCalledTimes(2))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('снять ручную отметку — кнопка есть только при отметке', async () => {
    renderTab()
    fireEvent.click((await screen.findAllByTestId('progress-cell'))[1])
    expect(screen.queryByTestId('progress-set-clear')).toBeNull()
    fireEvent.click(screen.getAllByTestId('progress-cell')[3])
    expect(screen.getByTestId('progress-set-clear')).toBeInTheDocument()
  })

  it('массовые: «открыть всем» по уроку и «открыть раздел» ученику', async () => {
    api.openTopicForCourse.mockResolvedValue(2)
    api.openModuleForStudent.mockResolvedValue(2)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab()
    fireEvent.click((await screen.findAllByTestId('progress-open-topic'))[1])
    await waitFor(() => expect(api.openTopicForCourse).toHaveBeenCalledWith('t2'))
    fireEvent.click(screen.getAllByTestId('progress-open-module')[0])
    await waitFor(() => expect(api.openModuleForStudent).toHaveBeenCalledWith('s1', 'm1'))
  })

  it('фильтры: раздел, поиск, «застрявшие»', async () => {
    renderTab()
    await screen.findAllByTestId('progress-cell')
    fireEvent.change(screen.getByTestId('progress-module'), { target: { value: 'm2' } })
    expect(screen.getAllByTestId('progress-cell')).toHaveLength(2)
    fireEvent.change(screen.getByTestId('progress-search'), { target: { value: 'борис' } })
    expect(screen.getAllByTestId('progress-row')).toHaveLength(1)
    fireEvent.change(screen.getByTestId('progress-search'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('progress-stuck'))
    const rows = screen.getAllByTestId('progress-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Борис Иванов')
  })

  it('курс по датам — подсказка, где включить режим', async () => {
    api.fetchCourseProgressMatrix.mockResolvedValue({ ...MATRIX, mode: 'schedule' })
    renderTab()
    expect(await screen.findByText(/Режим «по прохождению» включается в «Настройках»/)).toBeInTheDocument()
  })
})

describe('режим открытия уроков', () => {
  it('админ: переключение — с подтверждением; отказ — ничего', async () => {
    api.setCourseUnlockMode.mockResolvedValue('progress')
    const onChanged = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    render(<CourseUnlockModeSetting courseId="c1" mode="schedule" canChange onChanged={onChanged} />)
    fireEvent.click(screen.getByTestId('unlock-mode-progress'))
    expect(api.setCourseUnlockMode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('unlock-mode-progress'))
    await waitFor(() => expect(api.setCourseUnlockMode).toHaveBeenCalledWith('c1', 'progress'))
    expect(onChanged).toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledTimes(2)
  })
  it('не админ — режим виден, кнопки неактивны', () => {
    render(<CourseUnlockModeSetting courseId="c1" mode="progress" canChange={false} onChanged={vi.fn()} />)
    expect(screen.getByTestId('unlock-mode-schedule')).toBeDisabled()
    expect(screen.getByText(/Режим меняет администратор/)).toBeInTheDocument()
  })
})
