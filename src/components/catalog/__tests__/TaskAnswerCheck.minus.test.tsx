import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaskAnswerCheck } from '../TaskAnswerCheck'

describe('§267 минус в поле ответа (iPhone)', () => {
  it('кнопка ± ставит и убирает минус, ответ уходит с минусом', async () => {
    const onCheck = vi.fn().mockResolvedValue({ error: 'x', result: null, change: null })
    render(<TaskAnswerCheck taskId="t1" state={undefined} onCheck={onCheck} />)
    const input = screen.getByTestId('task-answer-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0,6' } })
    const minus = screen.getByTestId('task-answer-minus')
    fireEvent.click(minus)
    expect(input.value).toBe('-0,6')
    expect(minus.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(minus)
    expect(input.value).toBe('0,6')
    fireEvent.click(minus)
    fireEvent.click(screen.getByTestId('task-answer-submit'))
    expect(onCheck).toHaveBeenCalledWith('-0,6')
  })
})
