import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CartBadge } from '@/components/catalog/CartBadge'
import { SupportWidget } from '@/components/shared/SupportWidget'
import { useAuthStore } from '@/store/authStore'
import { useCartStore } from '@/store/cartStore'

/**
 * board/007: «Подборка · N» ложилась поверх кнопки «Сообщить о проблеме» —
 * один угол, один z-index, два элемента. Проверяем то, что этим управляет:
 * оба элемента на экране одновременно и стоят в РАЗНЫХ слотах общего стека.
 * Пиксели в jsdom условны, поэтому геометрию не меряем.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ then: () => Promise.resolve({ data: [], error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }) }) },
  },
}))

function slotOf(el: HTMLElement): string | undefined {
  return Array.from(el.classList).find(c => /^fab-slot-\d+$/.test(c))
}

describe('Плавающий угол каталога', () => {
  beforeEach(() => {
    useAuthStore.setState({
      profile: { id: 'p1', role: 'student', full_name: 'Ученик' } as never,
    })
    useCartStore.setState({ items: [{ catalog_task_id: 't1', added_at: Date.now() }] })
  })

  it('подборка и кнопка помощи занимают разные слоты одного стека', () => {
    render(
      <MemoryRouter>
        <CartBadge />
        <SupportWidget />
      </MemoryRouter>
    )

    const cart = screen.getByTestId('cart-badge')
    const help = screen.getByTestId('support-widget-button')

    expect(cart.className).toContain('fab-slot')
    expect(help.className).toContain('fab-slot')

    const cartSlot = slotOf(cart)
    const helpSlot = slotOf(help)
    expect(cartSlot).toBeDefined()
    expect(helpSlot).toBeDefined()
    expect(cartSlot).not.toBe(helpSlot)
  })

  it('ни один из них не задаёт свой угол отступами на месте', () => {
    render(
      <MemoryRouter>
        <CartBadge />
        <SupportWidget />
      </MemoryRouter>
    )

    for (const testId of ['cart-badge', 'support-widget-button']) {
      const el = screen.getByTestId(testId)
      expect(el.className).not.toMatch(/\bbottom-\d/)
      expect(el.className).not.toMatch(/\bright-\d/)
    }
  })

  it('кнопка помощи — якорь угла: она в нижнем слоте, подборка над ней', () => {
    render(
      <MemoryRouter>
        <CartBadge />
        <SupportWidget />
      </MemoryRouter>
    )

    expect(slotOf(screen.getByTestId('support-widget-button'))).toBe('fab-slot-0')
    expect(slotOf(screen.getByTestId('cart-badge'))).toBe('fab-slot-1')
  })

  it('пустая корзина убирает подборку, кнопка помощи остаётся на месте', () => {
    useCartStore.setState({ items: [] })

    render(
      <MemoryRouter>
        <CartBadge />
        <SupportWidget />
      </MemoryRouter>
    )

    expect(screen.queryByTestId('cart-badge')).toBeNull()
    expect(slotOf(screen.getByTestId('support-widget-button'))).toBe('fab-slot-0')
  })
})
