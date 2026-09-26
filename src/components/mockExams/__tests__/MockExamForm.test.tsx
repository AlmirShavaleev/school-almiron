/**
 * §228. Форма «Новый пробник» — одна вместо модалки §218 и настройки §221.
 *
 * Сюда перенесены проверки удалённых `CreateMockExamModal.test` (§219,
 * created_by) и `MockExamSetupPage.test` (§221 ключ из Excel, §224 окно по
 * Москве без полей раздела, §224.2 предупреждения о напоминаниях) — по
 * поведению, на новой форме. Плюс новое: несколько групп → несколько
 * пробников, файлы в папку каждого, черновик без времени, смена группы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const TEMPLATE = { id: 't1', title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4], part1_last: 12, score_scale: null }
const GROUPS = [
  { id: 'g1', name: '11А профиль', course_id: 'c1', is_active: true, group_students: [{ count: 16 }] },
  { id: 'g2', name: '11Б профиль', course_id: 'c1', is_active: true, group_students: [{ count: 14 }] },
  { id: 'g3', name: 'Архив', course_id: 'c1', is_active: false, group_students: [{ count: 3 }] },
]
let profile: { id: string; role: string }
let teacherRow: { id: string } | null
let inserted: Record<string, unknown>[][]
let updates: { row: Record<string, unknown>; id: string }[]
let uploads: string[]
let copies: [string, string][]
let rpcCalls: { fn: string; args: Record<string, unknown> }[]
let editExam: Record<string, unknown>
let workRows: Record<string, unknown[]>

function chain(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: unknown = null
  let eqId = ''
  const result = () => {
    if (op === 'insert') {
      const rows = payload as Record<string, unknown>[]
      inserted.push(rows)
      return { data: rows.map((r, i) => ({ id: `new-${i + 1}`, group_id: r.group_id })), error: null }
    }
    if (op === 'update') { updates.push({ row: payload as Record<string, unknown>, id: eqId }); return { data: null, error: null } }
    if (table === 'mock_exam_templates') return { data: [TEMPLATE], error: null }
    if (table === 'groups') return { data: GROUPS, error: null }
    if (table in workRows) return { data: workRows[table], error: null }
    return { data: [], error: null }
  }
  const single = () => {
    if (table === 'teachers') return { data: teacherRow, error: null }
    if (table === 'mock_exams') return { data: editExam, error: null }
    if (table === 'mock_exam_answer_keys') return { data: null, error: null }
    return { data: null, error: null }
  }
  const c: Record<string, unknown> = {
    select: () => c, order: () => c, in: () => c,
    eq: (_col: string, v: string) => { eqId = v; return c },
    insert: (rows: unknown) => { op = 'insert'; payload = rows; return c },
    update: (row: unknown) => { op = 'update'; payload = row; return c },
    maybeSingle: () => Promise.resolve(single()),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  }
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: { not_checkable: [12], grade: { changed_cells: 7, graded_students: 3 } }, error: null })
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: () => Promise.resolve({ data: null, error: { message: 'нет' } }),
        upload: (path: string) => { uploads.push(path); return Promise.resolve({ error: null }) },
        copy: (from: string, to: string) => { copies.push([from, to]); return Promise.resolve({ data: {}, error: null }) },
        remove: () => Promise.resolve({ error: null }),
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://x/y' }, error: null }),
      }),
    },
  },
}))
vi.mock('@/store/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile }) }))
vi.mock('@/hooks/useMyTeachingScope', () => ({ useMyTeachingScope: () => ({ active: false, loading: false, courseIds: [], groupIds: [], teacherId: null, ownStudentId: null, readOnly: false }) }))

import { MockExamForm } from '@/components/mockExams/MockExamForm'

const seen: { at: { path: string; state: unknown } | null } = { at: null }
function Landing() {
  const loc = useLocation()
  seen.at = { path: loc.pathname, state: loc.state }
  return <div data-testid="landed">{loc.pathname}</div>
}

function mountCreate(defaultGroupId: string | null = null) {
  return render(
    <MemoryRouter initialEntries={['/mock-exams/new']}>
      <Routes>
        <Route path="/mock-exams/new" element={<MockExamForm mode={{ kind: 'create', defaultGroupId }} />} />
        <Route path="/mock-exams/:id" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  )
}
function mountEdit(onSaved = vi.fn()) {
  return render(<MemoryRouter><MockExamForm mode={{ kind: 'edit', examId: 'ex1', onSaved }} /></MemoryRouter>)
}

/** «Сейчас + минуты» по Москве — для полей «Дата» и «Начало». */
const msk = (offsetMin: number) => {
  const v = new Date(Date.now() + offsetMin * 60_000 + 3 * 3600_000).toISOString()
  return { date: v.slice(0, 10), time: v.slice(11, 16) }
}
function setWhen(when: { date: string; time: string }) {
  fireEvent.change(screen.getByTestId('mock-form-date'), { target: { value: when.date } })
  fireEvent.change(screen.getByTestId('mock-form-time'), { target: { value: when.time } })
}
const chip = (name: string) => screen.getAllByTestId('mock-form-group-chip').find(c => c.textContent?.includes(name))!

beforeEach(() => {
  cleanup()
  profile = { id: 'p-owner', role: 'admin' }
  teacherRow = { id: 't-owner' }
  inserted = []; updates = []; uploads = []; copies = []; rpcCalls = []; seen.at = null
  workRows = {}
  editExam = {
    id: 'ex1', title: 'Пробник №3', date: '2026-10-18', group_id: 'g1', template_id: 't1', module_id: 'm1', module_position: 2,
    starts_at: '2026-10-18T07:00:00.000Z', duration_minutes: 240, photo_grace_minutes: 15, condition_path: null, solution_path: null,
    groups: { name: '11А профиль', course_id: 'c1' }, mock_exam_templates: TEMPLATE,
  }
})

describe('создание: несколько групп → по пробнику на группу', () => {
  it('две группы — одна вставка двух строк с общими названием, шаблоном, временем; файлы — в папку КАЖДОГО; ключ — каждому', async () => {
    mountCreate()
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'Пробник №4' } })
    // Неактивной группы в чипах нет; число учеников — рядом с именем.
    expect(screen.getAllByTestId('mock-form-group-chip').map(c => c.textContent)).toEqual(['11А профиль16', '11Б профиль14'])
    fireEvent.click(chip('11А'))
    fireEvent.click(chip('11Б'))
    setWhen({ date: '2027-03-06', time: '10:00' })
    const pdf = new File(['%PDF'], 'variant_4.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('mock-form-file-input-condition'), { target: { files: [pdf] } })
    const keys = screen.getAllByTestId('mock-form-key-input')
    fireEvent.paste(keys[0], { clipboardData: { getData: () => '12\t0,75\t-3\n' } })
    expect(screen.getByTestId('mock-form-timeline')).toHaveTextContent('09:00')
    expect(screen.getByRole('heading', { name: 'Как увидят ученики 11А профиль и 11Б профиль' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(seen.at?.path).toBe('/mock-exams/new-1'))

    expect(inserted).toHaveLength(1)
    const rows = inserted[0]
    expect(rows.map(r => r.group_id)).toEqual(['g1', 'g2'])
    for (const r of rows) {
      expect(r).toMatchObject({ title: 'Пробник №4', template_id: 't1', starts_at: '2027-03-06T07:00:00.000Z', date: '2027-03-06T07:00:00.000Z', duration_minutes: 235, subject: 'math', exam_type: 'ege', max_score: 32 })
      expect(r).not.toHaveProperty('module_id')
    }
    // Условие: загрузка в папку первого, копия в папку второго; путь привязан каждому.
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatch(/^new-1\/condition\/\d+_variant_4\.pdf$/)
    expect(copies).toHaveLength(1)
    expect(copies[0][0]).toBe(uploads[0])
    expect(copies[0][1]).toMatch(/^new-2\/condition\//)
    expect(updates.map(u => [u.id, Object.keys(u.row)[0]])).toEqual([['new-1', 'condition_path'], ['new-2', 'condition_path']])
    const keyCalls = rpcCalls.filter(c => c.fn === 'save_mock_exam_key')
    expect(keyCalls.map(c => c.args.p_mock_exam_id)).toEqual(['new-1', 'new-2'])
    expect((keyCalls[0].args.p_answers as string[]).slice(0, 4)).toEqual(['12', '0,75', '-3', ''])
    expect((keyCalls[0].args.p_answers as string[])).toHaveLength(12)
    expect((seen.at?.state as { created: { groupName: string }[] }).created.map(c => c.groupName)).toEqual(['11А профиль', '11Б профиль'])
  })

  it('«Сохранить черновиком» — без времени начала (ученики не видят); задуманный момент — в date', async () => {
    mountCreate('g2')
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'Черновик' } })
    // Группа из ?group= уже отмечена.
    expect(chip('11Б')).toHaveAttribute('aria-pressed', 'true')
    setWhen({ date: '2027-03-06', time: '11:30' })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-draft')) })
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0][0]).toMatchObject({ group_id: 'g2', starts_at: null, date: '2027-03-06T08:30:00.000Z' })
    // Ключ пустой — не сохраняется вовсе.
    expect(rpcCalls.some(c => c.fn === 'save_mock_exam_key')).toBe(false)
  })

  it('«Назначить» без группы и времени — не создаёт ничего и говорит что не так', async () => {
    mountCreate()
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'П' } })
    fireEvent.change(screen.getByTestId('mock-form-time'), { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Выберите группу')
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Нужны дата и время начала')
    expect(inserted).toHaveLength(0)
  })

  it('«своё» — длительность минутами', async () => {
    mountCreate('g1')
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'П' } })
    fireEvent.click(screen.getAllByTestId('mock-form-duration-chip')[2])
    fireEvent.change(screen.getByTestId('mock-form-duration'), { target: { value: '180' } })
    setWhen({ date: '2027-03-06', time: '10:00' })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0][0].duration_minutes).toBe(180)
    expect(screen.queryByTestId('mock-form-status')).toBeNull()
  })
})

describe('§219: created_by — строка teachers по профилю при любой роли', () => {
  async function createOne() {
    mountCreate('g1')
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'Пробник №4' } })
    setWhen({ date: '2027-03-06', time: '10:00' })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(inserted).toHaveLength(1))
  }
  it('владелец с ролью admin и строкой teachers — его teachers.id', async () => {
    await createOne()
    expect(inserted[0][0].created_by).toBe('t-owner')
  })
  it('преподаватель — его teachers.id', async () => {
    profile = { id: 'p-t', role: 'teacher' }
    await createOne()
    expect(inserted[0][0].created_by).toBe('t-owner')
  })
  it('строки teachers нет (чистый админ) — null, а не ошибка', async () => {
    teacherRow = null
    await createOne()
    expect(inserted[0][0].created_by).toBeNull()
  })
})

describe('§221: ключ первой части из Excel', () => {
  it('строкой — с того поля, куда вставили; лишнее сверх 12 отброшено', async () => {
    mountCreate()
    const inputs = await screen.findAllByTestId('mock-form-key-input')
    expect(inputs).toHaveLength(12)
    fireEvent.paste(inputs[0], { clipboardData: { getData: () => '12\t0,75\t-3\t49\t0,2\t6\t27\t5\t3\t144\t0,25\tчетыре\t99\n' } })
    expect((inputs[1] as HTMLInputElement).value).toBe('0,75')
    expect((inputs[11] as HTMLInputElement).value).toBe('четыре')
    expect(screen.getByTestId('mock-form-key-status')).toHaveTextContent('лишние 1 значение отброшены')
  })
  it('столбцом — со второго поля', async () => {
    mountCreate()
    const inputs = await screen.findAllByTestId('mock-form-key-input')
    fireEvent.paste(inputs[1], { clipboardData: { getData: () => '7\r\n8\r\n9\r\n' } })
    expect([1, 2, 3].map(i => (inputs[i] as HTMLInputElement).value)).toEqual(['7', '8', '9'])
    expect((inputs[0] as HTMLInputElement).value).toBe('')
  })
})

describe('настройка существующего пробника (вкладка «Настройка»)', () => {
  it('§224: окно по Москве; полей раздела нет; сохранение пишет время и день, не трогает module_*', async () => {
    const onSaved = vi.fn()
    mountEdit(onSaved)
    expect(await screen.findByTestId('mock-form-date')).toHaveValue('2026-10-18')
    expect(screen.getByTestId('mock-form-time')).toHaveValue('10:00')
    expect(screen.queryByText('Место в разделе')).toBeNull()
    expect(screen.getByTestId('mock-form-group-hint')).toHaveTextContent('Появится у группы 11А профиль в меню «Пробники»')
    setWhen({ date: '2026-10-19', time: '09:30' })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0].row).toMatchObject({ starts_at: '2026-10-19T06:30:00.000Z', duration_minutes: 240, date: '2026-10-19T06:30:00.000Z' })
    expect(updates[0].row).not.toHaveProperty('module_id')
    expect(updates[0].row).not.toHaveProperty('module_position')
    expect(updates[0].row).not.toHaveProperty('group_id')
    expect(onSaved).toHaveBeenCalled()
  })

  it('§221: ключ правится здесь же и уходит одной функцией вместе с формой; «не поддаются» — словами', async () => {
    mountEdit()
    const inputs = await screen.findAllByTestId('mock-form-key-input')
    fireEvent.paste(inputs[0], { clipboardData: { getData: () => '12\t0,75\t-3\t49\t0,2\t6\t27\t5\t3\t144\t0,25\tчетыре\n' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(rpcCalls.filter(c => c.fn === 'save_mock_exam_key')).toHaveLength(1))
    const call = rpcCalls.find(c => c.fn === 'save_mock_exam_key')!
    expect(call.args.p_mock_exam_id).toBe('ex1')
    expect((call.args.p_answers as string[]).slice(0, 3)).toEqual(['12', '0,75', '-3'])
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Не поддаются автопроверке: №12')
  })

  it('группу можно сменить, пока нет работ: в сохранение уходит group_id', async () => {
    mountEdit()
    await screen.findByTestId('mock-form-date')
    await waitFor(() => expect(chip('11Б')).toBeTruthy())
    const g2 = chip('11Б')
    expect(g2).not.toBeDisabled()
    fireEvent.click(g2)
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0].row.group_id).toBe('g2')
  })

  it('есть работы или баллы — другие группы недоступны, сказано почему', async () => {
    workRows = { mock_exam_sheets: [{ student_id: 's1' }] }
    mountEdit()
    await screen.findByTestId('mock-form-date')
    await waitFor(() => expect(chip('11Б')).toBeDisabled())
    expect(chip('11А')).not.toBeDisabled()
    expect(screen.getByTestId('mock-form-group-hint')).toHaveTextContent('группу не сменить')
  })

  it('черновик: «Назначить» ставит время; у назначенного до начала — «Снять с расписания»', async () => {
    editExam = { ...editExam, starts_at: null, date: '2027-03-06T08:30:00.000Z' }
    mountEdit()
    // Задуманный момент черновика — из date.
    expect(await screen.findByTestId('mock-form-time')).toHaveValue('11:30')
    expect(screen.getByTestId('mock-form-assign')).toHaveTextContent('Назначить пробник')
    expect(screen.getByTestId('mock-form-draft')).toHaveTextContent('Сохранить черновиком')
    cleanup()
    editExam = { ...editExam, starts_at: '2099-03-06T07:00:00.000Z' }
    mountEdit()
    expect(await screen.findByTestId('mock-form-assign')).toHaveTextContent('Сохранить изменения')
    fireEvent.click(screen.getByTestId('mock-form-draft'))
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0].row.starts_at).toBeNull()
  })
})

describe('§224.2: время «на сейчас» — напоминания в Telegram не уйдут', () => {
  it('новый пробник, время в прошлом: предупреждение; назначение не блокируется', async () => {
    mountCreate('g1')
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'П' } })
    expect(screen.queryByTestId('mock-form-start-warning')).toBeNull()
    setWhen(msk(-5))
    expect(screen.getByTestId('mock-form-start-warning')).toHaveTextContent('Уведомление «Пробник начался» не уйдёт — время уже наступило')
    expect(screen.getByTestId('mock-form-start-warning')).toHaveTextContent('«за час»')
    expect(within(screen.getByTestId('mock-form-timeline')).getAllByText(/не уйдёт/).length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect((seen.at?.state as { warning: string }).warning).toContain('не уйдёт')
  })

  it('правка: изменённое время в прошлом — предупреждение у поля и в статусе после сохранения', async () => {
    mountEdit()
    await screen.findByTestId('mock-form-date')
    expect(screen.queryByTestId('mock-form-start-warning')).toBeNull()
    setWhen(msk(-5))
    expect(screen.getByTestId('mock-form-start-warning')).toHaveTextContent('время уже наступило')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Сохранено. Уведомление «Пробник начался» не уйдёт')
  })

  it('«на сейчас» (через минуту) — тоже «время уже наступило»; меньше часа — только «за час»; больше — ничего', async () => {
    mountEdit()
    await screen.findByTestId('mock-form-date')
    setWhen(msk(1))
    expect(screen.getByTestId('mock-form-start-warning')).toHaveTextContent('время уже наступило')
    setWhen(msk(40))
    const w = screen.getByTestId('mock-form-start-warning')
    expect(w).toHaveTextContent('Напоминание «за час» не уйдёт')
    expect(w).not.toHaveTextContent('время уже наступило')
    setWhen(msk(180))
    expect(screen.queryByTestId('mock-form-start-warning')).toBeNull()
  })
})
