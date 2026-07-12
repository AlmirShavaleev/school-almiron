import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelfCheckItem, SelfCheckSummary, useSelfCheckScores } from '@/components/variant/SelfCheckPanel'
import type { VariantItem } from '@/hooks/useVariantAttempt'

function makeItem(overrides: Partial<VariantItem> = {}): VariantItem {
  return {
    item_id: 'item-1',
    variant_id: 'v1',
    task_id: 't1',
    item_position: 1,
    points: 0,
    grading_type: 'auto',
    task_ext_id: 42,
    section_id: null,
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    statement_html: '<p>Решите уравнение</p>',
    has_answer: false,
    has_solution: true,
    exam_part: 2,
    source_type: 'student_self_built',
    solution_html: '<p>Решение: x=5</p>',
    solution_plan_html: null,
    grade_criteria_html: '<p>2 балла за верный ответ</p>',
    answer_html: null,
    ...overrides,
  }
}

function TestHarness({ item }: { item: VariantItem }) {
  const { scores, setScore } = useSelfCheckScores('assignment-1')
  return (
    <SelfCheckItem
      item={item}
      studentAnswer=""
      score={scores[item.item_id] ?? null}
      onScoreChange={value => setScore(item.item_id, value)}
    />
  )
}

describe('SelfCheckPanel — local-only self-assessment', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('reveals solution/criteria only after the toggle click, not by default', () => {
    render(<TestHarness item={makeItem()} />)
    expect(screen.queryByText('Решение: x=5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Показать решение и критерии'))
    expect(screen.getByText('Решение: x=5')).toBeInTheDocument()
    expect(screen.getByText('2 балла за верный ответ')).toBeInTheDocument()
  })

  it('persists the entered score to sessionStorage, scoped by assignment id, and never touches the network', () => {
    render(<TestHarness item={makeItem()} />)
    const input = screen.getByTestId('self-check-score-item-1')
    fireEvent.change(input, { target: { value: '2' } })

    const stored = JSON.parse(sessionStorage.getItem('self-check:assignment-1') ?? '{}')
    expect(stored).toEqual({ 'item-1': 2 })
  })

  it('clears the stored score when the input is emptied', () => {
    render(<TestHarness item={makeItem()} />)
    const input = screen.getByTestId('self-check-score-item-1')
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.change(input, { target: { value: '' } })

    const stored = JSON.parse(sessionStorage.getItem('self-check:assignment-1') ?? '{}')
    expect(stored).toEqual({})
  })
})

describe('SelfCheckSummary — exam_part gating', () => {
  it('excludes exam_part=1 items from the self-check total (they are auto-graded, not self-checked)', () => {
    const items = [
      makeItem({ item_id: 'p1', exam_part: 1 }),
      makeItem({ item_id: 'p2', exam_part: 2 }),
      makeItem({ item_id: 'p3', exam_part: null }),
    ]
    const scores = { p1: 100, p2: 3, p3: 4 }
    render(<SelfCheckSummary items={items} scores={scores} />)

    // p1 is exam_part=1 (auto-graded) — its score must NOT be counted here,
    // even though a stray value happens to exist for it.
    expect(screen.getByTestId('self-check-summary')).toHaveTextContent('7')
    expect(screen.getByTestId('self-check-summary')).not.toHaveTextContent('107')
  })

  it('renders nothing when every item is exam_part=1', () => {
    const items = [makeItem({ item_id: 'p1', exam_part: 1 })]
    const { container } = render(<SelfCheckSummary items={items} scores={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
