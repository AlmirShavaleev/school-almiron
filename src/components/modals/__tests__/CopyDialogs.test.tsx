import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { type Course, type Module, type Topic } from '@/hooks/useCourseProgram'

const { mockCopyCourse, mockCopyTopic } = vi.hoisted(() => ({
  mockCopyCourse: vi.fn(),
  mockCopyTopic: vi.fn(),
}))

vi.mock('@/lib/courseCopy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/courseCopy')>('@/lib/courseCopy')
  return { ...actual, copyCourse: mockCopyCourse, copyTopic: mockCopyTopic }
})

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { CopyCourseDialog } from '@/components/modals/CopyCourseDialog'
import { CopyTopicDialog } from '@/components/modals/CopyTopicDialog'

// Общие Input и Select не связывают подпись с полем через htmlFor/id, поэтому
// getByLabelText их не находит. Ищем подпись по тексту и берём поле из той же
// обёртки. Это обходной приём: правильнее связать подпись с полем через useId
// в самих примитивах — тогда и скринридер называл бы поле, а не молчал.
function fieldByLabel(labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = screen.getByText(labelText)
  const wrapper = label.parentElement!
  return wrapper.querySelector('input, select') as HTMLInputElement | HTMLSelectElement
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCopyCourse.mockResolvedValue({ jobId: 'j1', courseId: 'c2', files: [] })
  mockCopyTopic.mockResolvedValue({ jobId: 'j1', topicId: 't2', files: [] })
})

const createCourse = (overrides?: Partial<Course>): Course => ({
  id: 'c1',
  title: 'Физика 9 класс',
  start_date: '2025-09-01',
  is_active: true,
  is_draft: false,
  owner_id: null,
  subject: 'physics',
  exam_type: 'oge',
  description: null,
  price: 0,
  duration_weeks: 36,
  end_date: '2026-05-31',
  enrollment_open_until: null,
  ...overrides,
})

const createTopic = (overrides?: Partial<Topic>): Topic => ({
  id: 't1',
  module_id: 'm1',
  title: 'Кинематика',
  order_index: 0,
  max_score: 100,
  available_from: null,
  is_open: null,
  ...overrides,
})

const createModule = (overrides?: Partial<Module>): Module => ({
  id: 'm1',
  course_id: 'c1',
  title: 'Модуль 1',
  order_index: 0,
  topics: [],
  ...overrides,
})

describe('CopyCourseDialog', () => {
  it('название копии подставляется само', () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const course = createCourse()

    render(
      <CopyCourseDialog
        open={true}
        onClose={onClose}
        course={course}
        onCopied={onCopied}
      />
    )

    const titleInput = fieldByLabel('Название копии') as HTMLInputElement
    expect(titleInput.value).toBe('Физика 9 класс (копия)')
  })

  it('пустое название не даёт скопировать', () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const course = createCourse()

    render(
      <CopyCourseDialog
        open={true}
        onClose={onClose}
        course={course}
        onCopied={onCopied}
      />
    )

    const titleInput = fieldByLabel('Название копии') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: '' } })

    const copyButton = screen.getByRole('button', { name: /Создать копию/ })
    expect(copyButton).toBeDisabled()
    expect(mockCopyCourse).not.toHaveBeenCalled()
  })

  it('по умолчанию даты очищаются', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const course = createCourse()

    render(
      <CopyCourseDialog
        open={true}
        onClose={onClose}
        course={course}
        onCopied={onCopied}
      />
    )

    const copyButton = screen.getByRole('button', { name: /Создать копию/ })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(mockCopyCourse).toHaveBeenCalledTimes(1)
    })

    const call = mockCopyCourse.mock.calls[0][0]
    expect(call.mode).toBe('clear')
    expect(call.shiftDays).toBe(0)
  })

  it('сдвиг считается из новой даты старта', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const course = createCourse()

    render(
      <CopyCourseDialog
        open={true}
        onClose={onClose}
        course={course}
        onCopied={onCopied}
      />
    )

    // Выбрать режим «Сдвинуть на новый учебный год»
    const shiftRadio = screen.getByRole('radio', { name: /Сдвинуть на новый учебный год/ })
    fireEvent.click(shiftRadio)

    // Ввести новую дату (365 дней позже)
    const dateInput = screen.getByDisplayValue('2025-09-01') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-09-01' } })

    // Скопировать
    const copyButton = screen.getByRole('button', { name: /Создать копию/ })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(mockCopyCourse).toHaveBeenCalledTimes(1)
    })

    const call = mockCopyCourse.mock.calls[0][0]
    expect(call.mode).toBe('shift')
    expect(call.shiftDays).toBe(365)
  })

  it('после успеха показывается экран готовности и кнопка ведёт на копию', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const course = createCourse()

    render(
      <CopyCourseDialog
        open={true}
        onClose={onClose}
        course={course}
        onCopied={onCopied}
      />
    )

    const copyButton = screen.getByRole('button', { name: /Создать копию/ })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(screen.getByText('Копия готова')).toBeInTheDocument()
    })

    const openButton = screen.getByRole('button', { name: /Открыть копию/ })
    fireEvent.click(openButton)

    expect(onCopied).toHaveBeenCalledWith('c2')
  })

  it('ошибка копирования показывается пользователем текстом, экран успеха не появляется', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const course = createCourse()

    mockCopyCourse.mockRejectedValueOnce(new Error('Нет доступа'))

    render(
      <CopyCourseDialog
        open={true}
        onClose={onClose}
        course={course}
        onCopied={onCopied}
      />
    )

    const copyButton = screen.getByRole('button', { name: /Создать копию/ })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(screen.getByText('Нет доступа')).toBeInTheDocument()
    })

    expect(screen.queryByText('Копия готова')).not.toBeInTheDocument()
  })
})

describe('CopyTopicDialog', () => {
  it('модули целевого курса подгружаются, по умолчанию выбран курс-источник', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const topic = createTopic()
    const courses = [createCourse({ id: 'c1' }), createCourse({ id: 'c2', title: 'Физика 11 класс' })]
    const loadModules = vi.fn(async (courseId: string) => {
      if (courseId === 'c1') {
        return [createModule({ id: 'm1', course_id: 'c1', title: 'Модуль 1' })]
      } else if (courseId === 'c2') {
        return [createModule({ id: 'm9', course_id: 'c2', title: 'Механика' })]
      }
      return []
    })

    render(
      <CopyTopicDialog
        open={true}
        onClose={onClose}
        topic={topic}
        sourceCourseId="c1"
        courses={courses}
        loadModules={loadModules}
        onCopied={onCopied}
      />
    )

    // Дождаться загрузки модулей
    await waitFor(() => {
      expect(screen.getByText('Модуль 1')).toBeInTheDocument()
    })

    expect(loadModules).toHaveBeenCalledWith('c1')
  })

  it('смена курса подгружает его модули', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const topic = createTopic()
    const courses = [createCourse({ id: 'c1' }), createCourse({ id: 'c2', title: 'Физика 11 класс' })]
    const loadModules = vi.fn(async (courseId: string) => {
      if (courseId === 'c1') {
        return [createModule({ id: 'm1', course_id: 'c1', title: 'Модуль 1' })]
      } else if (courseId === 'c2') {
        return [createModule({ id: 'm9', course_id: 'c2', title: 'Механика' })]
      }
      return []
    })

    render(
      <CopyTopicDialog
        open={true}
        onClose={onClose}
        topic={topic}
        sourceCourseId="c1"
        courses={courses}
        loadModules={loadModules}
        onCopied={onCopied}
      />
    )

    // Дождаться загрузки модулей c1
    await waitFor(() => {
      expect(screen.getByText('Модуль 1')).toBeInTheDocument()
    })

    // Выбрать курс c2
    const courseSelect = fieldByLabel('Куда копировать')
    fireEvent.change(courseSelect, { target: { value: 'c2' } })

    // Дождаться загрузки модулей c2
    await waitFor(() => {
      expect(screen.getByText('Механика')).toBeInTheDocument()
    })
  })

  it('копирование уходит с выбранным модулем', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const topic = createTopic()
    const courses = [createCourse({ id: 'c1' }), createCourse({ id: 'c2', title: 'Физика 11 класс' })]
    const loadModules = vi.fn(async (courseId: string) => {
      if (courseId === 'c1') {
        return [createModule({ id: 'm1', course_id: 'c1', title: 'Модуль 1' })]
      } else if (courseId === 'c2') {
        return [createModule({ id: 'm9', course_id: 'c2', title: 'Механика' })]
      }
      return []
    })

    render(
      <CopyTopicDialog
        open={true}
        onClose={onClose}
        topic={topic}
        sourceCourseId="c1"
        courses={courses}
        loadModules={loadModules}
        onCopied={onCopied}
      />
    )

    // Дождаться загрузки модулей c1
    await waitFor(() => {
      expect(screen.getByText('Модуль 1')).toBeInTheDocument()
    })

    // Выбрать курс c2
    const courseSelect = fieldByLabel('Куда копировать')
    fireEvent.change(courseSelect, { target: { value: 'c2' } })

    // Дождаться загрузки модулей c2
    await waitFor(() => {
      expect(screen.getByText('Механика')).toBeInTheDocument()
    })

    // Нажать кнопку копирования
    const copyButton = screen.getByRole('button', { name: /Скопировать тему/ })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(mockCopyTopic).toHaveBeenCalledTimes(1)
    })

    const call = mockCopyTopic.mock.calls[0][0]
    expect(call).toEqual(
      expect.objectContaining({
        sourceTopicId: 't1',
        targetModuleId: 'm9',
        mode: 'clear',
        shiftDays: 0,
      })
    )
  })

  it('у темы без даты открытия сдвиг недоступен', async () => {
    const onClose = vi.fn()
    const onCopied = vi.fn()
    const topic = createTopic({ available_from: null }) // Нет даты открытия
    const courses = [createCourse({ id: 'c1' })]
    const loadModules = vi.fn(async () => [
      createModule({ id: 'm1', course_id: 'c1', title: 'Модуль 1' }),
    ])

    render(
      <CopyTopicDialog
        open={true}
        onClose={onClose}
        topic={topic}
        sourceCourseId="c1"
        courses={courses}
        loadModules={loadModules}
        onCopied={onCopied}
      />
    )

    // Дождаться загрузки модулей
    await waitFor(() => {
      expect(screen.getByText('Модуль 1')).toBeInTheDocument()
    })

    // Проверить, что радио для сдвига отключено
    const shiftRadio = screen.getByRole('radio', { name: /Сдвинуть на новый учебный год/ })
    expect(shiftRadio).toBeDisabled()
  })
})
