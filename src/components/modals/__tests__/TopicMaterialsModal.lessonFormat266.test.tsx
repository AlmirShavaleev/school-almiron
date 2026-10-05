import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * §266. Окно урока у учителя: переключатель пометки «Без пометки /
 * Тренировочный / Формат ЕГЭ»; у тренировочного вместо плитки ДЗ — задачи с
 * автопроверкой (просмотр, порядок, удаление) и результаты класса.
 */

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
const STATE = {
  topic_id: 't1', is_staff: true, total: 3, solved: 0, closed: 0, finished: false, grade: null,
  tasks: [1, 2, 3].map(n => ({
    id: `k${n}`, code: `1.4.1-Д-0${n}`, position: n, statement_path: `t1/s${n}.svg`,
    answer_type: n === 3 ? 'digits' : 'number', digits_any_order: n === 3, unit: n === 3 ? null : 'м',
    attempts_used: 0, attempts_left: 3, solved: false, closed: false, answers: [],
    answer_value: n === 3 ? null : n * 10, answer_tol: 0, answer_text: n === 3 ? '31' : null, solution_path: `t1/r${n}.svg`,
  })),
}
const RESULTS = {
  topic_id: 't1',
  tasks: STATE.tasks.map(t => ({ id: t.id, code: t.code, position: t.position })),
  students: [
    { student_id: 's1', name: 'Мира Ветрова', attempts: 4, solved: 2, closed: 3, finished: true, grade: 67,
      cells: [
        { task_id: 'k1', attempts: 1, solved: true, closed: true },
        { task_id: 'k2', attempts: 3, solved: false, closed: true },
        { task_id: 'k3', attempts: 0, solved: false, closed: false },
      ] },
    { student_id: 's2', name: 'Лев Ершов', attempts: 1, solved: 0, closed: 0, finished: false, grade: null,
      cells: [{ task_id: 'k1', attempts: 1, solved: false, closed: false }] },
  ],
}
const deleteError = { message: null as string | null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'topic_autocheck_state') return Promise.resolve({ data: STATE, error: null })
      if (fn === 'topic_autocheck_results') return Promise.resolve({ data: RESULTS, error: null })
      if (fn === 'topic_autocheck_delete' && deleteError.message) return Promise.resolve({ data: null, error: { message: deleteError.message } })
      return Promise.resolve({ data: 1, error: null })
    },
  },
}))
vi.mock('@/hooks/useTopicMaterials', () => ({
  useTopicMaterials: () => ({ materials: [], loading: false, saveMaterial: vi.fn(), uploadFile: vi.fn(), createLinkMaterial: vi.fn(), deleteMaterial: vi.fn() }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [], loading: false, error: null, reload: vi.fn(), uploadMaterialFile: vi.fn(), addMaterial: vi.fn(), deleteMaterial: vi.fn(), toggleVisibility: vi.fn(), moveMaterial: vi.fn() }),
}))
vi.mock('@/hooks/useTopicTest', () => ({
  useTopicTestAssignment: () => ({ assignment: null, loading: false }),
  useTestBank: () => ({ tests: [], loading: false }),
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({ homework: null, files: [], loading: false, error: null }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkEditor', () => ({ TopicHomeworkEditor: () => <div data-testid="hw-editor" /> }))
vi.mock('@/components/courseProgram/TopicTemplateBanner', () => ({ TopicTemplateBanner: () => null }))
vi.mock('@/components/courseProgram/TopicTrainingEditor', () => ({ TopicTrainingEditor: () => null }))
vi.mock('@/components/ui/SignedImage', () => ({
  SignedImage: ({ path, alt }: { path: string; alt: string }) => <img data-testid="signed" data-path={path} alt={alt} />,
}))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

import { TopicMaterialsModal } from '@/components/modals/TopicMaterialsModal'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'

function renderModal(props: Partial<React.ComponentProps<typeof TopicMaterialsModal>> = {}) {
  const onSaveTopicMeta = vi.fn(async () => {})
  render(
    <TopicMaterialsModal open onClose={vi.fn()} topicId="t1" topicTitle="1.4.1 Скорость, путь и время" moduleTitle="Кинематика" onSaveTopicMeta={onSaveTopicMeta} {...props} />,
  )
  return { onSaveTopicMeta }
}

describe('Пометка урока и задачи с автопроверкой в окне урока (§266)', () => {
  beforeEach(() => {
    useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any })
    rpcCalls.length = 0
    deleteError.message = null
  })

  it('по умолчанию «Без пометки», есть плитка ДЗ; «Тренировочный» сохраняется и меняет окно', async () => {
    const { onSaveTopicMeta } = renderModal()
    expect(screen.getByTestId('lesson-format-none')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('topic-tile-homework')).toBeInTheDocument()
    expect(screen.queryByTestId('autocheck-editor')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByTestId('lesson-format-training')) })
    expect(onSaveTopicMeta).toHaveBeenCalledWith({ lesson_format: 'training' })
    expect(screen.getByTestId('lesson-format-training')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('topic-tile-homework')).toBeNull()
    expect(await screen.findByTestId('autocheck-editor')).toBeInTheDocument()
  })

  it('отказ сохранения — пометка откатывается', async () => {
    const onSaveTopicMeta = vi.fn(async () => { throw new Error('нет прав') })
    renderModal({ onSaveTopicMeta, lessonFormat: 'ege' })
    await act(async () => { fireEvent.click(screen.getByTestId('lesson-format-training')) })
    expect(screen.getByTestId('lesson-format-ege')).toHaveAttribute('aria-pressed', 'true')
  })

  it('у проверочной пометки урока нет', () => {
    renderModal({ kind: 'check', lessonFormat: 'training' })
    expect(screen.queryByTestId('lesson-format')).toBeNull()
    expect(screen.queryByTestId('autocheck-editor')).toBeNull()
  })

  it('тренировочный: задачи с ответами, порядок и удаление через RPC, результаты класса', async () => {
    renderModal({ lessonFormat: 'training' })
    const editor = await screen.findByTestId('autocheck-editor')
    await waitFor(() => expect(within(editor).getAllByTestId('autocheck-editor-task')).toHaveLength(3))
    const rows = within(editor).getAllByTestId('autocheck-editor-task')
    expect(rows[0]).toHaveTextContent('1.4.1-Д-01')
    expect(rows[0]).toHaveTextContent('Ответ: 10 м')
    expect(rows[2]).toHaveTextContent('Ответ: 31 (порядок не важен)')

    // Раскрытие — условие и решение картинками.
    fireEvent.click(within(rows[1]).getByRole('button', { expanded: false }))
    expect(within(rows[1]).getAllByTestId('signed').map(i => i.getAttribute('data-path'))).toEqual(['t1/s2.svg', 't1/r2.svg'])

    await act(async () => { fireEvent.click(within(rows[1]).getByRole('button', { name: 'Выше' })) })
    expect(rpcCalls.find(c => c.fn === 'topic_autocheck_reorder')?.args).toEqual({ p_topic_id: 't1', p_task_ids: ['k2', 'k1', 'k3'] })

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteError.message = 'По задаче уже есть ответы учеников (3) — удалить её нельзя: изменились бы их оценки'
    await act(async () => { fireEvent.click(within(rows[2]).getByRole('button', { name: 'Удалить' })) })
    expect(rpcCalls.find(c => c.fn === 'topic_autocheck_delete')?.args).toEqual({ p_task_id: 'k3' })
    expect(toast.error).toHaveBeenCalledWith(deleteError.message)
    confirm.mockRestore()

    const table = within(editor).getByTestId('autocheck-results')
    expect(table).toHaveTextContent('закончили 1 из 2')
    const resRows = within(table).getAllByTestId('autocheck-results-row')
    expect(resRows[0]).toHaveTextContent('Лев Ершов')
    expect(resRows[1]).toHaveTextContent('Мира Ветрова')
    expect(resRows[1]).toHaveTextContent('2 из 3')
    expect(resRows[1]).toHaveTextContent('67')
    expect(within(resRows[1]).getAllByTestId('verdict-mark').map(m => m.getAttribute('data-state'))).toEqual(['ok', 'bad', 'none'])
    expect(within(resRows[0]).getAllByTestId('verdict-mark').map(m => m.getAttribute('data-state'))).toEqual(['part', 'none', 'none'])

    fireEvent.click(within(table).getByRole('button', { name: 'Сначала слабые' }))
    expect(within(table).getAllByTestId('autocheck-results-row')[0]).toHaveTextContent('Мира Ветрова')
  })
})
