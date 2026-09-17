import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewTaskList } from '@/components/courseProgram/ReviewTaskList'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §199. «По заданиям» глазами ученика — решение владельца: таблицу после
 * проверки он видит.
 *
 * Что здесь НЕ проверяется и почему: «только после вердикта». Это правило
 * живёт в политике (`topic_homework_review_tasks_student_select`), а не в
 * компоненте, — до вердикта база строк не отдаёт, и проверять его надо пробой
 * под ролью, а не рендером. Компонент отвечает за другое: строк нет — блока
 * нет вовсе, экран как раньше.
 */

const row = (over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: 'r1',
  attempt_id: 'a1',
  no: '1',
  verdict: 'correct',
  student_answer: '12 м/с',
  expected_answer: '12 м/с',
  note: null,
  position: 10,
  updated_by: null,
  updated_at: '2026-09-17T10:00:00Z',
  ...over,
})

const NOTE = 'При торможении знак ускорения противоположен скорости — здесь должен быть минус.'

describe('ReviewTaskList', () => {
  it('строк нет — блока нет вовсе', () => {
    render(<ReviewTaskList rows={[]} />)
    expect(screen.queryByTestId('student-review-tasks')).not.toBeInTheDocument()
  })

  it('порядок — position, а не порядок в массиве', () => {
    render(<ReviewTaskList rows={[
      row({ id: 'c', no: '3', position: 30 }),
      row({ id: 'a', no: '1', position: 10 }),
      row({ id: 'b', no: '2', position: 20 }),
    ]} />)
    expect(screen.getAllByTestId('student-review-task-row').map(r => r.dataset.no)).toEqual(['1', '2', '3'])
  })

  it('в строке — номер, вердикт, свой ответ, правильный ответ и заметка', () => {
    render(<ReviewTaskList rows={[
      row({ id: 'r2', no: '2', verdict: 'wrong', student_answer: '−2', expected_answer: '2', note: NOTE }),
    ]} />)
    const line = screen.getByTestId('student-review-task-row')
    expect(line.dataset.no).toBe('2')
    expect(line.dataset.verdict).toBe('wrong')
    expect(line).toHaveTextContent('неверно')
    expect(line).toHaveTextContent('−2')
    expect(line).toHaveTextContent('2')
    expect(line).toHaveTextContent('знак ускорения')
  })

  it('длинная заметка свёрнута в строку, полная — по клику', () => {
    render(<ReviewTaskList rows={[row({ note: NOTE })]} />)
    const note = within(screen.getByTestId('student-review-task-row')).getByTestId('review-task-note-text')
    expect(note.className).toContain('truncate')
    fireEvent.click(note)
    expect(note.dataset.open).toBe('true')
    expect(note.className).not.toContain('truncate')
  })

  it('ученик ничего не правит: ни списков вердикта, ни кнопок удаления', () => {
    render(<ReviewTaskList rows={[row({ note: NOTE })]} />)
    expect(screen.queryByTestId('review-task-verdict')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-task-remove')).not.toBeInTheDocument()
  })
})
