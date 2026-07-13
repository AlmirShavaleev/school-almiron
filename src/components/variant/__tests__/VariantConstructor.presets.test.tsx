import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const generateTasksSpy = vi.fn()
const SECTION_FIXTURES = [
  {
    id: 'sec-1',
    title: 'Алгебра',
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    external_id: 1,
    exam_number: 1,
    position: 1,
    task_count: 10,
    exam_part_majority: 1,
  },
  {
    id: 'sec-2',
    title: 'Геометрия',
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    external_id: 2,
    exam_number: 2,
    position: 2,
    task_count: 8,
    exam_part_majority: 2,
  },
  {
    id: 'sec-3',
    title: 'Вероятность',
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    external_id: 3,
    exam_number: 3,
    position: 3,
    task_count: 6,
    exam_part_majority: 1,
  },
]

vi.mock('@/hooks/useCatalog', () => ({
  SUBJECT_FROM_SLUG: { math: 'Математика', physics: 'Физика' },
  EXAM_FROM_SLUG: { ege: 'ЕГЭ', oge: 'ОГЭ' },
  useCatalogSections: () => ({
    sections: SECTION_FIXTURES,
    loading: false,
    error: null,
  }),
  useCatalogTopics: () => ({
    topics: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useVariants', () => ({
  useVariantBuilder: () => ({
    generateTasks: generateTasksSpy,
    generating: false,
    saving: false,
    genError: null,
    setGenError: vi.fn(),
  }),
}))

import { VariantConstructor } from '@/components/variant/VariantConstructor'

describe('VariantConstructor presets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateTasksSpy.mockResolvedValue([])
  })

  function renderConstructor() {
    return render(
      <MemoryRouter>
        <VariantConstructor
          headerTitle="Конструктор варианта"
          initialData={{ subject: 'math', examType: 'ege', title: 'Тестовый вариант' }}
          completeActionLabel="Сохранить"
          onBack={() => {}}
          onComplete={vi.fn(async () => {})}
          onSaveDraft={vi.fn(async () => {})}
          onReplaceTask={vi.fn(async () => null)}
        />
      </MemoryRouter>,
    )
  }

  it('standard preset sets one task in every section and updates summary', async () => {
    renderConstructor()

    fireEvent.click(screen.getByTestId('variant-preset-standard'))

    expect(screen.getByText('Разделов')).toBeInTheDocument()
    expect(screen.getByText('Задач')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('variant-constructor-generate'))

    await waitFor(() => expect(generateTasksSpy).toHaveBeenCalledTimes(1))
    expect(generateTasksSpy).toHaveBeenCalledWith([
      { section_id: 'sec-1', cnt: 1, topic_ids: [] },
      { section_id: 'sec-2', cnt: 1, topic_ids: [] },
      { section_id: 'sec-3', cnt: 1, topic_ids: [] },
    ], { hydrateTasks: true })
  })

  it('part presets keep only matching sections and reset the rest', async () => {
    const first = renderConstructor()

    fireEvent.click(screen.getByTestId('variant-preset-part1'))
    fireEvent.click(screen.getByTestId('variant-constructor-generate'))

    await waitFor(() => expect(generateTasksSpy).toHaveBeenCalledTimes(1))
    expect(generateTasksSpy).toHaveBeenCalledWith([
      { section_id: 'sec-1', cnt: 1, topic_ids: [] },
      { section_id: 'sec-3', cnt: 1, topic_ids: [] },
    ], { hydrateTasks: true })

    generateTasksSpy.mockClear()
    first.unmount()

    renderConstructor()

    fireEvent.click(screen.getByTestId('variant-preset-part2'))
    fireEvent.click(screen.getByTestId('variant-constructor-generate'))

    await waitFor(() => expect(generateTasksSpy).toHaveBeenCalledTimes(1))
    expect(generateTasksSpy).toHaveBeenCalledWith([
      { section_id: 'sec-2', cnt: 1, topic_ids: [] },
    ], { hydrateTasks: true })
  })
})
