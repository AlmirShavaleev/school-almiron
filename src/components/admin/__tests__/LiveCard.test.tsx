import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveCard, type LiveCardProps } from '@/components/admin/LiveCard'
import type { DayPoint } from '@/lib/livePulse'

/**
 * Карточка с графиком.
 *
 * Сторожится не вёрстка, а обещания карточки:
 *
 * 1. **Цвет бейджа по СМЫСЛУ.** Рост очереди проверки — ухудшение, и зелёная
 *    стрелка вверх на нём была бы прямой дезинформацией.
 * 2. **Поток и уровень считаются по-разному.** Сумма очереди по дням не значит
 *    ничего: работа, ждавшая три дня, вошла бы в неё трижды.
 * 3. **Рост с нуля — словами.** Решено в §148, здесь та же функция.
 * 4. **Точка «живое» — только там, где состояние действительно живое.**
 * 5. **Стрелка — переход, а не украшение** (правило §147).
 */

function series(values: number[]): DayPoint[] {
  return values.map((value, i) => ({ day: `2026-08-${String(20 + i).padStart(2, '0')}`, value }))
}

function props(over: Partial<LiveCardProps> = {}): LiveCardProps {
  return {
    title: 'Заходы',
    points: series([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]),
    kind: 'flow',
    tone: 'more-is-good',
    statusText: 'сегодня: 2',
    color: '#6366f1',
    animate: false,
    testId: 'card-x',
    ...over,
  }
}

describe('крупное число', () => {
  it('поток — сумма за неделю', () => {
    render(<LiveCard {...props()} />)
    expect(screen.getByTestId('card-x-value')).toHaveTextContent('14')
  })

  it('уровень — значение на сегодня, а не сумма', () => {
    // Живой ряд очереди на 11.09. Сумма дала бы 97 — число, не значащее ничего.
    render(<LiveCard {...props({
      kind: 'level',
      points: series([1, 1, 1, 1, 1, 2, 2, 1, 5, 9, 14, 16, 23, 20]),
    })} />)
    expect(screen.getByTestId('card-x-value')).toHaveTextContent('20')
  })
})

describe('бейдж', () => {
  it('рост хорошего — зелёный', () => {
    render(<LiveCard {...props()} />)
    expect(screen.getByTestId('card-x-badge')).toHaveAttribute('data-mood', 'good')
  })

  it('рост ОЧЕРЕДИ — красный, а не зелёный', () => {
    // Главная ловушка карточек: направление вверх здесь означает ухудшение.
    render(<LiveCard {...props({
      kind: 'level',
      tone: 'more-is-bad',
      points: series([1, 1, 1, 1, 1, 2, 2, 1, 5, 9, 14, 16, 23, 20]),
    })} />)
    expect(screen.getByTestId('card-x-badge')).toHaveAttribute('data-mood', 'bad')
  })

  it('падение очереди — зелёный', () => {
    render(<LiveCard {...props({
      kind: 'level',
      tone: 'more-is-bad',
      points: series([20, 20, 20, 20, 20, 20, 20, 9, 8, 7, 6, 5, 4, 3]),
    })} />)
    expect(screen.getByTestId('card-x-badge')).toHaveAttribute('data-mood', 'good')
  })

  it('рост с нуля — словами, а не процентом', () => {
    render(<LiveCard {...props({
      points: series([0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3]),
    })} />)
    const badge = screen.getByTestId('card-x-badge')
    expect(badge).toHaveTextContent('с нуля')
    // +2300 % — это шум, а не число.
    expect(badge.textContent).not.toContain('%')
  })

  it('без изменений — отдельное состояние', () => {
    render(<LiveCard {...props({
      points: series([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
    })} />)
    const badge = screen.getByTestId('card-x-badge')
    expect(badge).toHaveAttribute('data-mood', 'flat')
    expect(badge).toHaveTextContent('ровно')
  })
})

describe('строка состояния', () => {
  it('точка показывается только у живого состояния', () => {
    render(<LiveCard {...props({ live: true, statusText: '3 сейчас на платформе' })} />)
    expect(screen.getByTestId('card-x-dot')).toBeInTheDocument()
    expect(screen.getByText('3 сейчас на платформе')).toBeInTheDocument()
  })

  it('без живого состояния точки нет', () => {
    render(<LiveCard {...props()} />)
    expect(screen.queryByTestId('card-x-dot')).not.toBeInTheDocument()
  })
})

describe('переход', () => {
  it('стрелка ведёт туда, где с числом можно что-то сделать', () => {
    const onOpen = vi.fn()
    render(<LiveCard {...props({ onOpen, openLabel: 'Открыть очередь' })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть очередь' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('без перехода стрелки нет — украшением она не висит', () => {
    render(<LiveCard {...props()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('пустые данные', () => {
  it('пустой ряд говорит словами, а не рисует пустую рамку', () => {
    render(<LiveCard {...props({ points: [] })} />)
    expect(screen.getByText('Данных за период нет.')).toBeInTheDocument()
    expect(screen.getByTestId('card-x-value')).toHaveTextContent('0')
  })

  it('почти-ноль остаётся почти-нулём: шкала не растягивается выдумкой', () => {
    // Пройденных тем мало, и это правильная картинка. Проверяем, что число —
    // настоящая сумма, а не «нормированное» значение.
    render(<LiveCard {...props({
      points: series([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 4, 0]),
    })} />)
    expect(screen.getByTestId('card-x-value')).toHaveTextContent('7')
  })
})
