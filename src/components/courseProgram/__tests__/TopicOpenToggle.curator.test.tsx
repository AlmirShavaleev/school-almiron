import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TopicOpenToggle } from '@/components/courseProgram/TopicOpenToggle'
import type { TeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * Клик-проверка владельца 05.08: куратор жал тумблер открытия темы, плашка
 * перекрашивалась, тема не открывалась. База его не пускала и тогда — проба
 * показала «изменено строк 0», — но UPDATE под RLS, не найдя подходящих
 * строк, НЕ возвращает ошибку, а тумблер оптимистичный. Молчаливый отказ
 * выглядел как работающее право.
 *
 * Поэтому проверяем именно поведение: куратору кнопки нет вовсе, состояние
 * темы он по-прежнему видит.
 */

let scope: TeachingScope

vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => scope,
}))

const TEACHER_SCOPE: TeachingScope = {
  active: false, loading: false, teacherId: null,
  courseIds: [], groupIds: [], ownStudentId: null, readOnly: false,
}
const CURATOR_SCOPE: TeachingScope = { ...TEACHER_SCOPE, active: true, readOnly: true }

const OPEN_TOPIC = { is_open: true, available_from: null }

describe('TopicOpenToggle и права куратора', () => {
  beforeEach(() => { scope = TEACHER_SCOPE })

  it('преподавателю тумблер — кнопка, и она переключает', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<TopicOpenToggle topic={OPEN_TOPIC} onToggle={onToggle} />)

    fireEvent.click(screen.getByTestId('topic-row-open-toggle'))

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(false))
  })

  it('куратору кнопки нет — только состояние', () => {
    scope = CURATOR_SCOPE
    const onToggle = vi.fn()
    render(<TopicOpenToggle topic={OPEN_TOPIC} onToggle={onToggle} />)

    expect(screen.queryByTestId('topic-row-open-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-row-open-state')).toBeInTheDocument()
    // Программу куратор читает: открыта тема или нет — видно.
    expect(screen.getByText('Открыта')).toBeInTheDocument()
  })

  it('состояние куратора не кликается', () => {
    scope = CURATOR_SCOPE
    const onToggle = vi.fn()
    render(<TopicOpenToggle topic={OPEN_TOPIC} onToggle={onToggle} />)

    fireEvent.click(screen.getByTestId('topic-row-open-state'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('пока кураторство не проверено, тумблера тоже нет', () => {
    // Первый кадр: ответа таблицы ещё нет. Показать кнопку и отобрать её
    // через мгновение — худший из вариантов.
    scope = { ...TEACHER_SCOPE, active: true, loading: true, readOnly: true }
    render(<TopicOpenToggle topic={OPEN_TOPIC} onToggle={vi.fn()} />)

    expect(screen.queryByTestId('topic-row-open-toggle')).not.toBeInTheDocument()
  })
})
