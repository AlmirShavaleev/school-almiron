import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useToastStore, toast, SHORT_TOAST_MS } from '@/store/toastStore'

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('обычный тост живёт дольше короткого', () => {
    toast.success('готово')
    vi.advanceTimersByTime(SHORT_TOAST_MS + 100)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  /**
   * §98: подтверждение сохранения владелец просил на 1–2 секунды — оно не
   * должно висеть наравне с сообщением об ошибке.
   */
  it('toast.saved() гаснет за короткий срок', () => {
    toast.saved()
    const [t] = useToastStore.getState().toasts
    expect(t.type).toBe('success')
    expect(t.message).toBe('Успешно сохранено')

    vi.advanceTimersByTime(SHORT_TOAST_MS - 1)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(2)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('текст подтверждения можно заменить, срок остаётся коротким', () => {
    toast.saved('Файл прикреплён')
    expect(useToastStore.getState().toasts[0].message).toBe('Файл прикреплён')
    vi.advanceTimersByTime(SHORT_TOAST_MS + 1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('несколько сохранений подряд не затирают друг друга', () => {
    toast.saved()
    toast.saved()
    expect(useToastStore.getState().toasts).toHaveLength(2)
  })

  it('remove убирает тост до срока', () => {
    toast.error('беда')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().remove(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
