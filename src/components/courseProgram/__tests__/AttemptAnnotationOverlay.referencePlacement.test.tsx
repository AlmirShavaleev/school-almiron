import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SOLUTION_FRACTION_STORAGE_KEY } from '@/lib/reviewPaneLayout'

/**
 * §235. «Решение: Рядом / Внизу» на экране проверки.
 *
 * Поведение, а не классы: где ОКАЗЫВАЕТСЯ эталон (колонка слева или блок под
 * заданиями), что его ровно одна копия, что выбор переживает повторное
 * открытие и падение хранилища, и что на узком экране и без эталона
 * переключателя нет. Блок и колонка — настоящие (эталон текстовый, сети нет),
 * подменён только хук загрузки материалов.
 */

const materials = [{
  kind: 'text' as const, id: 'm1', title: 'Задание 1', position: 0, isVisible: false,
  section: 'solution' as const, content: 'Ox: ma = −mg·sin α. Ответ: 12 м/с',
}]

vi.mock('@/components/courseProgram/SolutionReferencePanel', async importOriginal => {
  const real = await importOriginal<typeof import('@/components/courseProgram/SolutionReferencePanel')>()
  return {
    ...real,
    useTopicSolutionMaterials: (topicId?: string | null) => ({
      materials: topicId ? materials : [], loading: false,
    }),
  }
})

vi.mock('@/components/SubmissionReviewer', () => ({
  default: () => <div data-testid="submission-reviewer" />,
}))

vi.mock('@/components/ui/SignedFileLink', () => ({
  SignedFileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import {
  AttemptAnnotationOverlay,
  REFERENCE_PLACEMENT_STORAGE_KEY,
} from '@/components/courseProgram/AttemptAnnotationOverlay'

const files = [{
  id: 'f1', attempt_id: 'a1', storage_path: 'a1/page.jpg', file_name: 'page.jpg',
  mime_type: 'image/jpeg', size_bytes: 10, position: 0, created_at: '',
}]

/** Ширина окна для `matchMedia('(min-width: 1024px)')` — с переключением на лету. */
function stubScreen(wide: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: wide,
    media: '(min-width: 1024px)',
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn) },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn) },
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true, value: vi.fn(() => query),
  })
  return {
    resize(next: boolean) {
      query.matches = next
      act(() => { listeners.forEach(fn => fn()) })
    },
  }
}

function renderReview(extra: Record<string, unknown> = {}) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ"
      solutionTopicId="t1"
      reviewPanel={({ reference, showReference }) => (
        <div data-testid="tasks">
          задания
          {showReference && (
            <button type="button" data-testid="show-reference" onClick={showReference}>
              Авторское решение целиком ↓
            </button>
          )}
          {reference}
        </div>
      )}
      reviewBar={() => <div data-testid="verdict-bar">балл и решение</div>}
      onClose={() => {}}
      {...extra}
    />,
  )
}

const column = () => screen.queryByTestId('solution-reference-column')
const block = () => screen.queryByTestId('solution-reference-panel')
const sideBtn = () => screen.getByTestId('reference-placement-side')
const belowBtn = () => screen.getByTestId('reference-placement-below')

describe('§235. Решение рядом или внизу', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('по умолчанию «Рядом»: эталон колонкой слева от работы, блока под заданиями нет', () => {
    stubScreen(true)
    renderReview()

    expect(sideBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(belowBtn()).toHaveAttribute('aria-pressed', 'false')

    const col = column()
    expect(col).toBeInTheDocument()
    expect(within(col as HTMLElement).getByText(/Ответ: 12 м\/с/)).toBeInTheDocument()
    // Одна копия эталона на экране — не колонка плюс блок.
    expect(block()).not.toBeInTheDocument()
    expect(screen.getAllByText(/Ответ: 12 м\/с/)).toHaveLength(1)

    // Порядок колонок: эталон, граница, работа, граница, задания.
    const row = screen.getByTestId('attempt-split-row')
    const order = Array.from(row.children).map(el => (el as HTMLElement).dataset.testid)
    expect(order).toEqual([
      'solution-reference-column', 'solution-split-handle', 'attempt-work-column',
      'review-split-handle', 'review-side-column',
    ])
    // Нижняя строка решения на месте и вне колонок.
    expect(row.contains(screen.getByTestId('review-bar'))).toBe(false)
  })

  it('«Внизу» — как в §226: колонки нет, блок под заданиями; и обратно', () => {
    stubScreen(true)
    renderReview()

    fireEvent.click(belowBtn())
    expect(belowBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(column()).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('review-side-column')).getByTestId('solution-reference-panel')).toBeInTheDocument()
    expect(screen.getAllByText(/Ответ: 12 м\/с/)).toHaveLength(1)

    fireEvent.click(sideBtn())
    expect(column()).toBeInTheDocument()
    expect(block()).not.toBeInTheDocument()
  })

  it('«Внизу ↓» в шапке колонки делает то же, что вторая кнопка', () => {
    stubScreen(true)
    renderReview()
    fireEvent.click(screen.getByTestId('solution-reference-column-below'))
    expect(column()).not.toBeInTheDocument()
    expect(belowBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem(REFERENCE_PLACEMENT_STORAGE_KEY)).toBe('below')
  })

  it('выбор запоминается и действует в следующей работе', () => {
    stubScreen(true)
    renderReview()
    fireEvent.click(belowBtn())
    expect(window.localStorage.getItem(REFERENCE_PLACEMENT_STORAGE_KEY)).toBe('below')

    cleanup()
    renderReview()
    expect(belowBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(column()).not.toBeInTheDocument()
    expect(block()).toBeInTheDocument()

    fireEvent.click(sideBtn())
    expect(window.localStorage.getItem(REFERENCE_PLACEMENT_STORAGE_KEY)).toBe('side')
    cleanup()
    renderReview()
    expect(column()).toBeInTheDocument()
  })

  it('мусор в хранилище читается как «Рядом»', () => {
    window.localStorage.setItem(REFERENCE_PLACEMENT_STORAGE_KEY, 'поперёк')
    stubScreen(true)
    renderReview()
    expect(sideBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(column()).toBeInTheDocument()
  })

  it('хранилище недоступно — «Рядом», переключение работает, экран не падает', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    stubScreen(true)
    renderReview()

    expect(sideBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(column()).toBeInTheDocument()

    fireEvent.click(belowBtn())
    expect(column()).not.toBeInTheDocument()
    expect(block()).toBeInTheDocument()
  })

  it('у темы нет эталона — нет ни переключателя, ни колонки', () => {
    stubScreen(true)
    renderReview({ solutionTopicId: undefined })
    expect(screen.queryByTestId('reference-placement')).not.toBeInTheDocument()
    expect(column()).not.toBeInTheDocument()
    expect(block()).not.toBeInTheDocument()
    expect(screen.queryByTestId('show-reference')).not.toBeInTheDocument()
  })

  it('узкий экран — всегда «Внизу», переключатель скрыт, даже если запомнено «Рядом»', () => {
    window.localStorage.setItem(REFERENCE_PLACEMENT_STORAGE_KEY, 'side')
    stubScreen(false)
    renderReview()
    expect(screen.queryByTestId('reference-placement')).not.toBeInTheDocument()
    expect(column()).not.toBeInTheDocument()
    expect(within(screen.getByTestId('review-side-column')).getByTestId('solution-reference-panel')).toBeInTheDocument()
  })

  it('окно сузили на ходу — эталон уезжает вниз; расширили — возвращается рядом, выбор не стёрт', () => {
    const screenSize = stubScreen(true)
    renderReview()
    expect(column()).toBeInTheDocument()

    screenSize.resize(false)
    expect(column()).not.toBeInTheDocument()
    expect(screen.queryByTestId('reference-placement')).not.toBeInTheDocument()
    expect(block()).toBeInTheDocument()

    screenSize.resize(true)
    expect(column()).toBeInTheDocument()
    expect(window.localStorage.getItem(REFERENCE_PLACEMENT_STORAGE_KEY)).toBeNull()
  })

  it('«Авторское решение целиком» в режиме «Рядом» прокручивает колонку эталона к началу', () => {
    stubScreen(true)
    renderReview()
    const scroller = screen.getByTestId('solution-reference-column-scroll')
    const scrollTo = vi.fn()
    ;(scroller as HTMLElement & { scrollTo: typeof scrollTo }).scrollTo = scrollTo

    fireEvent.click(screen.getByTestId('show-reference'))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
    expect(column()).toHaveAttribute('data-flash', 'true')
    // Режим не переключился и блок внизу не появился.
    expect(block()).not.toBeInTheDocument()
  })

  it('«Авторское решение целиком» в режиме «Внизу» по-прежнему раскрывает блок', () => {
    window.localStorage.setItem(REFERENCE_PLACEMENT_STORAGE_KEY, 'below')
    window.localStorage.setItem('review:reference-open', '0')
    stubScreen(true)
    renderReview()
    expect(screen.getByTestId('attempt-solution-toggle')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByTestId('show-reference'))
    expect(screen.getByTestId('attempt-solution-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('граница «эталон | работа» двигается с клавиатуры и запоминается общей долей', () => {
    stubScreen(true)
    renderReview()
    const handle = screen.getByTestId('solution-split-handle')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(column()?.style.getPropertyValue('--solution-pane-w')).toBe('42.0%')
    expect(Number(window.localStorage.getItem(SOLUTION_FRACTION_STORAGE_KEY))).toBeCloseTo(0.42, 5)

    cleanup()
    renderReview()
    expect(column()?.style.getPropertyValue('--solution-pane-w')).toBe('42.0%')
  })

  it('граница двигается указателем', () => {
    stubScreen(true)
    renderReview()
    const row = screen.getByTestId('attempt-split-row')
    row.getBoundingClientRect = () => ({
      left: 0, width: 1000, right: 1000, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
    const handle = screen.getByTestId('solution-split-handle')
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 })
    expect(column()?.style.getPropertyValue('--solution-pane-w')).toBe('30.0%')
    expect(window.localStorage.getItem(SOLUTION_FRACTION_STORAGE_KEY)).toBe('0.3')
  })

  it('режим чтения (в работе коллега) не трогаем: переключателя нет, эталон в своей колонке справа', () => {
    stubScreen(true)
    renderReview({ locked: true })
    expect(screen.queryByTestId('reference-placement')).not.toBeInTheDocument()
    expect(column()).not.toBeInTheDocument()
    expect(within(screen.getByTestId('review-reference-column')).getByTestId('solution-reference-panel')).toBeInTheDocument()
  })

  it('экран ученика не трогаем: ни переключателя, ни колонки эталона', () => {
    stubScreen(true)
    render(
      <AttemptAnnotationOverlay attemptId="a1" files={files} title="ДЗ" readOnly onClose={() => {}} />,
    )
    expect(screen.queryByTestId('reference-placement')).not.toBeInTheDocument()
    expect(column()).not.toBeInTheDocument()
    expect(screen.queryByTestId('attempt-annotation-overlay')?.dataset.layout).toBeUndefined()
  })
})
