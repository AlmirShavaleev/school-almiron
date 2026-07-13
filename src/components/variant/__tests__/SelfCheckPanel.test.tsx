import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useMemo } from 'react'
import { SelfCheckItem, SelfCheckSummary, useSelfCheckScores } from '@/components/variant/SelfCheckPanel'
import type { VariantItem } from '@/hooks/useVariantAttempt'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
}))

function makeItem(overrides: Partial<VariantItem> = {}): VariantItem {
  return {
    item_id: 'item-1',
    variant_id: 'v1',
    task_id: 't1',
    item_position: 1,
    points: 0,
    max_points: 2,
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
    assets: [],
    ...overrides,
  }
}

function TestHarness({ item }: { item: VariantItem }) {
  const items = useMemo(() => [item], [item])
  const { scores, setScore } = useSelfCheckScores('assignment-1', items)
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

  it('shows solution and criteria immediately in self-check mode', () => {
    render(<TestHarness item={makeItem()} />)
    expect(screen.getByText('Решение: x=5')).toBeInTheDocument()
    expect(screen.getByText('2 балла за верный ответ')).toBeInTheDocument()
    expect(screen.getByText('Баллы себе')).toBeInTheDocument()
  })

  it('persists the entered score to sessionStorage, scoped by assignment id, and never touches the network', () => {
    render(<TestHarness item={makeItem()} />)
    const input = screen.getByTestId('self-check-score-item-1')
    fireEvent.change(input, { target: { value: '2' } })

    const stored = JSON.parse(sessionStorage.getItem('self-check:assignment-1') ?? '{}')
    expect(stored).toEqual({ 'item-1': 2 })
  })

  it('resolves solution images via catalog assets', () => {
    const item = makeItem({
      solution_html: '<p><img src="DI_703.png" alt="PIC"></p>',
      assets: [{
        id: 'asset-1',
        tex_session_id: null,
        kind: 'solution',
        storage_path: 'math-ege/1861/DI_703.png',
        alt: 'PIC',
        position: 1,
      }],
    })

    render(<TestHarness item={item} />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toContain('https://cdn.test/math-ege/1861/DI_703.png')
  })

  it('clears the stored score when the input is emptied', () => {
    render(<TestHarness item={makeItem()} />)
    const input = screen.getByTestId('self-check-score-item-1')
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.change(input, { target: { value: '' } })

    const stored = JSON.parse(sessionStorage.getItem('self-check:assignment-1') ?? '{}')
    expect(stored).toEqual({})
  })

  it('clamps entered score to task max_points', () => {
    render(<TestHarness item={makeItem({ max_points: 2 })} />)
    const input = screen.getByTestId('self-check-score-item-1') as HTMLInputElement

    fireEvent.change(input, { target: { value: '7' } })

    expect(input.value).toBe('2')
    const stored = JSON.parse(sessionStorage.getItem('self-check:assignment-1') ?? '{}')
    expect(stored).toEqual({ 'item-1': 2 })
  })

  it('warns and keeps UI working when max_points is missing', () => {
    render(<TestHarness item={makeItem({ max_points: null })} />)
    const input = screen.getByTestId('self-check-score-item-1') as HTMLInputElement

    fireEvent.change(input, { target: { value: '7' } })

    expect(screen.getByText('Максимум для этой задачи не определён.')).toBeInTheDocument()
    expect(input.value).toBe('7')
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

  it('shows total cap when all part 2 maxima are known', () => {
    const items = [
      makeItem({ item_id: 'p2', exam_part: 2, max_points: 2 }),
      makeItem({ item_id: 'p3', exam_part: null, max_points: 3 }),
    ]
    render(<SelfCheckSummary items={items} scores={{ p2: 2, p3: 3 }} />)

    expect(screen.getByTestId('self-check-summary')).toHaveTextContent('5 / 5')
  })

  it('warns when total cap cannot be determined because some max_points are null', () => {
    const items = [
      makeItem({ item_id: 'p2', exam_part: 2, max_points: 2 }),
      makeItem({ item_id: 'p3', exam_part: null, max_points: null }),
    ]
    render(<SelfCheckSummary items={items} scores={{ p2: 2, p3: 4 }} />)

    expect(screen.getByText('Общий максимум части 2 пока определён не для всех задач, поэтому суммарный предел не зафиксирован.')).toBeInTheDocument()
  })
})
