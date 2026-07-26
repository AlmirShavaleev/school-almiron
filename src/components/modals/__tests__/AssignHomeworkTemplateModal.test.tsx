import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AssignHomeworkTemplateModal } from '@/components/modals/AssignHomeworkTemplateModal'

// Input/Select don't wire label -> htmlFor/id, so getByLabelText can't find them (it does
// work for the native <label><input .../>text</label> radios/checkboxes below). Locate the
// field by its label text and grab the input/select inside the same field wrapper instead.
function fieldByLabel(labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = screen.getByText(labelText)
  const wrapper = label.parentElement!
  return wrapper.querySelector('input, select') as HTMLInputElement | HTMLSelectElement
}

const createTemplate = vi.fn()
const assign = vi.fn()

vi.mock('@/hooks/useHomeworkTemplates', () => ({
  useHomeworkTemplates: () => ({
    templates: [{ id: 'tpl-1', title: 'Существующий шаблон', course_id: 'c1', latest_version_id: 'v1', latest_version: 1, max_score: 100 }],
    loading: false,
    createTemplate,
  }),
}))

let assignError: string | null = null
vi.mock('@/hooks/useAssignHomeworkV2', () => ({
  useAssignHomeworkV2: () => ({ assign, submitting: false, error: assignError }),
}))

const students = [
  { id: 's1', profile_id: 'p1', full_name: 'Иван Иванов', email: 'a@a.ru', avatar_url: null },
  { id: 's2', profile_id: 'p2', full_name: 'Пётр Петров', email: 'b@b.ru', avatar_url: null },
]

beforeEach(() => {
  createTemplate.mockReset()
  assign.mockReset()
  assignError = null
  assign.mockResolvedValue({ assignment_id: 'a1', recipient_count: 2 })
})

describe('AssignHomeworkTemplateModal', () => {
  it('не рендерится когда open=false', () => {
    render(<AssignHomeworkTemplateModal open={false} onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} />)
    expect(screen.queryByText('Назначить ДЗ')).not.toBeInTheDocument()
  })

  it('без выбора шаблона и без дедлайна показывает ошибку валидации, assign не вызывается', () => {
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} />)
    fireEvent.click(screen.getByRole('button', { name: 'Назначить 2 ученикам' }))
    expect(screen.getByText(/Выберите шаблон ДЗ/)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('назначение всей группе существующим шаблоном вызывает assign с studentIds=null', async () => {
    const onAssigned = vi.fn()
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={onAssigned} courseId="c1" groupId="g1" students={students} />)

    fireEvent.change(fieldByLabel('Шаблон ДЗ *'), { target: { value: 'v1' } })
    fireEvent.change(fieldByLabel('Дедлайн *'), { target: { value: '2026-12-01T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Назначить 2 ученикам' }))

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    const call = assign.mock.calls[0][0]
    expect(call.templateVersionId).toBe('v1')
    expect(call.groupId).toBe('g1')
    expect(call.studentIds).toBeNull()
    expect(call.publishNow).toBe(true)
  })

  it('режим «Выбрать учеников» без выбора ни одного ученика показывает ошибку', () => {
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} />)
    fireEvent.change(fieldByLabel('Шаблон ДЗ *'), { target: { value: 'v1' } })
    fireEvent.change(fieldByLabel('Дедлайн *'), { target: { value: '2026-12-01T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отдельные ученики' }))
    fireEvent.click(screen.getByRole('button', { name: 'Назначить 0 ученикам' }))
    expect(screen.getByText(/Выберите хотя бы одного ученика/)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('назначение выбранным ученикам передаёт только их id', async () => {
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} />)
    fireEvent.change(fieldByLabel('Шаблон ДЗ *'), { target: { value: 'v1' } })
    fireEvent.change(fieldByLabel('Дедлайн *'), { target: { value: '2026-12-01T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отдельные ученики' }))
    fireEvent.click(screen.getByLabelText('Иван Иванов'))
    fireEvent.click(screen.getByRole('button', { name: 'Назначить 1 ученикам' }))

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(assign.mock.calls[0][0].studentIds).toEqual(['s1'])
  })

  it('запланированная публикация без даты публикации — ошибка валидации', () => {
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} />)
    fireEvent.change(fieldByLabel('Шаблон ДЗ *'), { target: { value: 'v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Дополнительные настройки' }))
    fireEvent.click(screen.getByLabelText('Запланировать'))
    fireEvent.change(fieldByLabel('Дедлайн *'), { target: { value: '2026-12-01T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Назначить 2 ученикам' }))
    expect(screen.getByText(/Укажите дату публикации/)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('создание нового шаблона вызывает createTemplate перед assign', async () => {
    createTemplate.mockResolvedValue({ template_id: 'new-t', template_version_id: 'new-v', version: 1 })
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} />)
    fireEvent.click(screen.getByRole('button', { name: 'Новый шаблон' }))
    fireEvent.change(fieldByLabel('Название шаблона *'), { target: { value: 'Свежий шаблон' } })
    fireEvent.change(fieldByLabel('Дедлайн *'), { target: { value: '2026-12-01T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Назначить 2 ученикам' }))

    await vi.waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(assign.mock.calls[0][0].templateVersionId).toBe('new-v')
  })

  it('при preselectedTemplateVersionId скрывает переключатель шаблона', () => {
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={students} preselectedTemplateVersionId="v1" />)
    expect(screen.queryByRole('button', { name: 'Существующий шаблон' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Новый шаблон' })).not.toBeInTheDocument()
  })

  it('для пустой группы показывает понятное сообщение и не рендерит техническую ошибку', () => {
    assignError = 'NO_RECIPIENTS: group has no matching students.'
    render(<AssignHomeworkTemplateModal open onClose={vi.fn()} onAssigned={vi.fn()} courseId="c1" groupId="g1" students={[]} />)
    expect(screen.getByText('Кому назначить')).toBeInTheDocument()
    expect(screen.getByText('В этой группе пока нет учеников')).toBeInTheDocument()
    expect(screen.queryByText('NO_RECIPIENTS: group has no matching students.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Назначить 0 ученикам' })).toBeDisabled()
  })
})
