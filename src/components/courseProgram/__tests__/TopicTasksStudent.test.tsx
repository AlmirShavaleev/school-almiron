import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { TopicTaskRow, useTopicTasks } from '@/hooks/useTopicTasks'
import { TopicTasksStudent } from '@/components/courseProgram/TopicTasksStudent'

/**
 * §175. Задачи к уроку — лента шагов как в Stepik: по квадрату на задачу,
 * на экране одна карточка, «Назад / Дальше» внизу, текущая — в адресе.
 *
 * Условие каталога рендерится тем же `CatalogTaskContent`, что и каталог; здесь
 * он заменён на текст условия — проверяем ленту и переключение, а не разметку
 * условия (у него свои тесты).
 */
vi.mock('@/components/catalog/CatalogTaskContent', () => ({
  CatalogTaskContent: ({ task, showControls }: { task: { statement_html: string; solution_html: string | null }; showControls?: boolean }) => (
    <div>
      <div data-testid="statement">{task.statement_html}</div>
      {showControls && task.solution_html && <div data-testid="solution">{task.solution_html}</div>}
    </div>
  ),
}))

type Tasks = ReturnType<typeof useTopicTasks>

function row(n: number, patch: Partial<TopicTaskRow> = {}): TopicTaskRow {
  return {
    student_assignment_id: 'sa-1',
    item_id: `item-${n}`,
    item_position: n,
    task_id: `task-${n}`,
    statement_html: `Условие ${n}`,
    assets: [],
    max_points: 1,
    auto_checkable: true,
    answer_raw: null,
    is_correct: null,
    attempts_count: 0,
    closed_by: null,
    solution_shown_at: null,
    solution_html: null,
    answer_html: null,
    ...patch,
  }
}

/** 1 и 2 решены, у 3 есть попытки, 4 не тронута, 5 — вторая часть, разобрана. */
function fiveRows(): TopicTaskRow[] {
  return [
    row(1, { closed_by: 'auto', attempts_count: 1, is_correct: true, answer_raw: '2' }),
    row(2, { closed_by: 'auto', attempts_count: 3, is_correct: true, answer_raw: '4' }),
    row(3, { attempts_count: 2, is_correct: false, answer_raw: '7' }),
    row(4),
    row(5, { auto_checkable: false, closed_by: 'self', solution_shown_at: '2026-09-13T10:00:00Z', solution_html: '<p>Разбор</p>' }),
  ]
}

function makeTasks(rows: TopicTaskRow[], patch: Partial<Tasks> = {}): Tasks {
  return {
    rows,
    total: rows.length,
    solved: rows.filter(r => r.closed_by !== null).length,
    loading: false,
    error: null,
    busyItem: null,
    answer: vi.fn(async () => true),
    reveal: vi.fn(async () => null),
    closeSelf: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    ...patch,
  }
}

/** Показывает текущий адрес — чтобы проверять `?task=` без доступа к history. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderWith(tasks: Tasks, url = '/topic') {
  const wrap = (node: ReactNode) => (
    <MemoryRouter initialEntries={[url]}>
      {node}
      <LocationProbe />
    </MemoryRouter>
  )
  const utils = render(wrap(<TopicTasksStudent tasks={tasks} />))
  return {
    ...utils,
    rerenderWith: (next: Tasks) => utils.rerender(wrap(<TopicTasksStudent tasks={next} />)),
  }
}

function squares() {
  return within(screen.getByTestId('topic-tasks-strip')).getAllByRole('button')
}

function currentSquare() {
  const cur = squares().filter(b => b.getAttribute('aria-current') === 'step')
  expect(cur).toHaveLength(1)
  return cur[0]
}

describe('TopicTasksStudent — лента шагов (§175)', () => {
  it('лента: по квадрату на задачу, состояния по смыслу, подписи для читалки', () => {
    renderWith(makeTasks(fiveRows()))

    const sq = squares()
    expect(sq).toHaveLength(5)
    expect(sq.map(b => b.getAttribute('data-state'))).toEqual([
      'solved', 'solved', 'attempted', 'untouched', 'solved',
    ])
    expect(sq[0]).toHaveAccessibleName('Задача 1, решена')
    expect(sq[2]).toHaveAccessibleName('Задача 3, есть попытки, не решена')
    expect(sq[3]).toHaveAccessibleName('Задача 4, не начата')
    expect(sq[4]).toHaveAccessibleName('Задача 5, разобрана')
    expect(screen.getByText(/Решено 3 из 5/)).toBeInTheDocument()
  })

  it('на экране одна карточка, начальная — первая нерешённая', () => {
    renderWith(makeTasks(fiveRows()))

    expect(screen.getAllByTestId('statement')).toHaveLength(1)
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 3')
    expect(currentSquare()).toHaveAccessibleName(/Задача 3/)
  })

  it('если всё решено — начальная первая, а вместо «Дальше» у последней «Все задачи решены»', () => {
    const rows = fiveRows().map(r => ({ ...r, closed_by: r.closed_by ?? 'auto' as const }))
    renderWith(makeTasks(rows))

    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 1')
    expect(screen.queryByTestId('topic-tasks-all-solved')).not.toBeInTheDocument()

    fireEvent.click(squares()[4])
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 5')
    expect(screen.getByTestId('topic-tasks-all-solved')).toHaveTextContent('Все задачи решены')
    expect(screen.queryByRole('button', { name: /Дальше/ })).not.toBeInTheDocument()
  })

  it('клик по квадрату и «Назад / Дальше» меняют текущую; у последней «Дальше» неактивна', () => {
    renderWith(makeTasks(fiveRows()))

    fireEvent.click(squares()[0])
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 1')
    expect(screen.getByRole('button', { name: /Назад/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Дальше/ }))
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 2')
    expect(currentSquare()).toHaveAccessibleName(/Задача 2/)

    fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 1')

    fireEvent.click(squares()[4])
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 5')
    // Не всё решено — кнопка на месте, но идти некуда.
    expect(screen.getByRole('button', { name: /Дальше/ })).toBeDisabled()
    expect(screen.queryByTestId('topic-tasks-all-solved')).not.toBeInTheDocument()
  })

  it('текущая задача кладётся в адрес, а `?task=` восстанавливает её', async () => {
    const first = renderWith(makeTasks(fiveRows()))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/topic?task=item-3'))

    fireEvent.click(squares()[1])
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/topic?task=item-2'))
    first.unmount()

    renderWith(makeTasks(fiveRows()), '/topic?task=item-4')
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 4')
    expect(currentSquare()).toHaveAccessibleName(/Задача 4/)
  })

  it('чужой `?task=` не ломает: берётся первая нерешённая', () => {
    renderWith(makeTasks(fiveRows()), '/topic?task=nope')
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 3')
  })

  it('после верного ответа квадрат зеленеет, а карточка остаётся — разбор читают на месте', async () => {
    const rows = fiveRows()
    const tasks = makeTasks(rows)
    const { rerenderWith } = renderWith(tasks)

    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 3')
    fireEvent.change(screen.getByLabelText('Ответ на задачу'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() => expect(tasks.answer).toHaveBeenCalledWith('item-3', '9'))

    // Хук перезагрузил строки: задача 3 закрыта верным ответом.
    const next = rows.map(r => r.item_id === 'item-3'
      ? { ...r, closed_by: 'auto' as const, is_correct: true, attempts_count: 3 }
      : r)
    rerenderWith(makeTasks(next))

    expect(squares()[2]).toHaveAttribute('data-state', 'solved')
    expect(currentSquare()).toHaveAccessibleName('Задача 3, решена')
    // Первая нерешённая теперь 4 — но карточка не перескочила.
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 3')
    expect(screen.getByText('Верно')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Посмотреть решение/ })).toBeInTheDocument()
    expect(screen.getByText(/Решено 4 из 5/)).toBeInTheDocument()
  })

  it('вторая часть: «Посмотреть решение» → «Разобрал», квадрат зеленеет, карточка на месте', async () => {
    const rows = fiveRows().map(r => r.item_id === 'item-5'
      ? { ...r, closed_by: null, solution_shown_at: null, solution_html: null }
      : r)
    const tasks = makeTasks(rows)
    const { rerenderWith } = renderWith(tasks, '/topic?task=item-5')

    expect(squares()[4]).toHaveAttribute('data-state', 'untouched')
    fireEvent.click(screen.getByRole('button', { name: /Посмотреть решение/ }))
    await waitFor(() => expect(tasks.reveal).toHaveBeenCalledWith('item-5'))

    const shown = rows.map(r => r.item_id === 'item-5'
      ? { ...r, solution_shown_at: '2026-09-14T10:00:00Z', solution_html: '<p>Разбор</p>' }
      : r)
    const tasks2 = makeTasks(shown)
    rerenderWith(tasks2)
    fireEvent.click(screen.getByRole('button', { name: /Разобрал/ }))
    await waitFor(() => expect(tasks2.closeSelf).toHaveBeenCalledWith('item-5'))

    rerenderWith(makeTasks(shown.map(r => r.item_id === 'item-5' ? { ...r, closed_by: 'self' as const } : r)))
    expect(squares()[4]).toHaveAttribute('data-state', 'solved')
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 5')
    expect(screen.getByText('Разобрана')).toBeInTheDocument()
  })

  it('без задач — подпись, без ленты', () => {
    renderWith(makeTasks([]))
    expect(screen.getByText('К этому уроку задач пока нет.')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-tasks-strip')).not.toBeInTheDocument()
  })
})

/**
 * §176. Неверный ответ — состояние карточки: плашка, красное поле с введённым
 * ответом, «Проверить ещё раз». Разбор у задачи с коротким ответом — после
 * первой попытки; открытый разбор переводит задачу в самопроверку.
 */
describe('TopicTasksStudent — неверный ответ и разбор после попытки (§176)', () => {
  const input = () => screen.getByLabelText('Ответ на задачу') as HTMLInputElement

  function withWrong(rows: TopicTaskRow[], id: string, raw: string, attempts: number) {
    return rows.map(r => r.item_id === id ? { ...r, is_correct: false, attempts_count: attempts, answer_raw: raw } : r)
  }

  it('неверный ответ → плашка, поле красное с тем же текстом, «Проверить ещё раз»', async () => {
    const rows = fiveRows()
    const tasks = makeTasks(rows, { answer: vi.fn(async () => false) })
    const { rerenderWith } = renderWith(tasks, '/topic?task=item-4')

    expect(screen.queryByTestId('topic-task-wrong')).not.toBeInTheDocument()
    fireEvent.change(input(), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() => expect(tasks.answer).toHaveBeenCalledWith('item-4', '12'))
    // Хук перечитал строки — без спиннера, карточка та же.
    rerenderWith(makeTasks(withWrong(rows, 'item-4', '12', 1), { answer: tasks.answer }))

    const alert = await screen.findByTestId('topic-task-wrong')
    expect(alert).toHaveTextContent('Неверно · попытка 1')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(input()).toHaveValue('12')
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: /Проверить ещё раз/ })).toBeInTheDocument()
    expect(screen.getByTestId('topic-task-card')).toHaveAttribute('data-verdict', 'wrong')
    expect(squares()[3]).toHaveAttribute('data-state', 'attempted')
  })

  it('ввод в поле гасит плашку и возвращает «Проверить»', async () => {
    const rows = fiveRows()
    const tasks = makeTasks(rows, { answer: vi.fn(async () => false) })
    const { rerenderWith } = renderWith(tasks, '/topic?task=item-4')
    fireEvent.change(input(), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() => expect(tasks.answer).toHaveBeenCalled())
    rerenderWith(makeTasks(withWrong(rows, 'item-4', '12', 1), { answer: tasks.answer }))
    await screen.findByTestId('topic-task-wrong')

    fireEvent.change(input(), { target: { value: '13' } })
    expect(screen.queryByTestId('topic-task-wrong')).not.toBeInTheDocument()
    expect(input()).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeInTheDocument()
    expect(screen.getByTestId('topic-task-card')).not.toHaveAttribute('data-verdict')
  })

  it('состояние «неверно» переживает перемонтирование: пришло с сервера, а не из памяти кнопки', () => {
    // Ровно то, что было у владельца: карточка перерисована заново после
    // ответа. У задачи 3 в базе is_correct=false, answer_raw='7', попыток 2.
    renderWith(makeTasks(fiveRows()), '/topic?task=item-3')
    expect(screen.getByTestId('topic-task-wrong')).toHaveTextContent('Неверно · попытка 2')
    expect(input()).toHaveValue('7')
    expect(screen.getByRole('button', { name: /Проверить ещё раз/ })).toBeInTheDocument()
  })

  it('«Посмотреть решение»: до первой попытки нет, после неверной — есть', async () => {
    const rows = fiveRows()
    const tasks = makeTasks(rows, { answer: vi.fn(async () => false) })
    const { rerenderWith } = renderWith(tasks, '/topic?task=item-4')
    expect(screen.queryByRole('button', { name: /Посмотреть решение/ })).not.toBeInTheDocument()

    fireEvent.change(input(), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() => expect(tasks.answer).toHaveBeenCalled())
    rerenderWith(makeTasks(withWrong(rows, 'item-4', '12', 1), { answer: tasks.answer }))

    expect(screen.getByRole('button', { name: /Посмотреть решение/ })).toBeInTheDocument()
  })

  it('открытое решение: поле ответа исчезает, разбор виден, «Разобрал» → закрыта «по разбору»', async () => {
    const rows = withWrong(fiveRows(), 'item-4', '12', 1)
    const tasks = makeTasks(rows)
    const { rerenderWith } = renderWith(tasks, '/topic?task=item-4')

    fireEvent.click(screen.getByRole('button', { name: /Посмотреть решение/ }))
    await waitFor(() => expect(tasks.reveal).toHaveBeenCalledWith('item-4'))

    const shown = rows.map(r => r.item_id === 'item-4'
      ? { ...r, solution_shown_at: '2026-09-14T10:00:00Z', solution_html: '<p>Разбор 4</p>', answer_html: '8' }
      : r)
    const tasks2 = makeTasks(shown)
    rerenderWith(tasks2)

    expect(screen.queryByLabelText('Ответ на задачу')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Проверить/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('solution')).toHaveTextContent('Разбор 4')
    expect(screen.getByText('самопроверка по решению')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Разобрал/ }))
    await waitFor(() => expect(tasks2.closeSelf).toHaveBeenCalledWith('item-4'))

    rerenderWith(makeTasks(shown.map(r => r.item_id === 'item-4' ? { ...r, closed_by: 'self' as const } : r)))
    expect(screen.getByText('Разобрана')).toBeInTheDocument()
    expect(screen.getByText('разобрана')).toBeInTheDocument()
    expect(squares()[3]).toHaveAttribute('data-state', 'solved')
    expect(squares()[3]).toHaveAccessibleName('Задача 4, разобрана')
    expect(screen.getByText(/Решено 4 из 5/)).toBeInTheDocument()
  })

  it('верный ответ после неверных — «Верно», плашки нет, поле убрано', async () => {
    const rows = withWrong(fiveRows(), 'item-4', '12', 1)
    const tasks = makeTasks(rows, { answer: vi.fn(async () => true) })
    const { rerenderWith } = renderWith(tasks, '/topic?task=item-4')
    expect(screen.getByTestId('topic-task-wrong')).toBeInTheDocument()

    fireEvent.change(input(), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() => expect(tasks.answer).toHaveBeenCalledWith('item-4', '8'))
    rerenderWith(makeTasks(rows.map(r => r.item_id === 'item-4'
      ? { ...r, closed_by: 'auto' as const, is_correct: true, attempts_count: 2, answer_raw: '8' } : r)))

    expect(screen.queryByTestId('topic-task-wrong')).not.toBeInTheDocument()
    expect(screen.getByText('Верно')).toBeInTheDocument()
    expect(screen.getByText('решена с 2-й попытки')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ответ на задачу')).not.toBeInTheDocument()
  })
})
