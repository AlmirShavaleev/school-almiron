import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi } from 'vitest'
import { TABLE_FRACTION_STORAGE_KEY } from '@/lib/reviewPaneLayout'

/**
 * §210. Три колонки: решение, работа, таблица проверки.
 *
 * Тест держит раскладку, а не оформление: что колонок ровно столько, сколько
 * есть чего показывать; что таблица лежит СНАРУЖИ свитка работы (иначе колесо
 * в таблице уводит работу — из-за этого всё и затевалось); что обе границы
 * двигаются, запоминаются и не схлопывают колонку в ноль; и что у ученика,
 * которому класть в третью колонку нечего, ничего не поехало.
 */

const materials = [{
  kind: 'file' as const, id: 'm1', title: 'Решение', position: 0, isVisible: false,
  section: 'solution' as const, storagePath: 't1/solution.pdf', fileName: 'solution.pdf', sizeBytes: 10,
}]

vi.mock('@/components/courseProgram/SolutionReferencePanel', () => ({
  SolutionReferencePanel: () => <div data-testid="solution-reference-panel" />,
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
      reviewPanel={() => <div data-testid="verdict-form">таблица и вердикт</div>}
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

  it('с решением колонок три: решение, работа, таблица', () => {
    renderStaff()
    expect(screen.getByTestId('solution-reference-panel')).toBeInTheDocument()
    expect(screen.getByTestId('attempt-work-column')).toBeInTheDocument()
    expect(screen.getByTestId('review-side-column')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-form')).toBeInTheDocument()
  })

  it('решение выключили — колонок две, таблица осталась', () => {
    renderStaff()
    fireEvent.click(screen.getByTestId('attempt-solution-toggle'))

    expect(screen.queryByTestId('solution-reference-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()
    expect(screen.getByTestId('attempt-work-column')).toBeInTheDocument()
    expect(screen.getByTestId('review-side-column')).toBeInTheDocument()
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
    // 1600 ≥ 1536, значит решение занимает свои 40 %: работе обязано остаться
    // 20 %, и дальше 40 % таблицу не пускает уже это, а не её собственный
    // потолок в 50 %.
    expect(widthOfSideColumn()).toBe('40.0%')
  })

  it('без решения таблице достаётся её полный потолок', () => {
    renderStaff()
    fireEvent.click(screen.getByTestId('attempt-solution-toggle'))
    const handle = screen.getByTestId('review-split-handle')
    stubArea(1600)

    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(handle, { key: 'ArrowLeft' })
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

  it('обе границы живут своей памятью и не путаются', () => {
    renderStaff()
    stubArea(1600)
    fireEvent.keyDown(screen.getByTestId('solution-split-handle'), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByTestId('review-split-handle'), { key: 'ArrowRight' })

    // 40 % + 2 % у решения, 37 % − 2 % у таблицы.
    expect(widthOfSideColumn()).toBe('35.0%')
    expect(window.localStorage.getItem(TABLE_FRACTION_STORAGE_KEY)).toBe('0.35')
    expect(Number(window.localStorage.getItem('review:solution-pane-fraction'))).toBeCloseTo(0.42, 5)
  })
})
