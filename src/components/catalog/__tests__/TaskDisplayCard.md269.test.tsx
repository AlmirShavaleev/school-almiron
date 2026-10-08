import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §269. Карточка задачи переписанного каталога (Markdown + LaTeX): шапка «№ N · Задание K ЕГЭ · #код»,
 * формулы KaTeX (подгружается лениво — настоящий модуль), допуск ответа — только персоналу
 * (`catalog_task_answer_specs`), ответ-число с «−». Подменён только транспорт supabase.
 */
const net = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown> | undefined]> }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      net.calls.push([fn, args])
      if (fn === 'catalog_task_answer_specs') {
        return Promise.resolve({ data: [{ task_id: 'm2', answer_spec: { type: 'number', value: '-8', tol: 0.1 } }], error: null })
      }
      return Promise.resolve({ data: null, error: { message: 'нет' } })
    },
  },
}))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import { useAuthStore } from '@/store/authStore'
import { __resetStaffAnswerSpecCache } from '@/hooks/useStaffAnswerSpec'
import type { CatalogTask } from '@/hooks/useCatalog'

const md = {
  id: 'm2', section_id: 's1', subject: 'Физика', exam_type: 'ЕГЭ', external_id: 96090, position: 3,
  statement_html: '<!--md-->\nНайдите $a_x$.\n\n| $t$ | 1 |\n| --- | --- |\n| $x$ | 2 |\n\n<b>сырой</b>',
  answer_html: '−8', solution_html: '<!--md-->\n**Ответ:** $-8$.', solution_plan_html: null, grade_criteria_html: null,
  has_answer: true, has_solution: true, exam_part: 1,
} as unknown as CatalogTask

const legacy = {
  ...md, id: 'h1', external_id: 12345, statement_html: '<p>Старая задача</p>', answer_html: '-1,6',
} as unknown as CatalogTask

beforeEach(() => {
  net.calls = []
  __resetStaffAnswerSpecCache()
  useAuthStore.setState({ profile: { id: 's', role: 'student' } as never })
})

describe('TaskDisplayCard — задача в Markdown (§269)', () => {
  it('шапка: «№ N», «Задание K ЕГЭ», код «#96090»; формулы — KaTeX, таблица, сырой HTML — текстом', async () => {
    const { container } = render(<TaskDisplayCard task={md} number={3} examNumber={1} />)
    expect(screen.getByTestId('task-md-number')).toHaveTextContent('№ 3')
    expect(screen.getByTestId('task-exam-label')).toHaveTextContent('Задание 1 ЕГЭ')
    expect(screen.getByTestId('task-code')).toHaveTextContent('#96090')
    expect(screen.queryByText('#3')).toBeNull()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('<b>сырой</b>')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.catalog-math-pending')).toBeNull())
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3)
  })

  it('ученик: ответ «−8», допуска нет и запроса эталона нет', async () => {
    render(<TaskDisplayCard task={md} number={1} defaultOpen={{ answer: true }} />)
    expect(screen.getByText('−8')).toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('task-answer-tolerance')).toBeNull()
    expect(net.calls.filter(c => c[0] === 'catalog_task_answer_specs')).toEqual([])
  })

  it('учитель: под ответом «засчитываем от −8,1 до −7,9» — только после раскрытия ответа', async () => {
    useAuthStore.setState({ profile: { id: 't', role: 'teacher' } as never })
    render(<TaskDisplayCard task={md} number={1} />)
    expect(net.calls).toEqual([])
    await act(async () => { fireEvent.click(screen.getByTestId('task-show-answer')) })
    await waitFor(() => expect(screen.getByTestId('task-answer-tolerance')).toHaveTextContent('засчитываем от −8,1 до −7,9'))
    expect(net.calls).toEqual([['catalog_task_answer_specs', { p_task_ids: ['m2'] }]])
  })

  it('старая HTML-задача: шапки нет, номер «#N» как раньше, ответ-число — с «−», эталон не запрашивается', async () => {
    useAuthStore.setState({ profile: { id: 't', role: 'teacher' } as never })
    render(<TaskDisplayCard task={legacy} number={2} examNumber={1} defaultOpen={{ answer: true }} />)
    expect(screen.queryByTestId('task-md-header')).toBeNull()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('Старая задача')).toBeInTheDocument()
    expect(screen.getByText('−1,6')).toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(net.calls).toEqual([])
  })
})
