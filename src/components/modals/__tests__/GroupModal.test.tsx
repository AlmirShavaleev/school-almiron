import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GroupModal } from '@/components/modals/GroupModal'

const fromSpy = vi.fn()
let profileState: { id: string; role: string } = { id: 'profile-1', role: 'teacher' }
let groupsInsertPayload: any = null
let groupsUpdatePayload: any = null

function makeChain(result: any, handlers: Partial<Record<string, (...args: any[]) => any>> = {}) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      if (prop in handlers) return handlers[prop as string]
      return () => chain
    },
  })
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromSpy(...args),
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { profile: typeof profileState }) => unknown) => selector({ profile: profileState }),
}))

describe('GroupModal teacher assignment', () => {
  beforeEach(() => {
    profileState = { id: 'profile-1', role: 'teacher' }
    groupsInsertPayload = null
    groupsUpdatePayload = null
    fromSpy.mockReset()

    fromSpy.mockImplementation((table: string) => {
      if (table === 'courses') return makeChain({ data: [{ id: 'course-1', title: 'Физика', subject: 'physics', exam_type: 'ege' }], error: null })
      if (table === 'teachers') {
        return makeChain({ data: { id: 'teacher-9', profiles: { full_name: 'Текущий преподаватель' } }, error: null })
      }
      if (table === 'curators') return makeChain({ data: [], error: null })
      if (table === 'groups') {
        return makeChain(
          { data: null, error: null },
          {
            insert: (payload: any) => { groupsInsertPayload = payload; return makeChain({ error: null }) },
            update: (payload: any) => { groupsUpdatePayload = payload; return makeChain({ error: null }) },
          },
        )
      }
      if (table === 'group_students') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })
  })

  function renderModal(props?: Partial<React.ComponentProps<typeof GroupModal>>) {
    return render(
      <MemoryRouter>
        <GroupModal
          open
          onClose={() => {}}
          onSaved={() => {}}
          {...props}
        />
      </MemoryRouter>,
    )
  }

  /** Существующая группа: единственный режим модалки после §64. */
  const EXISTING_GROUP = {
    id: 'group-1',
    name: 'Существующая',
    course_id: 'course-1',
    teacher_id: 'teacher-9',
    curator_id: null,
    max_students: 20,
    schedule_days: [] as string[],
    schedule_time: null,
    is_active: true,
  }

  // Создание групп из интерфейса убрано в §64: один курс = одна группа, и
  // группа заводится вместе с курсом триггером courses_ensure_group. Тесты,
  // проверявшие teacher_id на ВСТАВКЕ, переписаны на сохранение существующей
  // группы — сама проверка (teachers.id, а не profiles.id) осталась той же.
  it('создание группы из интерфейса не доходит до вставки', async () => {
    renderModal()
    await screen.findByText('Преподаватель группы: Вы')
    fireEvent.change(screen.getByPlaceholderText('Например: ЕГЭ Физика 11А'), { target: { value: 'Новая группа' } })
    fireEvent.click(screen.getByText('Создать группу'))
    await waitFor(() => expect(screen.getByText('Создать группу')).toBeInTheDocument())
    expect(groupsInsertPayload).toBeNull()
  })

  it('у группы преподавателя сохраняется teachers.id, а не profiles.id', async () => {
    renderModal({ group: EXISTING_GROUP })
    await screen.findByText('Преподаватель группы: Вы')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await waitFor(() => expect(groupsUpdatePayload).not.toBeNull())
    expect(groupsUpdatePayload.teacher_id).toBe('teacher-9')
    expect(groupsUpdatePayload.teacher_id).not.toBe('profile-1')
  })

  it('teacher does not see dropdown for other teachers and sees read-only self label', async () => {
    renderModal()
    expect(await screen.findByText('Преподаватель группы: Вы')).toBeInTheDocument()
    expect(screen.queryByText('Не назначен')).not.toBeInTheDocument()
  })

  it('blocks submit when teacher row is missing', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'courses') return makeChain({ data: [{ id: 'course-1', title: 'Физика', subject: 'physics', exam_type: 'ege' }], error: null })
      if (table === 'teachers') return makeChain({ data: null, error: null })
      if (table === 'curators') return makeChain({ data: [], error: null })
      if (table === 'groups') {
        return makeChain(
          { data: null, error: null },
          { insert: (payload: any) => { groupsInsertPayload = payload; return makeChain({ error: null }) } },
        )
      }
      return makeChain({ data: [], error: null })
    })

    renderModal()
    await screen.findByText('Преподаватель группы: Вы')
    fireEvent.change(screen.getByPlaceholderText('Например: ЕГЭ Физика 11А'), { target: { value: 'Новая группа' } })
    fireEvent.click(screen.getByText('Создать группу'))

    expect(await screen.findByText('Не удалось определить вашу запись преподавателя. Создание группы временно недоступно.')).toBeInTheDocument()
    expect(groupsInsertPayload).toBeNull()
  })

  it('admin sees teacher dropdown', async () => {
    profileState = { id: 'admin-1', role: 'admin' }
    fromSpy.mockImplementation((table: string) => {
      if (table === 'courses') return makeChain({ data: [{ id: 'course-1', title: 'Физика', subject: 'physics', exam_type: 'ege' }], error: null })
      if (table === 'teachers') return makeChain({ data: [{ id: 'teacher-9', profiles: { full_name: 'Преподаватель 1', email: 't1@example.com' } }], error: null })
      if (table === 'curators') return makeChain({ data: [], error: null })
      if (table === 'groups') return makeChain({ data: null, error: null })
      return makeChain({ data: [], error: null })
    })
    renderModal()
    expect(await screen.findByText('Преподаватель')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Преподаватель 1/i })).toBeInTheDocument()
  })

  it('owner sees teacher dropdown', async () => {
    profileState = { id: 'owner-1', role: 'owner' }
    fromSpy.mockImplementation((table: string) => {
      if (table === 'courses') return makeChain({ data: [{ id: 'course-1', title: 'Физика', subject: 'physics', exam_type: 'ege' }], error: null })
      if (table === 'teachers') return makeChain({ data: [{ id: 'teacher-9', profiles: { full_name: 'Преподаватель 1', email: 't1@example.com' } }], error: null })
      if (table === 'curators') return makeChain({ data: [], error: null })
      if (table === 'groups') return makeChain({ data: null, error: null })
      return makeChain({ data: [], error: null })
    })
    renderModal()
    expect(await screen.findByRole('option', { name: /Преподаватель 1/i })).toBeInTheDocument()
  })

  it('admin keeps selected teacher_id on save', async () => {
    profileState = { id: 'admin-1', role: 'admin' }
    // Список преподавателей нужен именно здесь: у админа он выпадающим, и по
    // умолчанию в моке пуст.
    fromSpy.mockImplementation((table: string) => {
      if (table === 'courses') return makeChain({ data: [{ id: 'course-1', title: 'Физика', subject: 'physics', exam_type: 'ege' }], error: null })
      if (table === 'teachers') return makeChain({ data: [{ id: 'teacher-9', profiles: { full_name: 'Преподаватель 1', email: 't1@example.com' } }], error: null })
      if (table === 'curators') return makeChain({ data: [], error: null })
      if (table === 'groups') {
        return makeChain(
          { data: null, error: null },
          { update: (payload: any) => { groupsUpdatePayload = payload; return makeChain({ error: null }) } },
        )
      }
      return makeChain({ data: [], error: null })
    })
    renderModal({ group: { ...EXISTING_GROUP, teacher_id: null } })
    await screen.findByRole('option', { name: /Преподаватель 1/i })
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: 'teacher-9' } })
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await waitFor(() => expect(groupsUpdatePayload).not.toBeNull())
    expect(groupsUpdatePayload.teacher_id).toBe('teacher-9')
  })

  it('editing existing group as teacher does not null out teacher_id', async () => {
    renderModal({
      group: {
        id: 'group-1',
        name: 'Существующая',
        course_id: 'course-1',
        teacher_id: 'teacher-9',
        curator_id: null,
        max_students: 20,
        schedule_days: [],
        schedule_time: null,
        is_active: true,
      },
    })
    await screen.findByText('Преподаватель группы: Вы')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await waitFor(() => expect(groupsUpdatePayload).not.toBeNull())
    expect(groupsUpdatePayload.teacher_id).toBe('teacher-9')
  })
})
