import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useStaffModeStore } from '@/store/staffModeStore'
import { useToastStore } from '@/store/toastStore'

/**
 * §178/§179. Страница темы в предпросмотре глазами ученика — приёмочный
 * тест: владелец (owner) в режиме `student` видит ученическую вёрстку с
 * лентой задач из `topic_tasks_for_staff`; задачи и «Отметить как сделанное»
 * работают в памяти вкладки (§179): вердикт — чистая `preview_task_verdict`,
 * разбор — из `catalog_tasks`; ДЗ и тест из банка по-прежнему выключены. И
 * НИ ОДНА RPC/таблица записи не вызывается — даже если действия дёргать
 * руками.
 *
 * Хуки ученика здесь настоящие (задачи, отметки, состояние ДЗ, блок ДЗ, тест
 * из банка); подменён только Supabase — со шпионом на каждый вызов.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

const rpc = vi.fn()
const queried: string[] = []
const written: string[] = []
const topicRow = { is_open: true as boolean | null, title: 'Кинематика' }
const CORRECT = '42'

function chain(result: unknown, count = 0) {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}

const STAFF_ROWS = [
  { item_id: 'item-1', item_position: 1, task_id: 'task-1', external_id: 101, statement_html: 'Условие 1', exam_part: 1, max_points: 1, auto_checkable: true, answers_count: 12, closed_count: 7 },
  { item_id: 'item-2', item_position: 2, task_id: 'task-2', external_id: 102, statement_html: 'Условие 2', exam_part: 1, max_points: 1, auto_checkable: true, answers_count: 0, closed_count: 0 },
  { item_id: 'item-3', item_position: 3, task_id: 'task-3', external_id: 103, statement_html: 'Условие 3', exam_part: 2, max_points: 3, auto_checkable: false, answers_count: 0, closed_count: 0 },
]
const ASSETS = [{ id: 'a1', task_id: 'task-1', tex_session_id: null, kind: 'image', storage_path: 'catalog/a1.png', alt: null, position: 1 }]
const CATALOG_TASK = { answer_html: `<p>${CORRECT}</p>`, solution_html: '<p>Разбор из каталога</p>', solution_plan_html: null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc(name, args)
      if (name === 'topic_tasks_for_staff') return Promise.resolve({ data: STAFF_ROWS, error: null })
      if (name === 'topic_solution_state') return Promise.resolve({ data: { has_solution: false, has_homework: true, unlocked: false }, error: null })
      if (name === 'topic_test_assignment_items') return Promise.resolve({ data: [{ id: 'ti-1', max_points: 1, exam_part: 1, statement_html: 'Тест 1', assets: [] }], error: null })
      // Чистый вердикт (§179): как база — true/false по эталону, без записи.
      if (name === 'preview_task_verdict') return Promise.resolve({ data: args.p_answer_raw === CORRECT, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      queried.push(table)
      const c = chain(null, 0)
      // Любая запись в таблицу — в список; такого в предпросмотре быть не должно.
      for (const m of ['insert', 'update', 'delete', 'upsert']) c[m] = () => { written.push(`${table}.${m}`); return c }
      if (table === 'topics') return Object.assign(chain({
        id: TOPIC, title: topicRow.title, order_index: 0, available_from: null, is_open: topicRow.is_open,
        modules: { id: 'mod-1', title: 'Механика', courses: { id: 'c1', title: 'Физика', subject: 'physics' } },
      }), { insert: c.insert, update: c.update, delete: c.delete })
      if (table === 'groups') return chain({ id: GROUP, name: '11А' })
      if (table === 'topic_homework') {
        const hw = { id: 'hw-1', topic_id: TOPIC, title: 'ДЗ №1', instructions: null, due_at: null, grade_scale: 'five', is_published: true }
        return Object.assign(chain(hw, 1), { insert: c.insert, update: c.update, delete: c.delete })
      }
      if (table === 'topic_test_assignments') return chain({ id: 'as-1', topic_tests: { id: 't-1', title: 'Тест по теме', description: null } }, 1)
      if (table === 'catalog_task_assets') return chain(ASSETS)
      if (table === 'catalog_tasks') return chain(CATALOG_TASK)
      if (table === 'topic_homework_files') return chain([])
      if (table === 'students') return chain(null)
      return c
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  },
}))

const PROFILE = { id: 'owner-1', role: 'owner' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: PROFILE }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [{ kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'theory', storagePath: `${TOPIC}/a.pdf`, fileName: 'a.pdf', sizeBytes: 1 }], loading: false, error: null }),
}))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))
vi.mock('@/components/catalog/CatalogTaskContent', () => ({
  CatalogTaskContent: ({ task, showControls }: { task: { statement_html: string; assets: unknown[]; solution_html: string | null; answer_html: string | null }; showControls?: boolean }) => (
    <div>
      <div data-testid="statement" data-assets={task.assets.length}>{task.statement_html}</div>
      {showControls && task.solution_html && <div data-testid="solution">{task.solution_html}</div>}
      {showControls && task.answer_html && <div data-testid="answer">{task.answer_html}</div>}
    </div>
  ),
}))

import { TopicPage } from '@/pages/TopicPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const WRITE_RPCS = [
  'answer_topic_task', 'reveal_topic_task_solution', 'close_topic_task_self', 'ensure_topic_task_rows',
  'topic_homework_start_attempt', 'topic_homework_submit_attempt',
  'topic_test_start_attempt', 'topic_test_save_answer', 'topic_test_submit_attempt',
  'record_material_view', 'topic_tasks_for_student', 'topic_student_variants',
]
const WRITE_TABLES = ['topic_section_marks', 'topic_homework_attempts', 'topic_homework_attempt_files', 'topic_test_attempts', 'topic_test_answers', 'test_variant_answers', 'test_variant_student_assignments']
function calledRpcs() {
  return rpc.mock.calls.map(c => c[0] as string)
}
function expectNothingWritten() {
  for (const name of WRITE_RPCS) {
    expect(rpc, name).not.toHaveBeenCalledWith(name, expect.anything())
  }
  expect(written).toEqual([])
  for (const table of WRITE_TABLES) {
    expect(queried, table).not.toContain(table)
  }
}

async function openTasks() {
  renderPage()
  fireEvent.click(await screen.findByRole('tab', { name: /Задачи/ }))
  await screen.findByTestId('topic-tasks-strip')
}
function square(n: number) {
  return within(screen.getByTestId('topic-tasks-strip')).getByRole('button', { name: new RegExp(`^Задача ${n},`) })
}
async function submitAnswer(raw: string) {
  fireEvent.change(screen.getByLabelText('Ответ на задачу'), { target: { value: raw } })
  fireEvent.click(screen.getByRole('button', { name: /^Проверить/ }))
}

describe('Страница темы в предпросмотре глазами ученика (§178, §179)', () => {
  beforeEach(() => {
    rpc.mockClear()
    queried.length = 0
    written.length = 0
    localStorage.clear()
    topicRow.is_open = true
    useToastStore.setState({ toasts: [] })
    useStaffModeStore.setState({ mode: 'student', profileId: 'owner-1', choiceMade: true })
  })

  it('открывается без строки students и показывает ученические группы вкладок', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Кинематика' })).toBeInTheDocument()
    expect(screen.getByTestId('topic-tab-group-theory')).toBeInTheDocument()
    expect(queried).not.toContain('students')
  })

  it('лента задач — из topic_tasks_for_staff, всё «не начато», картинки условий на месте', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Задачи/ }))

    const strip = await screen.findByTestId('topic-tasks-strip')
    const squares = within(strip).getAllByRole('button')
    expect(squares).toHaveLength(3)
    expect(squares.every(b => b.getAttribute('data-state') === 'untouched')).toBe(true)
    expect(screen.getByText(/Решено 0 из 3/)).toBeInTheDocument()
    expect(screen.getByTestId('topic-group-tasks-state')).toHaveTextContent('решено 0 из 3')
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 1')
    expect(screen.getByTestId('statement')).toHaveAttribute('data-assets', '1')
    expect(screen.getByTestId('topic-task-card')).toHaveAttribute('data-preview', 'true')
    expect(calledRpcs()).toContain('topic_tasks_for_staff')
    expect(calledRpcs()).not.toContain('topic_tasks_for_student')
  })

  it('поле ответа и «Проверить» работают, подсказок «не сохраняется» на них нет; разбор — только после попытки', async () => {
    await openTasks()

    const input = screen.getByLabelText('Ответ на задачу')
    expect(input).toBeEnabled()
    expect(input).not.toHaveAttribute('title')
    expect(input).toHaveAttribute('placeholder', 'Ответ')
    // «Проверить» ждёт ввода, как у ученика; до первой попытки разбора нет.
    expect(screen.getByRole('button', { name: /^Проверить/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Посмотреть решение/ })).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '1' } })
    expect(screen.getByRole('button', { name: /^Проверить/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Проверить/ })).not.toHaveAttribute('title')

    // Вторая часть: «Посмотреть решение» доступна сразу.
    fireEvent.click(square(3))
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 3')
    expect(screen.queryByLabelText('Ответ на задачу')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Посмотреть решение/ })).toBeEnabled()
  })

  it('верный ответ → «Верно», квадрат зелёный, счёт растёт; вызвана только preview_task_verdict', async () => {
    await openTasks()
    rpc.mockClear()

    await submitAnswer(CORRECT)
    expect(await screen.findByText('Верно')).toBeInTheDocument()
    expect(screen.getByTestId('topic-task-card')).toHaveAttribute('data-verdict', 'solved')
    expect(screen.getByText('решена с первой попытки')).toBeInTheDocument()
    expect(square(1)).toHaveAttribute('data-state', 'solved')
    // Карточка на месте, не перескочила на следующую.
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 1')
    expect(screen.getByText(/Решено 1 из 3/)).toBeInTheDocument()
    expect(screen.getByTestId('topic-group-tasks-state')).toHaveTextContent('решено 1 из 3')

    expect(calledRpcs()).toEqual(['preview_task_verdict'])
    expect(rpc).toHaveBeenCalledWith('preview_task_verdict', { p_task_id: 'task-1', p_answer_raw: CORRECT })
    expect(useToastStore.getState().toasts).toEqual([])
    expectNothingWritten()
  })

  it('неверный → «Неверно · попытка 1», затем разбор из catalog_tasks, поле исчезает, «Разобрал» → «Разобрана»', async () => {
    await openTasks()
    fireEvent.click(square(2))
    rpc.mockClear()
    queried.length = 0

    await submitAnswer('7')
    const alert = await screen.findByTestId('topic-task-wrong')
    expect(alert).toHaveTextContent('Неверно · попытка 1')
    expect(screen.getByTestId('topic-task-card')).toHaveAttribute('data-verdict', 'wrong')
    expect(screen.getByLabelText('Ответ на задачу')).toHaveValue('7')
    expect(square(2)).toHaveAttribute('data-state', 'attempted')
    expect(screen.getByText(/Решено 0 из 3/)).toBeInTheDocument()

    // После первой попытки — разбор.
    const reveal = screen.getByRole('button', { name: /Посмотреть решение/ })
    expect(reveal).toBeEnabled()
    fireEvent.click(reveal)
    expect(await screen.findByTestId('solution')).toHaveTextContent('Разбор из каталога')
    expect(screen.getByTestId('answer')).toHaveTextContent(CORRECT)
    expect(queried).toContain('catalog_tasks')
    expect(screen.queryByLabelText('Ответ на задачу')).not.toBeInTheDocument()
    expect(screen.getByText('самопроверка по решению')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Разобрал/ }))
    expect(await screen.findByText('Разобрана')).toBeInTheDocument()
    expect(square(2)).toHaveAttribute('data-state', 'solved')
    expect(square(2)).toHaveAccessibleName('Задача 2, разобрана')
    expect(screen.getByText(/Решено 1 из 3/)).toBeInTheDocument()
    expect(screen.getByTestId('topic-group-tasks-state')).toHaveTextContent('решено 1 из 3')

    expect(new Set(calledRpcs())).toEqual(new Set(['preview_task_verdict']))
    expectNothingWritten()
  })

  it('вторая часть: «Посмотреть решение» → «Разобрал» без вердикта; всё решено → «Все задачи решены»', async () => {
    await openTasks()
    await submitAnswer(CORRECT)
    await screen.findByText('Верно')
    fireEvent.click(square(2))
    await submitAnswer(CORRECT)
    await screen.findByText('Верно')
    fireEvent.click(square(3))
    rpc.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Посмотреть решение/ }))
    await screen.findByTestId('solution')
    fireEvent.click(screen.getByRole('button', { name: /Разобрал/ }))
    expect(await screen.findByText('Разобрана')).toBeInTheDocument()
    expect(screen.getByText(/Решено 3 из 3/)).toBeInTheDocument()
    expect(screen.getByTestId('topic-tasks-all-solved')).toBeInTheDocument()
    expect(screen.getByTestId('topic-group-tasks-state')).toHaveTextContent('решено 3 из 3 ✓')
    expect(rpc).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('«Отметить как сделанное» работает в памяти: отметка ставится и снимается, таблица отметок не трогается', async () => {
    renderPage()
    const mark = await screen.findByTestId('topic-group-mark-theory')
    expect(mark).toBeEnabled()
    expect(mark).not.toHaveAttribute('title')
    expect(mark).toHaveTextContent('Отметить как сделанное')

    fireEvent.click(mark)
    await waitFor(() => expect(screen.getByTestId('topic-group-mark-theory')).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByTestId('topic-group-mark-theory')).toHaveTextContent('Отметил сам')
    expect(useToastStore.getState().toasts).toEqual([])

    fireEvent.click(screen.getByTestId('topic-group-mark-theory'))
    await waitFor(() => expect(screen.getByTestId('topic-group-mark-theory')).toHaveAttribute('aria-pressed', 'false'))

    expect(queried).not.toContain('topic_section_marks')
    expect(written).toEqual([])
  })

  it('ДЗ — блок ученика «не сдано», кнопка сдачи выключена, попытки не читаются', async () => {
    renderPage()
    expect(await screen.findByTestId('topic-group-homework-state')).toHaveTextContent('Не сдано')

    fireEvent.click(screen.getByRole('tab', { name: /Домашнее задание/ }))
    const start = await screen.findByTestId('hw-start-attempt')
    expect(start).toBeDisabled()
    expect(start).toHaveAttribute('title', 'В предпросмотре не сохраняется')
    expect(screen.getByText('ДЗ №1')).toBeInTheDocument()
    expect(queried).not.toContain('topic_homework_attempts')
    expect(queried).not.toContain('topic_homework_reviews')
  })

  it('тест из банка — «Начать тест» выключена, попытка не читается', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Задачи/ }))
    const start = await screen.findByRole('button', { name: 'Начать тест' })
    expect(start).toBeDisabled()
    expect(queried).not.toContain('topic_test_attempts')
  })

  it('ни одна RPC записи не вызывается — весь путь ученика руками, включая работающие теперь действия', async () => {
    await openTasks()

    // Задачи: неверный ответ (Enter в поле), верный, разбор, «Разобрал» —
    // всё работает, но пишет только в память вкладки (§179).
    const input = screen.getByLabelText('Ответ на задачу')
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByTestId('topic-task-wrong')
    fireEvent.click(screen.getByRole('button', { name: /Посмотреть решение/ }))
    await screen.findByTestId('solution')
    fireEvent.click(screen.getByRole('button', { name: /Разобрал/ }))
    await screen.findByText('Разобрана')
    fireEvent.click(square(2))
    await submitAnswer(CORRECT)
    await screen.findByText('Верно')
    expect(screen.getByText(/Решено 2 из 3/)).toBeInTheDocument()

    // Отметка группы — в памяти; ДЗ и тест из банка — по-прежнему noop.
    fireEvent.click(screen.getByTestId('topic-group-mark-theory'))
    fireEvent.click(screen.getByRole('button', { name: 'Начать тест' }))
    fireEvent.click(screen.getByRole('tab', { name: /Домашнее задание/ }))
    fireEvent.click(await screen.findByTestId('hw-start-attempt'))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Кинематика' })).toBeInTheDocument())
    expectNothingWritten()
    // Из RPC вообще — только чтение состава, состояние решения и вердикт.
    expect(new Set(calledRpcs())).toEqual(new Set(['topic_tasks_for_staff', 'topic_solution_state', 'topic_test_assignment_items', 'preview_task_verdict']))
  })

  it('закрытая тумблером тема в предпросмотре заперта, как у ученика', async () => {
    // Персоналу база отдаёт и закрытую тему — обход в предпросмотре не действует.
    topicRow.is_open = false
    renderPage()
    expect(await screen.findByText('Тема ещё не открыта')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Задачи/ })).not.toBeInTheDocument()
  })
})
