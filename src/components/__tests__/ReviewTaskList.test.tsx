import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ReviewTaskList } from '@/components/courseProgram/ReviewTaskList'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import type { ReviewNote } from '@/lib/reviewNotes'

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

  it('§209. В строке — номер, итог, правильный ответ и замечания; своего ответа НЕТ', () => {
    // ИИ читает почерк с ошибками, и «твой ответ: 0,375», когда он написал
    // другое, — спор на ровном месте.
    render(<ReviewTaskList rows={[
      row({ id: 'r2', no: '2', verdict: 'wrong', student_answer: '0,375', expected_answer: '2', note: NOTE }),
    ]} />)
    const line = screen.getByTestId('student-review-task-row')
    expect(line.dataset.no).toBe('2')
    expect(line.dataset.verdict).toBe('wrong')
    expect(within(line).getByTestId('student-review-task-answer')).toHaveTextContent('2')
    expect(line).not.toHaveTextContent('0,375')
    expect(line).toHaveTextContent('знак ускорения')
  })

  it('§209. Ученик видит замечания-рамки, а не только старое поле note', () => {
    // Главная ловушка слияния списков: замечание теперь рамка, и если бы этот
    // блок читал только `note`, ученик перестал бы видеть работу проверяющего.
    const notes: ReviewNote[] = [
      { id: 'n1', taskNo: '2', text: 'Ошибка в отборе корней', page: 3, type: 'error', categoryLabel: 'Ошибка' },
    ]
    render(<ReviewTaskList rows={[row({ id: 'r2', no: '2', verdict: 'wrong' })]} notes={notes} />)
    const line = screen.getByTestId('student-review-task-row')
    expect(within(line).getByTestId('student-review-task-note')).toHaveTextContent('Ошибка в отборе корней')
    expect(within(line).getByTestId('student-review-task-note')).toHaveTextContent('стр. 3')
  })

  it('§209. Замечание без задания тоже доходит до ученика', () => {
    const notes: ReviewNote[] = [
      { id: 'n2', taskNo: null, text: 'Подпиши оси', page: 1, type: null, categoryLabel: 'Комментарий' },
    ]
    render(<ReviewTaskList rows={[row()]} notes={notes} />)
    expect(screen.getByTestId('student-review-orphan-notes')).toHaveTextContent('Подпиши оси')
  })

  it('ученик ничего не правит: ни списков вердикта, ни кнопок удаления', () => {
    render(<ReviewTaskList rows={[row({ note: NOTE })]} />)
    expect(screen.queryByTestId('review-task-verdict')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-task-remove')).not.toBeInTheDocument()
  })
})
