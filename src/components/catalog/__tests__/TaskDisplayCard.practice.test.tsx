import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/catalog/TaskContentRenderer', () => ({
  TaskContentRenderer: ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />,
}))
vi.mock('@/utils/resolveTaskHtml', () => ({ resolveTaskHtml: (html: string) => html ?? '' }))
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

import { TaskDisplayCard, type TaskPracticeProps } from '@/components/catalog/TaskDisplayCard'
import type { CatalogTask } from '@/hooks/useCatalog'
import type { CheckOutcome } from '@/hooks/useCatalogPractice'
import { normalizeCheckResult, type TaskPracticeState } from '@/lib/catalogRewards'

/**
 * §256. Задача каталога у ученика: поле ответа + «Проверить» у проверяемых
 * задач; ответ и решение открываются через раскрытие в базе (после него
 * задача не засчитывается); вердикт и награды — только из ответа базы.
 */
const task = {
  id: 't1', section_id: 's6', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 256100, position: 1, is_published: true,
  statement_html: '<p>2^(x−3) = 16</p>', has_answer: true, has_solution: true, answer_html: '<p>7</p>', solution_html: '<p>x − 3 = 4</p>',
  solution_plan_html: null, grade_criteria_html: null, difficulty: null, exam_part: 1, max_points: 1, partial_type: null,
  source_url: null, created_at: null, updated_at: null, is_completed: false,
} as unknown as CatalogTask

const fresh: TaskPracticeState = { taskId: 't1', checkable: true, attempts: 0, lastVerdict: null, solved: false, counted: false, revealed: false }
const result = (over: Record<string, unknown>) => normalizeCheckResult({
  verdict: 'correct', already_solved: false, counted: true, revealed_before: false, subject: 'math', n: 6, zone: 'growth',
  points: 5, solved: 4, milestone_bonus: 0, daily_bonus: 0, weekly_bonus: 0, answer_html: '<p>7</p>', ...over,
})

function setup(state: TaskPracticeState | undefined, onCheck: (a: string) => Promise<CheckOutcome>, onReveal = vi.fn(async () => '<p>7</p>')) {
  const practice: TaskPracticeProps = { state, onCheck, onReveal }
  const r = render(<TaskDisplayCard task={task} number={1} onToggle={() => {}} practice={practice} />)
  return { ...r, onReveal, rerenderWith: (s: TaskPracticeState) => r.rerender(<TaskDisplayCard task={task} number={1} onToggle={() => {}} practice={{ state: s, onCheck, onReveal }} />) }
}

async function answer(text: string) {
  fireEvent.change(screen.getByTestId('task-answer-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('task-answer-submit')) })
}

beforeEach(() => { toastSuccess.mockClear() })

describe('TaskDisplayCard — проверка ответа (§256)', () => {
  it('неверно: «Пока неверно…», кнопка «Проверить ещё раз», баллов и тоста нет', async () => {
    const onCheck = vi.fn(async () => ({ result: result({ verdict: 'wrong', counted: false, points: 0, answer_html: null }), change: null, error: null }))
    setup(fresh, onCheck)
    await answer('8')
    expect(onCheck).toHaveBeenCalledWith('8')
    expect(screen.getByTestId('task-answer-result')).toHaveAttribute('data-verdict', 'wrong')
    expect(screen.getByTestId('task-answer-result')).toHaveTextContent('Пока неверно. Попробуйте ещё раз или откройте решение.')
    expect(screen.getByTestId('task-answer-submit')).toHaveTextContent('Проверить ещё раз')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('верно и засчитано: «Верно! +5 баллов школы · +1 к прогнозу» и тост', async () => {
    const onCheck = vi.fn(async () => ({ result: result({}), change: { ready: true, delta: 1.1, score: 56.2 }, error: null }))
    setup(fresh, onCheck)
    await answer(' 7 ')
    const res = screen.getByTestId('task-answer-result')
    expect(res).toHaveAttribute('data-counted', 'true')
    expect(res).toHaveTextContent('Верно!')
    expect(res).toHaveTextContent('+5 баллов школы')
    expect(screen.getByTestId('task-answer-forecast')).toHaveTextContent('+1 к прогнозу')
    expect(toastSuccess).toHaveBeenCalledWith('+5 баллов школы · прогноз 56')
    expect(onCheck).toHaveBeenCalledWith('7')
  })

  it('пустой ответ до базы не уходит', async () => {
    const onCheck = vi.fn()
    setup(fresh, onCheck)
    await answer('   ')
    expect(onCheck).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Введите ответ')
  })

  it('«Показать ответ» сначала отмечает раскрытие в базе, потом показывает; подсказка меняется', async () => {
    const { onReveal, rerenderWith } = setup(fresh, vi.fn())
    expect(screen.getByTestId('task-answer-hint')).toHaveTextContent('Если открыть ответ или решение до проверки, задача в прогноз и баллы не пойдёт.')
    expect(screen.queryByText('Ответ', { selector: 'div' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(onReveal).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())
    rerenderWith({ ...fresh, revealed: true })
    expect(screen.getByTestId('task-answer-hint')).toHaveTextContent('Ответ открыт — эта задача в прогноз и баллы уже не пойдёт.')
  })

  it('«Показать решение» — тоже через раскрытие; ошибка раскрытия — ответа не показываем', async () => {
    const onReveal = vi.fn(async () => { throw new Error('сеть') })
    setup(fresh, vi.fn(), onReveal)
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-solution')) })
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть ответ')
    expect(screen.queryByText('x − 3 = 4')).toBeNull()
  })

  it('верно после раскрытия — «Верно, но ответ был открыт», без баллов и тоста', async () => {
    const onCheck = vi.fn(async () => ({ result: result({ counted: false, revealed_before: true, points: 0 }), change: null, error: null }))
    setup({ ...fresh, revealed: true }, onCheck)
    await answer('7')
    expect(screen.getByTestId('task-answer-result')).toHaveTextContent('Верно, но ответ был открыт — в прогноз и баллы не идёт')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('уже решена: поля нет, «Решено — засчитано»; раскрытие решённой задачи базу не трогает', async () => {
    const { onReveal } = setup({ ...fresh, solved: true, counted: true, attempts: 1, lastVerdict: 'correct' }, vi.fn())
    expect(screen.queryByTestId('task-answer-input')).toBeNull()
    expect(screen.getByTestId('task-answer-result')).toHaveTextContent('Решено — засчитано в прогноз и баллы')
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(onReveal).not.toHaveBeenCalled()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('повтор той же задачи — «уже решена», баллов нет', async () => {
    const onCheck = vi.fn(async () => ({ result: result({ already_solved: true, counted: false, points: 0 }), change: null, error: null }))
    setup(fresh, onCheck)
    await answer('7')
    expect(screen.getByTestId('task-answer-result')).toHaveTextContent('Верно — эта задача уже решена')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('непроверяемая (часть 2 / эталон без короткого ответа): поля нет, ответ — как раньше, без раскрытия', async () => {
    const { onReveal } = setup({ ...fresh, checkable: false }, vi.fn())
    expect(screen.queryByTestId('task-answer-check')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(onReveal).not.toHaveBeenCalled()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('без practice (персонал, корзина) — карточка как прежде', () => {
    render(<TaskDisplayCard task={task} number={1} />)
    expect(screen.queryByTestId('task-answer-check')).toBeNull()
  })

  it('ошибка базы (лимит) — текст ошибки', async () => {
    const onCheck = vi.fn(async () => ({ result: null, change: null, error: 'Слишком много проверок подряд — подождите минуту' }))
    setup(fresh, onCheck)
    await answer('7')
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много проверок подряд')
  })
})
