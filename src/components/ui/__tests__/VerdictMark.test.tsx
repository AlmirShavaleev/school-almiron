import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  MARK_OF_REVIEW_VERDICT,
  VERDICT_MARK_LABEL,
  VerdictMark,
  type VerdictMarkState,
} from '@/components/ui/VerdictMark'
import { REVIEW_TASK_VERDICTS } from '@/lib/homeworkReviewTasks'

/**
 * §225. Метка состояния проверки. Главное требование — состояния различаются
 * ФОРМОЙ, а не только цветом: лист для родителя печатают на ч/б принтере, и
 * на печати цвет снимается в чёрный. Поэтому проверяем геометрию, которую
 * видит глаз без цвета, а не классы краски.
 */
const STATES: VerdictMarkState[] = ['ok', 'bad', 'part', 'unk', 'none']

/** Отпечаток формы: что нарисовано, без учёта цвета. */
function shapeOf(svg: SVGElement): string {
  const circle = svg.querySelector('circle')!
  const filled = circle.getAttribute('fill') === 'currentColor'
  const dashed = circle.hasAttribute('stroke-dasharray')
  const half = svg.querySelector('[data-part="half"]') != null
  const glyph = Array.from(svg.querySelectorAll('path'))
    .filter(p => p.getAttribute('data-part') !== 'half')
    .map(p => p.getAttribute('d'))
    .join('|')
  return JSON.stringify({ filled, dashed, half, glyph })
}

describe('VerdictMark', () => {
  it('у всех пяти состояний разная форма', () => {
    const shapes = STATES.map(state => {
      const { container, unmount } = render(<VerdictMark state={state} />)
      const shape = shapeOf(container.querySelector('svg')!)
      unmount()
      return shape
    })
    expect(new Set(shapes).size).toBe(STATES.length)
  })

  it('«верно» и «неверно» — закрашенный круг, «частично» — закрашенная половина', () => {
    for (const state of ['ok', 'bad'] as const) {
      const { container, unmount } = render(<VerdictMark state={state} />)
      expect(container.querySelector('circle')).toHaveAttribute('fill', 'currentColor')
      unmount()
    }
    const { container } = render(<VerdictMark state="part" />)
    expect(container.querySelector('circle')).toHaveAttribute('fill', '#fff')
    expect(container.querySelector('[data-part="half"]')).toHaveAttribute('fill', 'currentColor')
  })

  it('«не сверено» — пунктирный круг, «не решено» — сплошной пустой', () => {
    const { container: unk } = render(<VerdictMark state="unk" />)
    expect(unk.querySelector('[data-part="dashed"]')).toHaveAttribute('stroke-dasharray')
    const { container: none } = render(<VerdictMark state="none" />)
    const circle = none.querySelector('circle')!
    expect(circle).not.toHaveAttribute('stroke-dasharray')
    expect(circle).toHaveAttribute('fill', '#fff')
    // Тире — только экранное: на печати оно прячется, остаётся пустой круг.
    expect(none.querySelector('.verdict-mark-dash')).not.toBeNull()
  })

  it('заливка нарисована SVG, а не фоном — печатается без «фоновой графики»', () => {
    const { container } = render(<VerdictMark state="ok" />)
    const svg = container.querySelector('svg')!
    expect(svg.classList.contains('verdict-mark')).toBe(true)
    expect(svg.getAttribute('style') ?? '').not.toMatch(/background/)
  })

  it('по умолчанию называет состояние для скринридера', () => {
    render(<VerdictMark state="part" />)
    expect(screen.getByRole('img', { name: 'Частично' })).toBeInTheDocument()
  })

  it('своя подпись заменяет название, null делает значок декоративным', () => {
    render(<VerdictMark state="ok" label="Задание 3: верно" />)
    expect(screen.getByRole('img', { name: 'Задание 3: верно' })).toBeInTheDocument()
    const { container } = render(<VerdictMark state="bad" label={null} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.querySelector('title')).toBeNull()
  })

  it('размер задаётся стороной', () => {
    const { container } = render(<VerdictMark state="unk" size={16} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
  })

  it('каждый вердикт таблицы проверки ДЗ получает своё состояние', () => {
    const marks = REVIEW_TASK_VERDICTS.map(v => MARK_OF_REVIEW_VERDICT[v])
    expect(new Set(marks).size).toBe(REVIEW_TASK_VERDICTS.length)
    expect(MARK_OF_REVIEW_VERDICT.unchecked).toBe('unk')
    expect(MARK_OF_REVIEW_VERDICT.unsolved).toBe('none')
    expect(Object.keys(VERDICT_MARK_LABEL).sort()).toEqual([...STATES].sort())
  })
})
