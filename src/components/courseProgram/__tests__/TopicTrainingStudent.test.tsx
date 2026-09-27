import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { buildTrainingSubtopics, type TrainingItemRow } from '@/lib/training'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: () => Promise.resolve({ data: null, error: null }) } }))

import { TopicTrainingStudent } from '@/components/courseProgram/TopicTrainingStudent'

/**
 * §234.1. Задачник по математике: у подтемы один файл — «Теория» или
 * «Задачи». Пустая строка «Дома» (или «На уроке») не рисуется вовсе.
 */
const row = (code: string, section: string, title: string): TrainingItemRow => ({
  id: `${code}-${section}`, topic_id: 't', kind: 'file', title, storage_path: `t/${code}.pdf`, file_name: `${code}.pdf`,
  size_bytes: 1, position: 0, is_visible: true, section, subtopic_code: code, subtopic_title: `Подтема ${code}`,
})

describe('TopicTrainingStudent — подтема с одним файлом', () => {
  it('только «На уроке», без пустого «Дома»; подпись из раскладки', () => {
    const subtopics = buildTrainingSubtopics([row('1.2', 'tasks', 'Задачи · 1.2'), row('1.0', 'theory', 'Теория · 1.0')])
    render(<TopicTrainingStudent topicId="t" subtopics={subtopics} countView={false} />)
    const first = screen.getAllByTestId('training-subtopic')[0]
    expect(first).toHaveAttribute('data-code', '1.0')
    expect(within(first).getByTestId('training-place-lesson')).toHaveTextContent('Теория')
    expect(within(first).queryByTestId('training-place-home')).toBeNull()
    expect(first).toHaveTextContent('1 материал')
  })

  it('подтема, где есть только домашний файл, — только «Дома»', () => {
    const subtopics = buildTrainingSubtopics([row('3.1', 'homework_tasks', 'ДЗ · 3.1')])
    render(<TopicTrainingStudent topicId="t" subtopics={subtopics} countView={false} />)
    expect(screen.queryByTestId('training-place-lesson')).toBeNull()
    expect(screen.getByTestId('training-place-home')).toHaveTextContent('ДЗ')
  })
})
