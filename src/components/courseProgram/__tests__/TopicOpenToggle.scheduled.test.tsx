import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TopicOpenToggle } from '@/components/courseProgram/TopicOpenToggle'
import type { TeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * Третье состояние тумблера — «по плану» (§151).
 *
 * Учебный план переводит тему на автоматику: is_open = null, available_from =
 * понедельник её недели. Раньше null был редкостью, и такая тема выглядела бы
 * как выключенный тумблер — владелец нажал бы «включить» и снял тему с
 * автоматики. Проверяем подпись, а не формулу: открыта ли тема, по-прежнему
 * решает topicAvailability.
 */
let scope: TeachingScope = {
  active: false, loading: false, teacherId: null,
  courseIds: [], groupIds: [], ownStudentId: null, readOnly: false,
}

vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => scope,
}))

const TODAY = '2026-09-12'

describe('TopicOpenToggle — тема по плану', () => {
  it('закрытая по плану тема подписана «По плану · с …», а не «Закрыта»', () => {
    vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`) })
    render(<TopicOpenToggle topic={{ is_open: null, available_from: '2026-09-21' }} onToggle={vi.fn()} />)
    const btn = screen.getByTestId('topic-row-open-toggle')
    expect(btn).toHaveTextContent('По плану · с 21.09')
    expect(btn).not.toHaveTextContent('Закрыта')
    expect(btn).toHaveAttribute('aria-checked', 'false')
    expect(btn).toHaveAttribute('data-scheduled', 'true')
    expect(btn.getAttribute('title')).toContain('открыть раньше')
  })

  it('открытая по плану тема — «По плану · открыта»', () => {
    vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`) })
    render(<TopicOpenToggle topic={{ is_open: null, available_from: '2026-09-07' }} onToggle={vi.fn()} />)
    const btn = screen.getByTestId('topic-row-open-toggle')
    expect(btn).toHaveTextContent('По плану · открыта')
    expect(btn).toHaveAttribute('aria-checked', 'true')
  })

  it('решение руками (true/false) выглядит как прежде', () => {
    render(<TopicOpenToggle topic={{ is_open: false, available_from: '2026-09-07' }} onToggle={vi.fn()} />)
    const btn = screen.getByTestId('topic-row-open-toggle')
    expect(btn).toHaveTextContent('Закрыта')
    expect(btn).not.toHaveAttribute('data-scheduled')
  })

  it('нажатие на тему по плану пишет явное true — «открыть раньше»', async () => {
    vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`) })
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<TopicOpenToggle topic={{ is_open: null, available_from: '2026-09-21' }} onToggle={onToggle} />)
    fireEvent.click(screen.getByTestId('topic-row-open-toggle'))
    vi.useRealTimers()
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(true))
  })

  it('куратор видит «по плану» как плашку без кнопки', () => {
    vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`) })
    scope = { ...scope, active: true, readOnly: true }
    render(<TopicOpenToggle topic={{ is_open: null, available_from: '2026-09-21' }} onToggle={vi.fn()} />)
    expect(screen.queryByTestId('topic-row-open-toggle')).toBeNull()
    expect(screen.getByTestId('topic-row-open-state')).toHaveTextContent('По плану · с 21.09')
    scope = { ...scope, active: false, readOnly: false }
  })
})
