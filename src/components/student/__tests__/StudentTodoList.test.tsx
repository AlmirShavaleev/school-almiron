import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentTodoList } from '@/components/student/StudentTodoList'
import type { StudentTodo, TodoItem } from '@/lib/studentTodo'

const EMPTY: StudentTodo = {
  overdue: [], returned: [], dueSoon: [], noDue: [], tests: [], newlyOpened: [], checked: [], isClear: true,
}

function item(over: Partial<TodoItem> & { key: string }): TodoItem {
  return {
    homeworkId: over.key, title: `ДЗ ${over.key}`, topicTitle: 'Кинематика',
    courseTitle: 'Физика ЕГЭ', courseSubject: 'physics', groupId: 'g1', topicId: 't1',
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

  it('порядок разделов — по срочности, просрочка первой, «без срока» после срочных', () => {
    renderList({
      ...EMPTY,
      isClear: false,
      overdue:  [item({ key: 'h1', days: -3 })],
      returned: [item({ key: 'h2' })],
      dueSoon:  [item({ key: 'h3' })],
      noDue:    [item({ key: 'h4', dueAt: null, days: 0 })],
    })

    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings).toEqual(['Просрочено', 'Вернули на доработку', 'Сдать до', 'Без срока'])
  })

  it('работа без срока показывается, но без плашки срока', () => {
    // Раньше такая работа не попадала на дашборд вовсе, хотя на странице ДЗ
    // стояла в «Нужно сделать»: 4 работы из 6 на проде.
    renderList({ ...EMPTY, isClear: false, noDue: [item({ key: 'h1', dueAt: null, days: 0 })] })

    const row = screen.getByText('ДЗ h1').closest('a')!
    expect(row).toHaveAttribute('href', '/my-course/g1/topic/t1')
    expect(row.textContent).not.toContain('сегодня')
    expect(row.textContent).not.toContain('просрочено')
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

  it('строка без адреса не притворяется ссылкой — ни подсветки, ни курсора', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1', groupId: null })] })
    const shell = screen.getByTestId('todo-row')
    expect(shell.tagName).toBe('DIV')
    expect(shell.className).not.toContain('hover:')
    expect(shell.className).not.toContain('cursor-pointer')
  })

  it('адрес темы собран общим правилом — тем же, что на странице ДЗ', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1', groupId: 'g7', topicId: 't9' })] })
    expect(screen.getByText('ДЗ h1').closest('a')).toHaveAttribute('href', '/my-course/g7/topic/t9')
  })

  it('курс помечен цветом предмета — той же палитрой, что на странице ДЗ', () => {
    // Два курса в одном списке должны различаться глазом. Цвет берётся от
    // предмета, а не от названия: переименование курса цвет не двигает.
    renderList({
      ...EMPTY,
      isClear: false,
      overdue: [item({ key: 'h1', courseSubject: 'physics' })],
      dueSoon: [item({ key: 'h2', courseTitle: 'Математика ЕГЭ', courseSubject: 'math' })],
    })

    const physics = screen.getByText('ДЗ h1').closest('a')!.querySelector('span[aria-hidden]')
    const math = screen.getByText('ДЗ h2').closest('a')!.querySelector('span[aria-hidden]')
    expect(physics?.className).toContain('bg-violet-500')
    expect(math?.className).toContain('bg-blue-500')
  })

  it('курс без предмета получает запасной цвет, а не пропадает', () => {
    renderList({ ...EMPTY, isClear: false, overdue: [item({ key: 'h1', courseSubject: null })] })
    const dot = screen.getByText('ДЗ h1').closest('a')!.querySelector('span[aria-hidden]')
    expect(dot?.className).toContain('bg-primary-500')
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
