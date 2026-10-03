import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §262. Карточка задачи каталога, когда тексты ответа и разбора ученику ещё не
 * положены (`answers_locked`, полей нет в данных). Подменён только транспорт
 * supabase; правило «когда открывать раскрытием, а когда просто дочитать» —
 * настоящее (TaskDisplayCard + src/lib/catalogTaskTexts.ts).
 */
const net = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown> | undefined]> }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      net.calls.push([fn, args])
      const reason = fn === 'catalog_reveal_answers' ? 'revealed' : 'solved'
      return Promise.resolve({ data: (args!.p_task_ids as string[]).map(id => ({
        task_id: id, allowed: true, reason, answer_html: '<p>42</p>', solution_html: '<p>Разбор: 6 · 7</p>',
        solution_plan_html: '<p>План: умножить</p>', grade_criteria_html: null, has_plan: true, has_criteria: false,
      })), error: null })
    },
  },
}))
vi.mock('@/components/catalog/TaskContentRenderer', () => ({
  TaskContentRenderer: ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />,
}))
vi.mock('@/utils/resolveTaskHtml', () => ({ resolveTaskHtml: (html: string) => html ?? '' }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import type { CatalogTask } from '@/hooks/useCatalog'
import type { TaskPracticeState } from '@/lib/catalogRewards'

const locked = {
  id: 'k1', section_id: 's5', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 62001, position: 1,
  statement_html: '<p>6 · 7 = ?</p>', has_answer: true, has_solution: true,
  answer_html: null, solution_html: null, solution_plan_html: null, grade_criteria_html: null,
  answers_locked: true, has_plan: true, has_criteria: false, exam_part: 1,
} as unknown as CatalogTask

const fresh: TaskPracticeState = { taskId: 'k1', checkable: true, attempts: 0, lastVerdict: null, solved: false, counted: false, revealed: false }

beforeEach(() => { net.calls = [] })

describe('TaskDisplayCard — закрытые тексты (§262)', () => {
  it('корзина/подборка (без practice): кнопки на месте, текста нет до клика; клик — раскрытие на сервере, потом ответ', async () => {
    render(<TaskDisplayCard task={locked} number={1} />)
    expect(screen.getByTestId('task-show-answer')).toHaveTextContent('Показать ответ')
    expect(screen.getByTestId('task-show-solution')).toBeInTheDocument()
    expect(screen.getByText('План решения')).toBeInTheDocument()
    expect(screen.queryByText('42')).toBeNull()
    expect(net.calls).toEqual([])

    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(net.calls).toEqual([['catalog_reveal_answers', { p_task_ids: ['k1'] }]])
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())

    // Решение — уже из полученного, второго запроса нет.
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-solution')) })
    expect(screen.getByText('Разбор: 6 · 7')).toBeInTheDocument()
    expect(net.calls).toHaveLength(1)
  })

  it('каталог ученика, задача не решена и не открыта: раскрытие идёт через practice.onReveal (баллы — как §256)', async () => {
    const onReveal = vi.fn(async () => ({
      task_id: 'k1', allowed: true, reason: 'revealed', answer_html: '<p>42</p>', solution_html: null,
      solution_plan_html: null, grade_criteria_html: null, has_plan: false, has_criteria: false,
    }))
    render(<TaskDisplayCard task={locked} number={1} practice={{ state: fresh, onCheck: vi.fn(), onReveal }} />)
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(net.calls).toEqual([])
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
  })

  it('задача уже решена (данные страницы устарели): текст дочитывается без отметки раскрытия', async () => {
    const onReveal = vi.fn()
    render(<TaskDisplayCard task={locked} number={1} practice={{ state: { ...fresh, solved: true, counted: true, attempts: 1, lastVerdict: 'correct' }, onCheck: vi.fn(), onReveal }} />)
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(onReveal).not.toHaveBeenCalled()
    expect(net.calls).toEqual([['catalog_task_texts', { p_task_ids: ['k1'] }]])
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
  })

  it('«План решения» у закрытой задачи — тоже через раскрытие', async () => {
    render(<TaskDisplayCard task={locked} number={1} />)
    await act(async () => { fireEvent.click(screen.getByText('План решения')) })
    expect(net.calls).toEqual([['catalog_reveal_answers', { p_task_ids: ['k1'] }]])
    await waitFor(() => expect(screen.getByText('План: умножить')).toBeInTheDocument())
  })

  it('персонал (тексты пришли полностью): ни одного запроса, ответ сразу', async () => {
    const staff = { ...locked, answers_locked: false, answer_html: '<p>42</p>', solution_html: '<p>Разбор</p>' } as CatalogTask
    render(<TaskDisplayCard task={staff} number={1} />)
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(net.calls).toEqual([])
  })
})
