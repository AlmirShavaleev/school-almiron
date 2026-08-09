import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentTodoList } from '@/components/student/StudentTodoList'
import type { StudentTodo, TodoItem } from '@/lib/studentTodo'

const EMPTY: StudentTodo = {
  overdue: [], returned: [], dueSoon: [], tests: [], newlyOpened: [], checked: [], isClear: true,
}

function item(over: Partial<TodoItem> & { key: string }): TodoItem {
  return {
    homeworkId: over.key, title: `ДЗ ${over.key}`, topicTitle: 'Кинематика',
    courseTitle: 'Физика ЕГЭ', groupId: 'g1', topicId: 't1',
    dueAt: '2026-08-10', days: 2, comment: null,
    ...over,
  }
}

function renderList(todo: StudentTodo) {
  return render(<MemoryRouter><StudentTodoList todo={todo} loading={false} error={null} /></MemoryRouter>)
}

describe('StudentTodoList', () => {
  it('пусто — честное «всё сдано», а не голый экран', () => {
    renderList(EMPTY)
    expect(screen.getByTestId('student-todo-clear')).toBeInTheDocument()
    expect(screen.getByText('Всё сдано, новых заданий нет')).toBeInTheDocument()
  })

  it('пустые разделы не рисуются: на телефоне это была бы прокрутка вместо ответа', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1' })] })

    expect(screen.getByText('Просрочено')).toBeInTheDocument()
    expect(screen.queryByText('Сдать до')).not.toBeInTheDocument()
    expect(screen.queryByText('Тестирования')).not.toBeInTheDocument()
  })

  it('порядок разделов — по срочности, просрочка первой', () => {
    renderList({
      ...EMPTY,
      isClear: false,
      overdue:  [item({ key: 'h1', days: -3 })],
      returned: [item({ key: 'h2' })],
      dueSoon:  [item({ key: 'h3' })],
    })

    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings).toEqual(['Просрочено', 'Вернули на доработку', 'Сдать до'])
  })

  it('срок пишется словами, просрочка — со знаком', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1', days: -2 })], dueSoon: [item({ key: 'h2', days: 1 })] })

    expect(screen.getByText('просрочено на 2 дня')).toBeInTheDocument()
    expect(screen.getByText('завтра')).toBeInTheDocument()
  })

  it('комментарий преподавателя виден прямо в строке возврата', () => {
    renderList({ ...EMPTY, isClear: false, returned: [item({ key: 'h1', comment: 'Переделай пункт 3' })] })
    expect(screen.getByText('Переделай пункт 3')).toBeInTheDocument()
  })

  it('строка ведёт на тему курса', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1' })] })
    expect(screen.getByText('ДЗ h1').closest('a')).toHaveAttribute('href', '/my-course/g1/topic/t1')
  })

  it('без группы строка не ссылка, а не битая ссылка', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1', groupId: null })] })
    expect(screen.getByText('ДЗ h1').closest('a')).toBeNull()
  })

  it('«проверено» показывает балл, а «всё сдано» остаётся при пустых делах', () => {
    renderList({
      ...EMPTY,
      checked: [{
        attemptId: 'a1', homeworkTitle: 'Динамика', decision: 'accepted',
        score: 4, gradeScale: 'five', comment: null, createdAt: '2026-08-05T10:00:00Z',
      }],
    })

    expect(screen.getByText('Динамика')).toBeInTheDocument()
    expect(screen.getByText('4/5')).toBeInTheDocument()
    // Дел нет, но экран не пустой — «всё сдано» показывается компактно.
    expect(screen.getByTestId('student-todo-clear')).toBeInTheDocument()
  })
})
