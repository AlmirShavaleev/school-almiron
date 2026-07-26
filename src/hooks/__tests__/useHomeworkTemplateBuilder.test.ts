import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHomeworkTemplateBuilder } from '@/hooks/useHomeworkTemplateBuilder'
import type { CatalogTask } from '@/hooks/useCatalog'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

function task(id: string, overrides: Partial<CatalogTask> = {}): CatalogTask {
  return {
    id, external_id: Number(id.replace(/\D/g, '')) || 1, section_id: 's1', subject: 'Математика', exam_type: 'ЕГЭ',
    statement_html: '<p>условие</p>', answer_html: '42', solution_html: null,
    solution_plan_html: null, grade_criteria_html: null, has_answer: true, has_solution: false,
    position: 1, exam_part: 1, max_points: 5,
    ...overrides,
  }
}

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: { template_id: 'tmpl-1', template_version_id: 'v-1', version: 1 }, error: null })
})

describe('useHomeworkTemplateBuilder', () => {
  it('addTask добавляет задачу с автозаполненным grading', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].grading_mode).toBe('numeric_tolerance')
    expect(result.current.items[0].max_score).toBe(5)
  })

  it('повторное добавление той же задачи не создаёт дубль', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.addTask(task('t1')))
    expect(result.current.items).toHaveLength(1)
  })

  it('removeTask удаляет задачу', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.addTask(task('t2')))
    act(() => result.current.removeTask('t1'))
    expect(result.current.items.map(i => i.catalog_task_id)).toEqual(['t2'])
  })

  it('moveItem меняет порядок (up/down)', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.addTask(task('t2')))
    act(() => result.current.addTask(task('t3')))
    act(() => result.current.moveItem(0, 1)) // t1 down -> t2,t1,t3
    expect(result.current.items.map(i => i.catalog_task_id)).toEqual(['t2', 't1', 't3'])
    act(() => result.current.moveItem(1, -1)) // t1 up -> t1,t2,t3
    expect(result.current.items.map(i => i.catalog_task_id)).toEqual(['t1', 't2', 't3'])
  })

  it('moveItem за границей списка ничего не делает', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.moveItem(0, -1))
    expect(result.current.items.map(i => i.catalog_task_id)).toEqual(['t1'])
  })

  it('updateItem меняет custom_number', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.updateItem('t1', { custom_number: '5а' }))
    expect(result.current.items[0].custom_number).toBe('5а')
  })

  it('updateItem меняет grading_mode на manual сбрасывает spec/ai (через компонент), но hook сам просто хранит переданный patch', () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.updateItem('t1', { grading_mode: 'rubric', grading_spec: { criteria: [{ id: 'c1', title: 'A', description: '', max_score: 5 }] } }))
    expect(result.current.items[0].grading_mode).toBe('rubric')
    expect((result.current.items[0].grading_spec as any).criteria).toHaveLength(1)
  })

  it('save вызывает create_or_update_template_draft с items в правильном порядке и position', async () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    act(() => result.current.addTask(task('t1')))
    act(() => result.current.addTask(task('t2')))
    await act(async () => {
      await result.current.save({ templateId: null, courseId: 'c1', title: 'Тест', instructions: '', maxScore: null })
    })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    const [name, args] = rpcMock.mock.calls[0]
    expect(name).toBe('create_or_update_template_draft')
    expect(args.p_items).toHaveLength(2)
    expect(args.p_items[0]).toMatchObject({ catalog_task_id: 't1', position: 1 })
    expect(args.p_items[1]).toMatchObject({ catalog_task_id: 't2', position: 2 })
  })

  it('save с существующим templateId передаёт его как p_template_id (загрузка/обновление существующего draft)', async () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    await act(async () => {
      await result.current.save({ templateId: 'existing-tmpl', courseId: 'c1', title: 'T', instructions: '', maxScore: null })
    })
    const [, args] = rpcMock.mock.calls[0]
    expect(args.p_template_id).toBe('existing-tmpl')
  })

  it('save с пустым items передаёт p_items=null', async () => {
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    await act(async () => {
      await result.current.save({ templateId: null, courseId: 'c1', title: 'T', instructions: '', maxScore: null })
    })
    const [, args] = rpcMock.mock.calls[0]
    expect(args.p_items).toBeNull()
  })

  it('save при ошибке RPC выставляет error и пробрасывает исключение', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'TITLE_REQUIRED' } })
    const { result } = renderHook(() => useHomeworkTemplateBuilder())
    let thrown: unknown = null
    await act(async () => {
      try {
        await result.current.save({ templateId: null, courseId: 'c1', title: '', instructions: '', maxScore: null })
      } catch (e) {
        thrown = e
      }
    })
    expect(thrown).toBeTruthy()
    expect(result.current.error).toBeTruthy()
  })
})
