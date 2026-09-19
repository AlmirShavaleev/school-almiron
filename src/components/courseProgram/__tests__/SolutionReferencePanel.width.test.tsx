import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SolutionReferencePanel } from '@/components/courseProgram/SolutionReferencePanel'

/**
 * §208. С какой ширины окна панель занимает долю.
 *
 * Отдельным тестом, потому что раскладка здесь держится на брейкпоинте
 * Tailwind: в jsdom медиазапросы не считаются, и единственное честное
 * доказательство — какой именно класс ширины получила панель. Сама доля
 * (проценты) проверяется в `AttemptAnnotationOverlay.solutionWidth`.
 */

function panel(widthFromLaptop: boolean) {
  render(
    <SolutionReferencePanel
      topicId="t1"
      materials={[]}
      loading={false}
      widthPercent="45.0%"
      widthFromLaptop={widthFromLaptop}
    />,
  )
  return screen.getByTestId('solution-reference-panel')
}

describe('ширина панели решения по брейкпоинтам', () => {
  it('ширину не выбирали — с 1024 фиксированные 20rem, доля только с 1536', () => {
    const el = panel(false)
    expect(el.className).toContain('lg:w-80')
    expect(el.className).toContain('2xl:w-[var(--solution-pane-w,40%)]')
  })

  it('ширину выбрал человек — доля действует уже с 1024', () => {
    const el = panel(true)
    expect(el.className).toContain('lg:w-[var(--solution-pane-w,40%)]')
    expect(el.className).not.toContain('lg:w-80')
  })

  it('доля приезжает переменной, а не пересборкой класса на каждый пиксель', () => {
    expect(panel(true).getAttribute('style')).toContain('45.0%')
  })
})
