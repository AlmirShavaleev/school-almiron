import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * §174. Вкладка «Результаты тестов» показывает первым блоком задачи к уроку
 * матрицей «ученик × тема» из одной RPC; тесты из банка — ниже и только если у
 * курса есть назначения. Проверяем поведение на выдуманных данных: четыре
 * состояния ячейки, ссылка на ученика с `?course=` (§171), итоги, скрытие
 * блока банка, пустое состояние с названием каркаса.
 */

const rpcSpy = vi.fn()
const fromSpy = vi.fn()

function chain(result: { data: unknown; error: { message: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') { const p = Promise.resolve(result); return p.then.bind(p) }
      return () => c
    },
  })
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcSpy(...args),
    from: (table: string) => fromSpy(table),
  },
}))

import { CourseTestResultsSection } from '@/components/courseProgram/CourseTestResultsSection'

const MODULES = [{ id: 'm1', title: 'Модуль', topics: [{ id: 't1', title: 'Кинематика' }, { id: 't2', title: 'Динамика' }] }]

const matrixRow = (student_id: string, full_name: string, topic_id: string, over: Record<string, unknown>) => ({
  student_id, full_name, topic_id,
  topic_title: topic_id === 't1' ? 'Кинематика: равноускоренное движение' : 'Динамика',
  module_order: 1, topic_order: topic_id === 't1' ? 1 : 2, tasks_total: topic_id === 't1' ? 5 : 3,
  touched: 0, closed_auto: 0, closed_self: 0, ...over,
})

const MATRIX = [
  // Абрамов: t1 закрыл всё (3 ответом, 2 разбором), t2 — не открывал
  matrixRow('s1', 'Абрамов Артём', 't1', { touched: 5, closed_auto: 3, closed_self: 2 }),
  matrixRow('s1', 'Абрамов Артём', 't2', {}),
  // Белова: t1 часть, t2 отвечала, ничего не закрыла
  matrixRow('s2', 'Белова Вера', 't1', { touched: 4, closed_auto: 2 }),
  matrixRow('s2', 'Белова Вера', 't2', { touched: 2 }),
]

function draw(props: Partial<Parameters<typeof CourseTestResultsSection>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<CourseTestResultsSection courseId="course-1" modules={MODULES} {...props} />} />
        <Route path="/students/:id" element={<div data-testid="student-page" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockBank({ assignments }: { assignments: unknown[] }) {
  fromSpy.mockImplementation((table: string) => {
    if (table === 'group_students') return chain({ data: [{ student_id: 's1', students: { profiles: { full_name: 'Абрамов Артём' } } }], error: null })
    if (table === 'topic_test_assignments') return chain({ data: assignments, error: null })
    if (table === 'topic_test_attempts') return chain({ data: [], error: null })
    throw new Error(`unexpected table ${table}`)
  })
}

describe('CourseTestResultsSection — задачи к уроку матрицей (§174)', () => {
  beforeEach(() => {
    rpcSpy.mockReset().mockResolvedValue({ data: MATRIX, error: null })
    fromSpy.mockReset()
    mockBank({ assignments: [] })
  })

  it('зовёт одну RPC на курс, а не запрос по каждой теме', async () => {
    draw()
    await screen.findByTestId('tasks-matrix')
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('course_topic_tasks_matrix', { p_course_id: 'course-1' })
  })

  it('ячейки: все / часть / ноль с числом / не открывал — четыре разных состояния', async () => {
    draw()
    const rows = await screen.findAllByTestId('tasks-matrix-row')
    expect(rows).toHaveLength(2)

    const abramov = within(rows[0]).getAllByTestId('tasks-cell')
    expect(abramov[0]).toHaveAttribute('data-state', 'done')
    expect(abramov[0]).toHaveTextContent('5 / 5')
    expect(abramov[0]).toHaveAttribute('title', 'по ответу 3 · по разбору 2')
    expect(abramov[1]).toHaveAttribute('data-state', 'untouched')
    expect(abramov[1]).toHaveTextContent('—')

    const belova = within(rows[1]).getAllByTestId('tasks-cell')
    expect(belova[0]).toHaveAttribute('data-state', 'partial')
    expect(belova[0]).toHaveTextContent('2 / 5')
    expect(belova[1]).toHaveAttribute('data-state', 'zero')
    expect(belova[1]).toHaveTextContent('0 / 3')
  })

  it('имя ученика — ссылка на карточку с ?course=<id> (§171), по student_id', async () => {
    draw()
    const links = await screen.findAllByTestId('tasks-matrix-student-link')
    expect(links[0]).toHaveAttribute('href', '/students/s1?course=course-1')
    expect(links[0]).toHaveTextContent('Абрамов Артём')
  })

  it('итог по ученику и по теме', async () => {
    draw()
    const rows = await screen.findAllByTestId('tasks-matrix-row')
    expect(rows[0]).toHaveTextContent('решено 5 из 8 по курсу')
    expect(rows[1]).toHaveTextContent('решено 2 из 8 по курсу')

    const footer = screen.getByTestId('tasks-matrix-footer')
    const cells = within(footer).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('1 из 2')
    expect(cells[1]).toHaveAttribute('title', 'решили все: 1 из 2 учеников')
    expect(cells[2]).toHaveTextContent('0 из 2')
  })

  it('в заголовке столбца — полное название темы подсказкой и число задач', async () => {
    draw()
    await screen.findByTestId('tasks-matrix')
    const th = screen.getByTitle('Кинематика: равноускоренное движение')
    expect(th.tagName).toBe('TH')
    expect(th).toHaveTextContent('5 задач')
  })

  it('блок «Тесты из банка» не рисуется без назначений', async () => {
    draw()
    await screen.findByTestId('tasks-matrix')
    // Дождаться, пока блок банка закончит грузиться, — и убедиться, что его нет.
    await vi.waitFor(() => expect(screen.queryByText(/Загрузка тестов из банка/)).not.toBeInTheDocument())
    expect(screen.queryByTestId('bank-block')).not.toBeInTheDocument()
    expect(screen.queryByText(/Тесты из банка/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Тесты ещё не прикреплены/)).not.toBeInTheDocument()
  })

  it('блок «Тесты из банка» есть, когда у курса есть назначение, и стоит ПОД задачами', async () => {
    mockBank({ assignments: [{ id: 'a1', topic_id: 't1', topic_tests: { id: 'tt1', title: 'Тест по кинематике' } }] })
    draw()
    const bank = await screen.findByTestId('bank-block')
    expect(within(bank).getByText('Тесты из банка')).toBeInTheDocument()
    expect(within(bank).getByText('Тест по кинематике')).toBeInTheDocument()

    const tasks = screen.getByTestId('tasks-block')
    expect(tasks.compareDocumentPosition(bank) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('пусто: ни одной темы с задачами — подсказка с названием каркаса для копии', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null })
    draw({ templateTitle: 'Физика ЕГЭ Шаблон' })
    const empty = await screen.findByTestId('tasks-matrix-empty')
    expect(empty).toHaveTextContent('Задачи к уроку ещё не прикреплены')
    expect(empty).toHaveTextContent('в каркасе курса «Физика ЕГЭ Шаблон» → тема → «Задачи» → «Подобрать в каталоге»')
  })

  it('пусто у курса без каркаса — подсказка без названия каркаса', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null })
    draw()
    const empty = await screen.findByTestId('tasks-matrix-empty')
    expect(empty).not.toHaveTextContent('каркасе')
    expect(empty).toHaveTextContent('«Подобрать в каталоге»')
  })

  it('темы с задачами есть, учеников нет — «нет учеников», а не «не прикреплены»', async () => {
    rpcSpy.mockResolvedValue({ data: [matrixRow('', '', 't1', { student_id: null, full_name: null })], error: null })
    draw()
    expect(await screen.findByTestId('tasks-matrix-no-students')).toHaveTextContent('В курсе пока нет учеников')
    expect(screen.queryByTestId('tasks-matrix-empty')).not.toBeInTheDocument()
  })

  it('ошибка RPC показывается, а не проглатывается', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    draw()
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
  })
})
