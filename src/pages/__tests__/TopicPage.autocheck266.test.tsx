import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §266. Тренировочный урок у ученика: пометка в шапке, вкладка
 * «Автопроверка» вместо ДЗ, ввод ответа (не число — без запроса, попытка не
 * тратится), закрытая задача — вердикт и решение. Урок «Формат ЕГЭ» — как
 * раньше, задачи автопроверки не запрашиваются.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000266'
const GROUP = 'g0000000-0000-0000-0000-000000000266'

const lesson = { format: 'training' as string | null }
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

function task(id: string, n: number, over: Record<string, unknown> = {}) {
  return {
    id, code: `1.4.1-Д-0${n}`, position: n, statement_path: `${TOPIC}/s${n}.svg`, answer_type: 'number',
    digits_any_order: false, unit: 'м', attempts_used: 0, attempts_left: 3, solved: false, closed: false,
    answers: [], answer_value: null, answer_tol: null, answer_text: null, solution_path: null, ...over,
  }
}
const OPEN_STATE = {
  topic_id: TOPIC, is_staff: false, total: 2, solved: 0, closed: 0, finished: false, grade: null,
  tasks: [task('t1', 1), task('t2', 2, {
    attempts_used: 3, attempts_left: 0, closed: true,
    answers: [{ attempt_no: 1, answer: '7', correct: false }, { attempt_no: 2, answer: '9', correct: false }, { attempt_no: 3, answer: '10', correct: false }],
    answer_value: 8, answer_tol: 0, solution_path: `${TOPIC}/r2.svg`, unit: 'мин',
  })],
}
const AFTER_CORRECT = {
  ...OPEN_STATE, solved: 1, closed: 2, finished: true, grade: 50,
  tasks: [task('t1', 1, {
    attempts_used: 1, attempts_left: 2, solved: true, closed: true,
    answers: [{ attempt_no: 1, answer: '100', correct: true }], answer_value: 100, answer_tol: 0, solution_path: `${TOPIC}/r1.svg`,
  }), OPEN_STATE.tasks[1]],
}

function chain(result: unknown, count = 0) {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'topics') return chain({
        id: TOPIC, title: '1.4.1 Скорость, путь и время', order_index: 0, available_from: null, kind: 'lesson',
        lesson_format: lesson.format,
        modules: { id: 'mod-1', title: 'Кинематика', courses: { id: 'c1', title: 'Физика', subject: 'physics' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: '10А' })
      // ДЗ-носитель есть: счёт ДЗ темы = 1.
      if (table === 'topic_homework') return chain(null, 1)
      return chain(null, 0)
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'topic_autocheck_state') return Promise.resolve({ data: OPEN_STATE, error: null })
      if (fn === 'topic_autocheck_check') {
        return Promise.resolve({ data: { task_id: 't1', correct: true, closed: true, grade: 50, state: AFTER_CORRECT }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))
const AUTH = { profile: { id: 'u1', role: 'student' } }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel(AUTH),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [], loading: false, error: null }),
}))
vi.mock('@/hooks/useTopicTraining', () => ({
  useTopicTraining: () => ({ subtopics: [], loading: false, error: null, setSubtopicHidden: vi.fn() }),
}))
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: false, unlocked: true, loading: false }),
}))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({
  TopicHomeworkStudent: () => <div data-testid="hw-upload">ДЗ на проверку</div>,
}))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))
vi.mock('@/components/ui/SignedImage', () => ({
  SignedImage: ({ path, alt }: { path: string; alt: string }) => <img data-testid="signed" data-path={path} alt={alt} />,
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

describe('Тренировочный урок (§266)', () => {
  beforeEach(() => {
    lesson.format = 'training'
    rpcCalls.length = 0
  })

  it('шапка: «Тренировочный»; вкладка «Автопроверка» вместо «Домашнего задания»', async () => {
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(screen.getByTestId('lesson-format-mark')).toHaveTextContent('Тренировочный')
    await waitFor(() => expect(screen.getByRole('tab', { name: /Автопроверка/ })).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: /Домашнее задание/ })).toBeNull()
    // Вкладка видна сразу по формату урока, состояние задач приходит отдельным
    // запросом — ждём его, а не полагаемся на порядок ответов (§271 добавил ещё один).
    expect(await screen.findByTestId('topic-group-autocheck-state')).toHaveTextContent('решено 0 из 2')
  })

  it('открытая задача: «Введите число» без запроса; верный ответ — вердикт, решение, оценка', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Автопроверка/ }))
    const block = await screen.findByTestId('autocheck-block')
    expect(within(block).getByTestId('autocheck-summary')).toHaveTextContent('Решено 0 из 2 · оценка после всех задач')

    const [open, failed] = within(block).getAllByTestId('autocheck-task')
    expect(open).toHaveAttribute('data-state', 'open')
    expect(within(open).getByTestId('autocheck-tries')).toHaveTextContent('Осталось попыток: 3')
    // До закрытия решения нет — ни картинки, ни пути.
    expect(within(open).queryByTestId('autocheck-solution')).toBeNull()

    // Проваленная: ответ и решение пришли от сервера, поля нет.
    expect(failed).toHaveAttribute('data-state', 'failed')
    expect(within(failed).getByTestId('autocheck-verdict')).toHaveTextContent('Попытки закончились. Верный ответ: 8 мин')
    expect(within(failed).queryByTestId('autocheck-input')).toBeNull()
    expect(within(failed).getByTestId('autocheck-solution').querySelector('img')).toHaveAttribute('data-path', `${TOPIC}/r2.svg`)

    const input = within(open).getByTestId('autocheck-input')
    fireEvent.change(input, { target: { value: 'сто' } })
    fireEvent.click(within(open).getByTestId('autocheck-submit'))
    expect(await within(open).findByText('Введите число')).toBeInTheDocument()
    expect(rpcCalls.some(c => c.fn === 'topic_autocheck_check')).toBe(false)

    fireEvent.change(input, { target: { value: ' 100,0 ' } })
    fireEvent.click(within(open).getByTestId('autocheck-submit'))
    await waitFor(() => expect(screen.getByTestId('autocheck-summary')).toHaveTextContent('Решено 1 из 2 · оценка 50 из 100'))
    expect(rpcCalls.find(c => c.fn === 'topic_autocheck_check')?.args).toEqual({ p_task_id: 't1', p_answer: ' 100,0 ' })

    const solved = screen.getAllByTestId('autocheck-task')[0]
    expect(solved).toHaveAttribute('data-state', 'solved')
    expect(within(solved).getByTestId('autocheck-verdict')).toHaveTextContent('Верно')
    expect(within(solved).getByTestId('autocheck-solution').querySelector('img')).toHaveAttribute('data-path', `${TOPIC}/r1.svg`)
    expect(screen.getByTestId('topic-group-autocheck-state')).toHaveTextContent('оценка 50 из 100')
  })

  it('урок «Формат ЕГЭ»: пометка, обычное ДЗ, автопроверка не запрашивается', async () => {
    lesson.format = 'ege'
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(screen.getByTestId('lesson-format-mark')).toHaveTextContent('Формат ЕГЭ')
    fireEvent.click(screen.getByRole('tab', { name: /Домашнее задание/ }))
    expect(await screen.findByTestId('hw-upload')).toBeInTheDocument()
    expect(rpcCalls.some(c => c.fn.startsWith('topic_autocheck'))).toBe(false)
  })

  it.each(['training', 'ege', null])('§271: «Оцените урок» — последним блоком темы при формате %s; своя оценка читается', async format => {
    lesson.format = format
    const { container } = renderPage()
    const block = await screen.findByTestId('topic-rating')
    // Блок — последний на странице темы, под содержимым вкладки.
    expect(container.firstElementChild?.lastElementChild).toBe(block)
    expect(within(block).getAllByRole('button', { name: /^Оценка \d+ из 10$/ })).toHaveLength(10)
    await waitFor(() => expect(rpcCalls.some(c => c.fn === 'my_topic_rating' && c.args.p_topic_id === TOPIC)).toBe(true))
  })

  it('урок без пометки — как до §266: ни метки, ни автопроверки', async () => {
    lesson.format = null
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(screen.queryByTestId('lesson-format-mark')).toBeNull()
    expect(screen.getByRole('tab', { name: /Домашнее задание/ })).toBeInTheDocument()
    expect(rpcCalls.some(c => c.fn.startsWith('topic_autocheck'))).toBe(false)
  })
})
