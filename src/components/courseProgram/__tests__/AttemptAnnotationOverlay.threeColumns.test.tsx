import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { vi } from 'vitest'
import { TABLE_FRACTION_STORAGE_KEY } from '@/lib/reviewPaneLayout'

/**
 * §210 → §226. Экран проверки: работа и колонка заданий, внизу строка решения.
 *
 * Тест держит раскладку, а не оформление: что таблица лежит СНАРУЖИ свитка
 * работы (иначе колесо в таблице уводит работу — из-за этого всё и
 * затевалось); что граница двигается, запоминается и не схлопывает колонку в
 * ноль; и что у ученика, которому класть в колонку нечего, ничего не поехало.
 *
 * §226: отдельной колонки решения слева больше нет — эталон приезжает в
 * колонку заданий сворачиваемым блоком (`reference` в контексте панели), а
 * форма вердикта — нижней строкой (`reviewBar`).
 */

const materials = [{
  kind: 'file' as const, id: 'm1', title: 'Решение', position: 0, isVisible: false,
  section: 'solution' as const, storagePath: 't1/solution.pdf', fileName: 'solution.pdf', sizeBytes: 10,
}]

vi.mock('@/components/courseProgram/SolutionReferencePanel', () => ({
  SolutionReferencePanel: () => <div data-testid="solution-reference-panel" />,
  SolutionReferenceBlock: ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="solution-reference-block" aria-expanded={open} onClick={onToggle} />
  ),
  // Как в жизни: без темы решения нет. Ученический экран `solutionTopicId` не
  // передаёт вовсе, и панели у него не появляется ни при каких условиях.
  useTopicSolutionMaterials: (topicId?: string | null) => ({
    materials: topicId ? materials : [], loading: false,
  }),
}))

vi.mock('@/components/SubmissionReviewer', () => ({
  default: () => <div data-testid="submission-reviewer" />,
}))

vi.mock('@/components/ui/SignedFileLink', () => ({
  SignedFileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'

const files = [{
  id: 'f1', attempt_id: 'a1', storage_path: 'a1/page.jpg', file_name: 'page.jpg',
  mime_type: 'image/jpeg', size_bytes: 10, position: 0, created_at: '',
}]

/** Экран проверки: есть и решение, и таблица с вердиктом. */
function renderStaff(extra: Record<string, unknown> = {}) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ"
      solutionTopicId="t1"
      reviewPanel={({ reference }) => <div data-testid="verdict-form">таблица {reference}</div>}
      reviewBar={() => <div data-testid="verdict-bar">балл и решение</div>}
      onClose={() => {}}
      {...extra}
    />,
  )
}

/** Ученик: ни решения, ни таблицы правки, ни формы вердикта — только разбор. */
function renderStudent() {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ"
      subtitle="Пометки учителя"
      readOnly
      onClose={() => {}}
    />,
  )
}

function widthOfSideColumn() {
  return screen.getByTestId('review-side-column').style.getPropertyValue('--review-side-w')
}

/** Рабочая область: тянуть границу без её размеров нельзя. */
function stubArea(width = 1000) {
  const row = screen.getByTestId('attempt-work-column').parentElement as HTMLElement
  row.getBoundingClientRect = () => ({
    left: 0, width, right: width, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
  return row
}

describe('три колонки на экране проверки', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('§226. Колонок две — работа и задания; эталон блоком в колонке заданий', () => {
    renderStaff()
    expect(screen.getByTestId('attempt-annotation-overlay').dataset.layout).toBe('review')
    expect(screen.queryByTestId('solution-reference-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()
    expect(screen.getByTestId('attempt-work-column')).toBeInTheDocument()
    const side = screen.getByTestId('review-side-column')
    expect(within(side).getByTestId('verdict-form')).toBeInTheDocument()
    expect(within(side).getByTestId('solution-reference-block')).toBeInTheDocument()
  })

  it('§226. Форма вердикта — нижней строкой во всю ширину, вне колонок', () => {
    renderStaff()
    const bar = screen.getByTestId('review-bar')
    expect(within(bar).getByTestId('verdict-bar')).toBeInTheDocument()
    expect(screen.getByTestId('attempt-split-row').contains(bar)).toBe(false)
  })

  it('§226. Блок эталона сворачивается, и выбор запоминается', () => {
    renderStaff()
    const block = screen.getByTestId('solution-reference-block')
    expect(block).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(block)
    expect(screen.getByTestId('solution-reference-block')).toHaveAttribute('aria-expanded', 'false')
    cleanup()
    renderStaff()
    expect(screen.getByTestId('solution-reference-block')).toHaveAttribute('aria-expanded', 'false')
  })

  it('§226. «← Очередь проверки» закрывает разбор, сводка и «Следующая» — в шапке', () => {
    const onClose = vi.fn()
    renderStaff({ onClose, backLabel: 'Очередь проверки · 1 из 3', headerAside: <span data-testid="aside">сводка</span> })
    expect(screen.getByTestId('attempt-header-aside')).toContainElement(screen.getByTestId('aside'))
    fireEvent.click(screen.getByTestId('attempt-back'))
    expect(onClose).toHaveBeenCalled()
  })

  it('у ученика третьей колонки нет и ничего не съехало', () => {
    renderStudent()
    expect(screen.queryByTestId('review-side-column')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-split-handle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()

    // Работа по-прежнему занимает всю оставшуюся высоту, а не отмеренные
    // «под три блока» 70vh: третьего блока у ученика нет.
    const work = screen.getByTestId('attempt-work-column')
    expect(work.className).toContain('flex-1')
    expect(work.className).not.toContain('70vh')
    // И общая полоса не превращается в один длинный свиток.
    expect((work.parentElement as HTMLElement).className).not.toContain('overflow-y-auto')
  })

  it('в режиме чтения (в работе уже кто-то есть) вердикта нет — и колонки тоже', () => {
    renderStaff({ locked: true })
    expect(screen.queryByTestId('review-side-column')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-split-handle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-bar')).not.toBeInTheDocument()
    // §226. Эталон при этом остаётся — сверять глазами можно и на чтении.
    expect(within(screen.getByTestId('review-reference-column')).getByTestId('solution-reference-block')).toBeInTheDocument()
  })

  it('таблица лежит снаружи свитка работы — колесо в ней работу не уводит', () => {
    renderStaff()
    const work = screen.getByTestId('attempt-work-column')
    const side = screen.getByTestId('review-side-column')

    expect(work.contains(side)).toBe(false)
    expect(side.contains(work)).toBe(false)
    expect(work.parentElement).toBe(side.parentElement)
    // У каждой колонки свой свиток.
    expect(work.className).toContain('overflow-auto')
    expect(side.className).toContain('overflow-hidden')
  })

  it('колонка есть и тогда, когда размечать нечего — вердикт всё равно ставят', () => {
    render(
      <AttemptAnnotationOverlay
        attemptId="a1"
        files={[{
          id: 'f9', attempt_id: 'a1', storage_path: 'a1/work.docx', file_name: 'work.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size_bytes: 10, position: 0, created_at: '',
        }]}
        title="ДЗ"
        reviewPanel={() => <div data-testid="verdict-form">вердикт</div>}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('verdict-form')).toBeInTheDocument()
  })
})

describe('вторая граница', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('по умолчанию таблица получает 37 % рабочей области', () => {
    renderStaff()
    expect(widthOfSideColumn()).toBe('37.0%')
  })

  it('видна с ноутбука и спрятана на узком экране — как первая', () => {
    renderStaff()
    const handle = screen.getByTestId('review-split-handle')
    expect(handle.className).toContain('hidden')
    expect(handle.className).toContain('lg:block')
  })

  it('тянется указателем и ширина запоминается', () => {
    renderStaff()
    const handle = screen.getByTestId('review-split-handle')
    stubArea(1000)

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 630 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 700 })

    // Курсор на 700 из 1000: справа остаётся 30 %.
    expect(widthOfSideColumn()).toBe('30.0%')
    expect(window.localStorage.getItem(TABLE_FRACTION_STORAGE_KEY)).toBe('0.3')
  })

  it('двигается с клавиатуры — это ползунок, а не декорация', () => {
    renderStaff()
    const handle = screen.getByTestId('review-split-handle')
    stubArea(1600)

    // Ручка едет туда, куда показывает стрелка: вправо — таблица уже.
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOfSideColumn()).toBe('35.0%')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(widthOfSideColumn()).toBe('37.0%')
  })

  it('колонку нельзя утащить в ноль ни с той, ни с другой стороны', () => {
    renderStaff()
    const handle = screen.getByTestId('review-split-handle')
    stubArea(1600)

    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(widthOfSideColumn()).toBe('22.0%')

    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    // §226. Колонки решения рядом больше нет — колонке заданий достаётся её
    // собственный потолок в 50 %, даже когда у темы решение есть.
    expect(widthOfSideColumn()).toBe('50.0%')
  })

  it('запомненная ширина применяется при следующем открытии', () => {
    renderStaff()
    stubArea(1600)
    fireEvent.keyDown(screen.getByTestId('review-split-handle'), { key: 'ArrowRight' })
    expect(widthOfSideColumn()).toBe('35.0%')

    cleanup()
    renderStaff()
    expect(widthOfSideColumn()).toBe('35.0%')
  })

  it('§226. Граница колонки заданий не трогает запомненную ширину старой колонки решения', () => {
    window.localStorage.setItem('review:solution-pane-fraction', '0.42')
    renderStaff()
    stubArea(1600)
    fireEvent.keyDown(screen.getByTestId('review-split-handle'), { key: 'ArrowRight' })

    expect(widthOfSideColumn()).toBe('35.0%')
    expect(window.localStorage.getItem(TABLE_FRACTION_STORAGE_KEY)).toBe('0.35')
    expect(window.localStorage.getItem('review:solution-pane-fraction')).toBe('0.42')
  })
})
