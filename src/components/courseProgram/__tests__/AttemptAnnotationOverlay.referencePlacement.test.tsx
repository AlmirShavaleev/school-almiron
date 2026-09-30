import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/**
 * §235 → §248. Где на экране проверки эталон.
 *
 * До §248 здесь проверялся переключатель «Решение: Рядом / Внизу» — эталон
 * постоянной колонкой слева от работы или блоком под заданиями. Владелец
 * назвал постоянную колонку шумом (макет §248): теперь «Рядом» — это
 * ВЫДВИЖНАЯ панель поверх фото по кнопке «Эталон», а «Внизу» — пункт меню
 * «…» («Эталон снизу, а не сбоку»), блок под заданием как в §226. Ключ
 * хранилища прежний, поэтому тесты памяти выбора остались по смыслу теми же.
 *
 * Поведение, а не классы: где ОКАЗЫВАЕТСЯ эталон, что он одной копией, что
 * выбор переживает повторное открытие и падение хранилища, что Esc сначала
 * закрывает панель, а не весь разбор. Панель и блок — настоящие (эталон
 * текстовый, сети нет), подменён только хук загрузки материалов.
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

const answers = [
  { no: '1', expected: '12 м/с' },
  { no: '2', expected: '0,4' },
  { no: '3', expected: null },
]

function renderReview(extra: Record<string, unknown> = {}) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ"
      solutionTopicId="t1"
      referenceAnswers={answers}
      currentTaskNo="2"
      reviewPanel={({ reference, showReference }) => (
        <div data-testid="tasks">
          задания
          {showReference && (
            <button type="button" data-testid="show-reference" onClick={showReference}>
              Решение в эталоне
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

const drawer = () => screen.queryByTestId('solution-reference-drawer')
const block = () => screen.queryByTestId('solution-reference-panel')
const toggle = () => screen.getByTestId('attempt-reference-toggle')
const openMenu = () => fireEvent.click(screen.getByTestId('attempt-more-menu'))
const placementItem = () => screen.getByTestId('reference-placement-toggle')

describe('§248. Эталон по запросу: панель поверх фото или блок снизу', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('по умолчанию эталона на экране нет — постоянной колонки больше нет', () => {
    renderReview()
    expect(drawer()).not.toBeInTheDocument()
    expect(block()).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-reference-column')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    // Колонок две: работа и задание.
    const order = Array.from(screen.getByTestId('attempt-split-row').children).map(el => (el as HTMLElement).dataset.testid)
    expect(order).toEqual(['attempt-work-column', 'review-split-handle', 'review-side-column'])
  })

  it('«Эталон» открывает панель поверх фото: ответы, авторское решение, «только для вас»', () => {
    renderReview()
    fireEvent.click(toggle())
    const panel = drawer() as HTMLElement
    expect(panel).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    // Панель — внутри колонки фото, а не отдельной колонкой.
    expect(screen.getByTestId('attempt-work-column')).toContainElement(panel)
    expect(panel).toHaveTextContent('Только для вас — ученик этого не увидит')
    expect(within(panel).getByText(/Ответ: 12 м\/с/)).toBeInTheDocument()
    // Ответы по заданиям: пустой эталон не печатается, текущее подсвечено.
    const rows = within(panel).getByTestId('solution-reference-answers').querySelectorAll('tr')
    expect(Array.from(rows).map(row => row.dataset.no)).toEqual(['1', '2'])
    expect(rows[1]).toHaveAttribute('data-current', 'true')
    expect(rows[0]).not.toHaveAttribute('data-current')

    fireEvent.click(toggle())
    expect(drawer()).not.toBeInTheDocument()
  })

  it('«Решение в эталоне» у задания открывает ту же панель; «Закрыть» закрывает', () => {
    renderReview()
    fireEvent.click(screen.getByTestId('show-reference'))
    expect(drawer()).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('solution-reference-drawer-close'))
    expect(drawer()).not.toBeInTheDocument()
  })

  it('Esc сначала закрывает панель эталона и только потом — сам разбор', () => {
    const onClose = vi.fn()
    renderReview({ onClose })
    fireEvent.click(toggle())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawer()).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('«Эталон снизу, а не сбоку» из меню — блок под заданием, как в §226; и обратно', () => {
    renderReview()
    openMenu()
    expect(placementItem()).toHaveTextContent('Эталон снизу, а не сбоку')
    fireEvent.click(placementItem())

    expect(window.localStorage.getItem(REFERENCE_PLACEMENT_STORAGE_KEY)).toBe('below')
    expect(within(screen.getByTestId('review-side-column')).getByTestId('solution-reference-panel')).toBeInTheDocument()
    expect(drawer()).not.toBeInTheDocument()
    expect(screen.getAllByText(/Ответ: 12 м\/с/)).toHaveLength(1)
    // «Эталон» в этом режиме сворачивает и раскрывает блок.
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('attempt-solution-toggle')).toHaveAttribute('aria-expanded', 'false')

    openMenu()
    expect(placementItem()).toHaveTextContent('Эталон сбоку, поверх фото')
    fireEvent.click(placementItem())
    expect(block()).not.toBeInTheDocument()
    expect(window.localStorage.getItem(REFERENCE_PLACEMENT_STORAGE_KEY)).toBe('side')
  })

  it('выбор «снизу» запоминается и действует в следующей работе', () => {
    renderReview()
    openMenu()
    fireEvent.click(placementItem())
    cleanup()
    renderReview()
    expect(block()).toBeInTheDocument()
    expect(drawer()).not.toBeInTheDocument()
  })

  it('мусор в хранилище читается как «сбоку»', () => {
    window.localStorage.setItem(REFERENCE_PLACEMENT_STORAGE_KEY, 'поперёк')
    renderReview()
    expect(block()).not.toBeInTheDocument()
    fireEvent.click(toggle())
    expect(drawer()).toBeInTheDocument()
  })

  it('хранилище недоступно — «сбоку», переключение работает, экран не падает', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError') })
    renderReview()
    fireEvent.click(toggle())
    expect(drawer()).toBeInTheDocument()
    openMenu()
    fireEvent.click(placementItem())
    expect(block()).toBeInTheDocument()
  })

  it('у темы нет авторского решения, но есть ответы — «Эталон» показывает ответы, пункта «снизу» нет', () => {
    renderReview({ solutionTopicId: null })
    fireEvent.click(toggle())
    expect(within(drawer() as HTMLElement).getByTestId('solution-reference-answers')).toBeInTheDocument()
    expect(within(drawer() as HTMLElement).queryByText(/Авторское решение/)).not.toBeInTheDocument()
    openMenu()
    expect(screen.queryByTestId('reference-placement-toggle')).not.toBeInTheDocument()
  })

  it('ни решения, ни ответов — ни кнопки «Эталон», ни ссылки у задания', () => {
    renderReview({ solutionTopicId: null, referenceAnswers: [] })
    expect(screen.queryByTestId('attempt-reference-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('show-reference')).not.toBeInTheDocument()
  })

  it('режим чтения (в работе коллега): вердикта нет, а эталон по-прежнему открывается', () => {
    renderReview({ locked: true, viewers: [{ profileId: 'p2', name: 'Коллега', attemptId: 'a1' }] })
    expect(screen.queryByTestId('review-side-column')).not.toBeInTheDocument()
    fireEvent.click(toggle())
    expect(drawer()).toBeInTheDocument()
  })

  it('экран ученика не трогаем: ни кнопки «Эталон», ни панели', () => {
    render(
      <AttemptAnnotationOverlay attemptId="a1" files={files} title="ДЗ" readOnly onClose={() => {}} />,
    )
    expect(screen.queryByTestId('attempt-reference-toggle')).not.toBeInTheDocument()
    expect(drawer()).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-reference-column')).not.toBeInTheDocument()
  })
})
