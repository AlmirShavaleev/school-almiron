import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { buildTrainingSubtopics, TRAINING_ROLES, type TrainingItemRow } from '@/lib/training'

/**
 * §234. Блок «Тренировка» в редакторе темы: подтемы с числом файлов и
 * переключателем «видят / скрыта», который пишет скрытие этого класса.
 */

const setSubtopicHidden = vi.fn(async () => {})
const state = { hidden: ['1.15'] as string[], empty: false }
const rows = (code: string): TrainingItemRow[] => TRAINING_ROLES.map(r => ({
  id: `${code}-${r.position}`, topic_id: 't', kind: 'file', title: null, storage_path: `t/${code}-${r.position}.pdf`,
  file_name: null, size_bytes: null, position: r.position, is_visible: true, section: r.section,
  subtopic_code: code, subtopic_title: `Подтема ${code}`,
}))

vi.mock('@/hooks/useTopicTraining', () => ({
  useTopicTraining: () => ({
    subtopics: state.empty ? [] : buildTrainingSubtopics([...rows('1.17'), ...rows('1.14'), ...rows('1.15')], state.hidden),
    loading: false, error: null, setSubtopicHidden,
  }),
}))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), error: vi.fn() } }))

import { TopicTrainingEditor } from '@/components/courseProgram/TopicTrainingEditor'

describe('TopicTrainingEditor (§234)', () => {
  beforeEach(() => { setSubtopicHidden.mockClear(); state.hidden = ['1.15']; state.empty = false })

  it('подтемы по порядку, с числом файлов и состоянием', () => {
    render(<TopicTrainingEditor topicId="t" />)
    const list = screen.getAllByTestId('training-editor-row')
    expect(list.map(r => r.getAttribute('data-code'))).toEqual(['1.14', '1.15', '1.17'])
    expect(list[0]).toHaveTextContent('7 файлов')
    expect(within(list[0]).getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(within(list[1]).getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(within(list[1]).getByRole('switch')).toHaveTextContent('скрыта')
    expect(screen.getByTestId('topic-training-editor')).toHaveTextContent('скрыто 1')
  })

  it('переключатель скрывает видимую и показывает скрытую', async () => {
    render(<TopicTrainingEditor topicId="t" />)
    const [first, second] = screen.getAllByTestId('training-editor-toggle')
    fireEvent.click(first)
    await waitFor(() => expect(setSubtopicHidden).toHaveBeenCalledWith('1.14', true))
    fireEvent.click(second)
    await waitFor(() => expect(setSubtopicHidden).toHaveBeenCalledWith('1.15', false))
  })

  it('тренировки нет — блока нет', () => {
    state.empty = true
    const { container } = render(<TopicTrainingEditor topicId="t" />)
    expect(container).toBeEmptyDOMElement()
  })
})
