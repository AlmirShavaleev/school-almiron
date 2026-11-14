import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TheoryArticle } from '@/components/courseProgram/TheoryArticle'
import { THEORY_MD_MARKER } from '@/lib/theoryMarkdown'

// KaTeX в тесте не грузим: формулы остаются «ждущими» исходниками.
vi.mock('@/lib/katexLoader', () => ({
  getLoadedKatex: () => null,
  upgradeMathIn: () => Promise.resolve(),
}))

const SRC = `${THEORY_MD_MARKER}
## Т1. Противоположное событие

Событие «$A$ не произошло» называют **противоположным**.

::: rule
$$P(\\bar A) = 1 - P(A)$$
:::

![Полоска делится на две части](fig:theory/strip.svg)

::: check
Вероятность события $A$ равна $0{,}7$. Найдите $P(\\bar A)$. || $0{,}3$
:::

## Т2. <b>Несовместные</b> события

::: trap
Граничное значение попадает ровно в одно из событий.
:::
`

describe('TheoryArticle', () => {
  it('разделы заголовками, номер «Т1.» не показывается', () => {
    render(<TheoryArticle source={SRC} />)
    expect(screen.getByRole('heading', { name: 'Противоположное событие' })).toBeInTheDocument()
    expect(screen.queryByText(/Т1\./)).not.toBeInTheDocument()
  })

  it('рисунок из бакета каталога с подписью', () => {
    render(<TheoryArticle source={SRC} />)
    const img = screen.getByRole('img', { name: 'Полоска делится на две части' })
    expect(img.getAttribute('src')).toMatch(/\/storage\/v1\/object\/public\/catalog-figures\/theory\/strip\.svg$/)
    expect(screen.getByText('Полоска делится на две части', { selector: 'figcaption' })).toBeInTheDocument()
  })

  it('«Проверь себя»: ответ скрыт до нажатия', () => {
    render(<TheoryArticle source={SRC} />)
    const box = screen.getByText('Проверь себя').closest('[data-box="check"]') as HTMLElement
    expect(box.textContent).not.toContain('0{,}3')
    fireEvent.click(within(box).getByRole('button', { name: 'Показать ответ' }))
    expect(box.textContent).toContain('0{,}3')
    expect(within(box).getByRole('button', { name: 'Скрыть ответ' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('ловушка с подписью; HTML в исходнике не исполняется, а показывается буквами', () => {
    const { container } = render(<TheoryArticle source={SRC} />)
    expect(container.querySelector('[data-box="trap"]')?.textContent).toContain('Ловушка ЕГЭ')
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByRole('heading', { name: '<b>Несовместные</b> события' })).toBeInTheDocument()
  })
})
