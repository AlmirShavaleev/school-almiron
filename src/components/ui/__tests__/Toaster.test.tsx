import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toaster } from '@/components/ui/Toaster'
import { useToastStore, toast } from '@/store/toastStore'

describe('Toaster', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('показывает тост из стора', () => {
    toast.saved()
    render(<Toaster />)
    expect(screen.getByText('Успешно сохранено')).toBeInTheDocument()
  })

  /**
   * Регрессия §98. Toaster смонтирован в App.tsx выше <Routes>, модалки — ниже
   * по DOM. При одинаковом z-50 модалка перекрывала тост, и подтверждение
   * сохранения было не видно ровно там, где его ждут.
   */
  it('лежит выше модалок (z-50), а не наравне с ними', () => {
    render(<Toaster />)
    const box = screen.getByTestId('toaster')
    expect(box.className).not.toMatch(/(^|\s)z-50(\s|$)/)
    const z = box.className.match(/z-\[(\d+)\]/)
    expect(z).not.toBeNull()
    expect(Number(z![1])).toBeGreaterThan(50)
  })

  it('крестик убирает тост сразу', () => {
    toast.error('беда')
    render(<Toaster />)
    fireEvent.click(screen.getByLabelText('Закрыть'))
    expect(screen.queryByText('беда')).not.toBeInTheDocument()
  })
})
