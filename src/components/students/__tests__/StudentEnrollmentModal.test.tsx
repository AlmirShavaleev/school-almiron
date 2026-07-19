import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StudentEnrollmentModal } from '@/components/students/StudentEnrollmentModal'

const createStudentInvite = vi.fn()
const createStudentInviteBatch = vi.fn()
const buildInviteUrl = vi.fn((token: string) => `http://localhost:3000/join/${token}`)
const buildInviteMessage = vi.fn((token: string, code: string) => `MSG:${token}:${code}`)

vi.mock('@/lib/studentEnrollment', () => ({
  createStudentInvite: (arg: unknown) => createStudentInvite(arg),
  createStudentInviteBatch: (arg: unknown) => createStudentInviteBatch(arg),
  buildInviteUrl: (token: string) => buildInviteUrl(token),
  buildInviteMessage: (token: string, code: string) => buildInviteMessage(token, code),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/store/toastStore', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const groups = [
  { id: 'group-1', name: '11А', courseId: 'course-1', courseTitle: 'Физика' },
  { id: 'group-2', name: '10Б', courseId: null, courseTitle: null, disabled: true, disabledReason: 'Сначала назначьте курс' },
]

function renderModal(props?: Partial<React.ComponentProps<typeof StudentEnrollmentModal>>) {
  return render(
    <StudentEnrollmentModal
      open
      onClose={() => {}}
      groups={groups}
      {...props}
    />,
  )
}

describe('StudentEnrollmentModal', () => {
  beforeEach(() => {
    createStudentInvite.mockReset()
    createStudentInviteBatch.mockReset()
    buildInviteUrl.mockClear()
    buildInviteMessage.mockClear()
    toastSuccess.mockReset()
    toastError.mockReset()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:modal-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('shows required validation for single invite', async () => {
    renderModal({ defaultGroupId: 'group-1' })

    fireEvent.click(screen.getByText('Создать приглашение'))
    expect(await screen.findByText('Укажите ФИО ученика')).toBeInTheDocument()
    expect(createStudentInvite).not.toHaveBeenCalled()
  })

  it('blocks disabled group without course', async () => {
    renderModal({ defaultGroupId: null })

    fireEvent.click(screen.getByText('Одного ученика'))
    fireEvent.change(screen.getByLabelText(/Группа/i), { target: { value: 'group-2' } })
    fireEvent.change(screen.getByLabelText(/ФИО/i), { target: { value: 'Иван Петров' } })
    fireEvent.click(screen.getByText('Создать приглашение'))

    expect(await screen.findByText('Сначала назначьте курс')).toBeInTheDocument()
  })

  it('creates a single invitation and shows link/code copy actions', async () => {
    createStudentInvite.mockResolvedValue({
      inviteId: 'invite-1',
      token: 'token-1',
      shortCode: 'CODE1',
      expiresAt: '2026-08-01T12:00:00.000Z',
    })

    renderModal({ defaultGroupId: 'group-1' })
    fireEvent.change(screen.getByLabelText(/ФИО/i), { target: { value: 'Иван Петров' } })
    fireEvent.click(screen.getByText('Создать приглашение'))

    expect(await screen.findByText('Приглашение создано')).toBeInTheDocument()
    expect(screen.getByText('CODE1')).toBeInTheDocument()
    expect(screen.getByText('http://localhost:3000/join/token-1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Скопировать ссылку'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/join/token-1'))

    fireEvent.click(screen.getByText('Скопировать код'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('CODE1'))

    fireEvent.click(screen.getByText('Скопировать приглашение целиком'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('MSG:token-1:CODE1'))
  })

  it('starts batch mode with 10 rows and preserves stable client row ids when adding and deleting', async () => {
    renderModal()
    fireEvent.click(screen.getByText('Целый класс'))

    expect(screen.getAllByTestId(/batch-row-/)).toHaveLength(10)
    const firstIds = screen.getAllByTestId(/batch-row-/).map(node => node.getAttribute('data-testid'))
    fireEvent.click(screen.getByText('Добавить строку'))
    expect(screen.getAllByTestId(/batch-row-/)).toHaveLength(11)
    fireEvent.click(within(screen.getAllByTestId(/batch-row-/)[0]).getByRole('button'))
    const nextIds = screen.getAllByTestId(/batch-row-/).map(node => node.getAttribute('data-testid'))
    expect(nextIds).not.toContain(firstIds[0])
    expect(new Set(nextIds).size).toBe(nextIds.length)
  })

  it('supports TSV paste from spreadsheet into batch table', async () => {
    renderModal()
    fireEvent.click(screen.getByText('Целый класс'))

    const firstRow = screen.getAllByTestId(/batch-row-/)[0]
    const firstInput = within(firstRow).getAllByRole('textbox')[0]
    fireEvent.paste(firstInput, {
      clipboardData: {
        getData: () => 'Иван\t11А\tivan@example.com\t79990000001\nМария\t10Б\tmaria@example.com\t79990000002',
      },
    } as any)

    const rows = screen.getAllByTestId(/batch-row-/)
    expect(within(rows[0]).getAllByRole('textbox')[0]).toHaveValue('Иван')
    expect(within(rows[0]).getAllByRole('textbox')[2]).toHaveValue('ivan@example.com')
    expect(within(rows[1]).getAllByRole('textbox')[0]).toHaveValue('Мария')
    expect(within(rows[1]).getAllByRole('textbox')[3]).toHaveValue('79990000002')
  })

  it('validates duplicate and empty names before batch submit', async () => {
    renderModal()
    fireEvent.click(screen.getByText('Целый класс'))

    fireEvent.change(screen.getByLabelText(/Группа/i), { target: { value: 'group-1' } })
    const rows = screen.getAllByTestId(/batch-row-/)
    fireEvent.change(within(rows[0]).getAllByRole('textbox')[0], { target: { value: 'Иван' } })
    fireEvent.change(within(rows[1]).getAllByRole('textbox')[0], { target: { value: 'Иван' } })

    fireEvent.click(screen.getByText('Проверить строки'))
    expect(await screen.findAllByText('Дубликат ФИО')).toHaveLength(2)
  })

  it('enforces 500 filled rows limit on preview', async () => {
    renderModal()
    fireEvent.click(screen.getByText('Целый класс'))

    fireEvent.change(screen.getByLabelText(/Группа/i), { target: { value: 'group-1' } })
    const dataset = Array.from({ length: 501 }, (_, index) => `Ученик ${index + 1}`).join('\n')
    const firstInput = within(screen.getAllByTestId(/batch-row-/)[0]).getAllByRole('textbox')[0]
    fireEvent.paste(firstInput, { clipboardData: { getData: () => dataset } } as any)

    fireEvent.click(screen.getByText('Проверить строки'))
    fireEvent.click(await screen.findByText('Подтвердить импорт'))
    expect(await screen.findByText('Можно отправить не более 500 заполненных строк')).toBeInTheDocument()
  })

  it('sends correct jsonb payload for batch invite and shows per-row statuses with partial success', async () => {
    createStudentInviteBatch.mockResolvedValue({
      batchId: 'batch-1',
      items: [
        { clientRowId: '1', inviteId: 'invite-1', status: 'invite_created', token: 'token-1', shortCode: 'CODE1', expiresAt: '2026-08-01T12:00:00.000Z', error: null },
        { clientRowId: '2', inviteId: null, status: 'already_enrolled', token: null, shortCode: null, expiresAt: null, error: null },
        { clientRowId: '3', inviteId: null, status: 'invalid_data', token: null, shortCode: null, expiresAt: null, error: 'bad row' },
      ],
    })

    renderModal()
    fireEvent.click(screen.getByText('Целый класс'))
    fireEvent.change(screen.getByLabelText(/Группа/i), { target: { value: 'group-1' } })
    const rows = screen.getAllByTestId(/batch-row-/)
    ;['Иван', 'Мария', 'Ольга'].forEach((name, index) => {
      fireEvent.change(within(rows[index]).getAllByRole('textbox')[0], { target: { value: name } })
    })

    fireEvent.click(screen.getByText('Проверить строки'))
    fireEvent.click(await screen.findByText('Подтвердить импорт'))

    await waitFor(() => expect(createStudentInviteBatch).toHaveBeenCalled())
    expect(createStudentInviteBatch).toHaveBeenCalledWith({
      groupId: 'group-1',
      rows: [
        { clientRowId: '1', fullName: 'Иван', classGrade: null, email: null, phone: null },
        { clientRowId: '2', fullName: 'Мария', classGrade: null, email: null, phone: null },
        { clientRowId: '3', fullName: 'Ольга', classGrade: null, email: null, phone: null },
      ],
    })

    expect(await screen.findByText('Приглашение создано')).toBeInTheDocument()
    expect(screen.getByText('Уже зачислен')).toBeInTheDocument()
    expect(screen.getByText('bad row')).toBeInTheDocument()
    expect(screen.getByText('CODE1')).toBeInTheDocument()
  })

  it('downloads CSV with generated invite data', async () => {
    createStudentInviteBatch.mockResolvedValue({
      batchId: 'batch-csv',
      items: [
        { clientRowId: '1', inviteId: 'invite-1', status: 'invite_created', token: 'token-1', shortCode: 'CODE1', expiresAt: '2026-08-01T12:00:00.000Z', error: null },
      ],
    })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderModal()
    fireEvent.click(screen.getByText('Целый класс'))
    fireEvent.change(screen.getByLabelText(/Группа/i), { target: { value: 'group-1' } })
    const row = screen.getAllByTestId(/batch-row-/)[0]
    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: 'Иван Петров' } })

    fireEvent.click(screen.getByText('Проверить строки'))
    fireEvent.click(await screen.findByText('Подтвердить импорт'))
    await screen.findByText('Приглашение создано')

    fireEvent.click(screen.getByText('Скачать CSV'))
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })

  it('prefills group when opened from group context', async () => {
    renderModal({ defaultGroupId: 'group-1' })
    expect((screen.getByLabelText(/Группа/i) as HTMLSelectElement).value).toBe('group-1')
  })
})
