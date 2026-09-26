/**
 * §229. «Варианты и файлы» в форме «Новый пробник» и во вкладке «Настройка»:
 * несколько вариантов, у каждого условие / решение / критерии и ключ;
 * «Кому какой вариант»; вариант без условия не назначить; дозагрузка решения
 * и критериев в любой момент; ученику, открывшему пробник, вариант не сменить.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const TEMPLATE = { id: 't1', title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4], part1_last: 12, score_scale: null }
const GROUPS = [{ id: 'g1', name: '11А профиль', course_id: 'c1', is_active: true, group_students: [{ count: 4 }] }]
const stu = (id: string, name: string) => ({ group_id: 'g1', student_id: id, students: { id, profiles: { full_name: name } } })
const ROSTER = [stu('s3', 'Гарипов Тимур'), stu('s1', 'Абрамова Дарья'), stu('s2', 'Белов Артём'), stu('s4', 'Ёлкина Мария')]

let inserted: Record<string, unknown>[][]
let insertsBy: Record<string, Record<string, unknown>[][]>
let upserts: { table: string; rows: Record<string, unknown>[] }[]
let updates: { row: Record<string, unknown>; id: string; table: string }[]
let uploads: string[]
let rpcCalls: { fn: string; args: Record<string, unknown> }[]
let tables: Record<string, unknown[]>
let editExam: Record<string, unknown>

function chain(table: string) {
  let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  let payload: unknown = null
  let eqId = ''
  const result = () => {
    if (op === 'insert') {
      const rows = payload as Record<string, unknown>[]
      if (table === 'mock_exams') { inserted.push(rows); return { data: rows.map((r, i) => ({ id: `new-${i + 1}`, group_id: r.group_id })), error: null } }
      ;(insertsBy[table] ??= []).push(rows)
      if (table === 'mock_exam_variants') return { data: rows.map(r => ({ id: `var-${r.mock_exam_id}-${r.position}`, mock_exam_id: r.mock_exam_id, position: r.position })), error: null }
      return { data: rows, error: null }
    }
    if (op === 'update') { updates.push({ row: payload as Record<string, unknown>, id: eqId, table }); return { data: null, error: null } }
    if (op === 'upsert') { upserts.push({ table, rows: payload as Record<string, unknown>[] }); return { data: null, error: null } }
    if (op === 'delete') return { data: null, error: null }
    if (table === 'mock_exam_templates') return { data: [TEMPLATE], error: null }
    if (table === 'groups') return { data: GROUPS, error: null }
    return { data: tables[table] ?? [], error: null }
  }
  const single = () => {
    if (table === 'teachers') return { data: { id: 't-owner' }, error: null }
    if (table === 'mock_exams') return { data: editExam, error: null }
    return { data: null, error: null }
  }
  const c: Record<string, unknown> = {
    select: () => c, order: () => c, in: () => c,
    eq: (_col: string, v: string) => { eqId = v; return c },
    insert: (rows: unknown) => { op = 'insert'; payload = rows; return c },
    update: (row: unknown) => { op = 'update'; payload = row; return c },
    upsert: (rows: unknown) => { op = 'upsert'; payload = rows; return c },
    delete: () => { op = 'delete'; return c },
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
      return Promise.resolve({ data: { not_checkable: [], grade: { changed_cells: 0, graded_students: 0 } }, error: null })
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: () => Promise.resolve({ data: null, error: { message: 'нет' } }),
        upload: (path: string) => { uploads.push(path); return Promise.resolve({ error: null }) },
        copy: () => Promise.resolve({ data: {}, error: null }),
        remove: () => Promise.resolve({ error: null }),
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://x/y' }, error: null }),
      }),
    },
  },
}))
vi.mock('@/store/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p-owner', role: 'admin' } }) }))
vi.mock('@/hooks/useMyTeachingScope', () => ({ useMyTeachingScope: () => ({ active: false, loading: false, courseIds: [], groupIds: [], teacherId: null, ownStudentId: null, readOnly: false }) }))

import { MockExamForm } from '@/components/mockExams/MockExamForm'

function Landing() { const l = useLocation(); return <div data-testid="landed">{l.pathname}</div> }
function mountCreate() {
  return render(
    <MemoryRouter initialEntries={['/mock-exams/new']}>
      <Routes>
        <Route path="/mock-exams/new" element={<MockExamForm mode={{ kind: 'create', defaultGroupId: 'g1' }} />} />
        <Route path="/mock-exams/:id" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  )
}
function mountEdit() {
  return render(<MemoryRouter><MockExamForm mode={{ kind: 'edit', examId: 'ex1' }} /></MemoryRouter>)
}
const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' })
const pick = (testid: string, k: number, file: File) => fireEvent.change(screen.getAllByTestId(testid)[k], { target: { files: [file] } })
const readyText = () => screen.getByTestId('mock-form-ready').textContent ?? ''
const rowOf = (sid: string) => screen.getAllByTestId('mock-form-distribution-row').find(r => r.getAttribute('data-student') === sid)!

beforeEach(() => {
  cleanup()
  inserted = []; insertsBy = {}; upserts = []; updates = []; uploads = []; rpcCalls = []
  tables = { group_students: ROSTER }
  editExam = {
    id: 'ex1', title: 'Пробник №4', date: '2099-10-18', group_id: 'g1', template_id: 't1', variant_mode: 'order',
    starts_at: '2099-10-18T07:00:00.000Z', duration_minutes: 235, photo_grace_minutes: 15, condition_path: null, solution_path: null,
    groups: { name: '11А профиль', course_id: 'c1' }, mock_exam_templates: TEMPLATE,
  }
})

describe('создание: несколько вариантов', () => {
  it('три варианта: без условия у третьего не назначить; с ним — у пробника три варианта, файлы по папкам, раздача по очереди', async () => {
    mountCreate()
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'Пробник №4' } })
    fireEvent.change(screen.getByTestId('mock-form-date'), { target: { value: '2099-03-06' } })
    fireEvent.click(within(screen.getByTestId('mock-form-variant-count')).getByRole('radio', { name: 'Несколько' }))
    expect(screen.getAllByTestId('mock-form-variant')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('mock-form-variant-add'))
    expect(screen.getAllByTestId('mock-form-variant')).toHaveLength(3)
    expect(within(screen.getByTestId('mock-form-variant-count')).getByRole('radio', { name: 'Несколько · 3' })).toHaveAttribute('aria-checked', 'true')

    pick('mock-form-file-input-condition', 0, pdf('variant_1.pdf'))
    pick('mock-form-file-input-criteria', 0, pdf('crit_1.pdf'))
    pick('mock-form-file-input-condition', 1, pdf('variant_2.pdf'))
    pick('mock-form-file-input-solution', 1, pdf('reshenie_2.pdf'))
    expect(readyText()).toContain('Вариант 3: нет условия — не назначить')
    // Раздача: по очереди по алфавиту — Абрамова 1, Белов 2, Гарипов 3, Ёлкина 1.
    await waitFor(() => expect(screen.getAllByTestId('mock-form-distribution-row')).toHaveLength(4))
    expect(screen.getAllByTestId('mock-form-distribution-row').map(r => r.getAttribute('data-student'))).toEqual(['s1', 's2', 's3', 's4'])
    expect(screen.getAllByTestId('mock-form-distribution-select').map(s => (s as HTMLSelectElement).value)).toEqual(['1', '2', '3', '1'])
    expect(screen.getByTestId('mock-form-distribution-counts')).toHaveTextContent('Вариант 1 — 2 · Вариант 2 — 1 · Вариант 3 — 1')

    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Вариант 3: нет условия')
    expect(inserted).toHaveLength(0)

    pick('mock-form-file-input-condition', 2, pdf('variant_3.pdf'))
    // Ёлкиной — вручную вариант 3: способ становится «Вручную».
    fireEvent.change(within(rowOf('s4')).getByTestId('mock-form-distribution-select'), { target: { value: '3' } })
    expect(within(screen.getByTestId('mock-form-variant-mode')).getByRole('radio', { name: 'Вручную' })).toHaveAttribute('aria-checked', 'true')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('/mock-exams/new-1'))

    expect(inserted[0][0]).toMatchObject({ group_id: 'g1', variant_mode: 'manual' })
    expect(insertsBy.mock_exam_variants).toEqual([[1, 2, 3].map(position => ({ mock_exam_id: 'new-1', position }))])
    expect(uploads.map(u => u.replace(/\/\d+_/, '/'))).toEqual([
      'new-1/v1/condition/variant_1.pdf', 'new-1/v1/criteria/crit_1.pdf',
      'new-1/v2/condition/variant_2.pdf', 'new-1/v2/solution/reshenie_2.pdf',
      'new-1/v3/condition/variant_3.pdf',
    ])
    expect(updates.filter(u => u.table === 'mock_exam_variants').map(u => [u.id, Object.keys(u.row)[0]])).toEqual([
      ['var-new-1-1', 'condition_path'], ['var-new-1-1', 'criteria_path'],
      ['var-new-1-2', 'condition_path'], ['var-new-1-2', 'solution_path'],
      ['var-new-1-3', 'condition_path'],
    ])
    const assigned = insertsBy.mock_exam_variant_students[0].map(r => [r.student_id, r.variant_id])
    expect(assigned).toEqual([['s1', 'var-new-1-1'], ['s2', 'var-new-1-2'], ['s3', 'var-new-1-3'], ['s4', 'var-new-1-3']])
  })

  it('ключ — у каждого варианта свой: пустой не сохраняется, заполненный — функцией варианта', async () => {
    mountCreate()
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'П' } })
    fireEvent.change(screen.getByTestId('mock-form-date'), { target: { value: '2099-03-06' } })
    fireEvent.click(within(screen.getByTestId('mock-form-variant-count')).getByRole('radio', { name: 'Несколько' }))
    pick('mock-form-file-input-condition', 0, pdf('a.pdf'))
    pick('mock-form-file-input-condition', 1, pdf('b.pdf'))
    // Открыт вариант 1: его ключ; у варианта 2 — сводка «Ключ: 0 из 12 · изменить».
    fireEvent.paste(screen.getAllByTestId('mock-form-key-input')[0], { clipboardData: { getData: () => '1\t2\t3\n' } })
    fireEvent.click(screen.getByTestId('mock-form-variant-key-summary'))
    fireEvent.paste(screen.getAllByTestId('mock-form-key-input')[0], { clipboardData: { getData: () => '21\t22\n' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument())
    const keys = rpcCalls.filter(c => c.fn === 'save_mock_exam_variant_key')
    expect(keys.map(c => [c.args.p_variant_id, (c.args.p_answers as string[]).slice(0, 3)])).toEqual([
      ['var-new-1-1', ['1', '2', '3']], ['var-new-1-2', ['21', '22', '']],
    ])
  })
})

describe('вкладка «Настройка»: варианты существующего пробника', () => {
  beforeEach(() => {
    tables = {
      group_students: ROSTER,
      mock_exam_variants: [
        { id: 'v1', position: 1, label: null, condition_path: 'ex1/v1/condition/1_var1.pdf', solution_path: null, criteria_path: 'ex1/v1/criteria/1_crit1.pdf' },
        { id: 'v2', position: 2, label: null, condition_path: 'ex1/v2/condition/1_var2.pdf', solution_path: null, criteria_path: null },
      ],
      mock_exam_variant_keys: [{ variant_id: 'v1', answers: Array(12).fill('1') }],
      mock_exam_variant_students: [{ student_id: 's1', variant_id: 'v1' }, { student_id: 's2', variant_id: 'v2' }, { student_id: 's3', variant_id: 'v1' }, { student_id: 's4', variant_id: 'v2' }],
      // Абрамова уже открыла пробник — её вариант не меняется.
      mock_exam_sheets: [{ student_id: 's1' }],
    }
  })

  it('«Добавить критерии» / «Заменить условие» — сразу в папку варианта, в любой момент', async () => {
    mountEdit()
    await waitFor(() => expect(screen.getAllByTestId('mock-form-variant')).toHaveLength(2))
    expect(screen.getAllByTestId('mock-form-file-action-criteria').map(a => a.textContent)).toEqual(['Заменить критерии', 'Добавить критерии'])
    expect(screen.getAllByTestId('mock-form-file-action-solution').map(a => a.textContent)).toEqual(['Добавить решение', 'Добавить решение'])
    expect(screen.getAllByTestId('mock-form-file-action-condition').map(a => a.textContent)).toEqual(['Заменить условие', 'Заменить условие'])
    await act(async () => { pick('mock-form-file-input-criteria', 1, pdf('Критерии 2.pdf')) })
    await waitFor(() => expect(updates.some(u => u.table === 'mock_exam_variants')).toBe(true))
    expect(uploads[0]).toMatch(/^ex1\/v2\/criteria\/\d+_/)
    expect(updates.find(u => u.table === 'mock_exam_variants')).toMatchObject({ id: 'v2', row: { criteria_path: uploads[0] } })
  })

  it('раздача: открывшему пробник вариант не сменить; правка другого уходит одной строкой, ключ варианта 2 — своей функцией', async () => {
    mountEdit()
    await waitFor(() => expect(screen.getAllByTestId('mock-form-distribution-row')).toHaveLength(4))
    expect(within(rowOf('s1')).getByTestId('mock-form-distribution-select')).toBeDisabled()
    expect(screen.getAllByTestId('mock-form-distribution-select').map(s => (s as HTMLSelectElement).value)).toEqual(['1', '2', '1', '2'])
    fireEvent.change(within(rowOf('s3')).getByTestId('mock-form-distribution-select'), { target: { value: '2' } })
    fireEvent.click(screen.getAllByTestId('mock-form-variant-key-summary')[0])
    fireEvent.paste(screen.getAllByTestId('mock-form-key-input')[0], { clipboardData: { getData: () => '5\t6\n' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0]).toEqual({ table: 'mock_exam_variant_students', rows: [{ mock_exam_id: 'ex1', student_id: 's3', variant_id: 'v2' }] })
    expect(updates.find(u => u.table === 'mock_exams')?.row).toMatchObject({ variant_mode: 'manual' })
    const key = rpcCalls.find(c => c.fn === 'save_mock_exam_variant_key')!
    expect(key.args.p_variant_id).toBe('v2')
    expect((key.args.p_answers as string[]).slice(0, 2)).toEqual(['5', '6'])
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Варианты выданы: 1 ученику')
  })

  it('пробник без строк вариантов (старый): живёт как раньше — условие в колонку пробника, ключ старой функцией', async () => {
    tables = { group_students: ROSTER }
    editExam = { ...editExam, condition_path: 'ex1/condition/1_old.pdf' }
    mountEdit()
    await waitFor(() => expect(screen.getAllByTestId('mock-form-variant')).toHaveLength(1))
    expect(screen.getByTestId('mock-form-file-action-condition')).toHaveTextContent('Заменить условие')
    expect(screen.queryByTestId('mock-form-distribution')).toBeNull()
    await act(async () => { pick('mock-form-file-input-solution', 0, pdf('reshenie.pdf')) })
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(uploads[0]).toMatch(/^ex1\/solution\//)
    expect(updates[0]).toMatchObject({ table: 'mock_exams', row: { solution_path: uploads[0] } })
  })
})

/**
 * §230. Подпись варианта («Вариант А», «Резерв»): поле на жёлтой метке
 * карточки варианта. В форме создания уходит вместе с вариантами; у
 * существующего пробника пишется сразу прямым update `mock_exam_variants`.
 * Пустое — null, на экране «Вариант N». Подпись видна там, где было «Вариант N».
 */
describe('подпись варианта (§230)', () => {
  it('создание: подписи уходят в строки вариантов (пустая — без подписи), счёт раздачи и чек-лист зовут вариант подписью', async () => {
    mountCreate()
    fireEvent.change(await screen.findByTestId('mock-form-title'), { target: { value: 'Пробник №4' } })
    fireEvent.change(screen.getByTestId('mock-form-date'), { target: { value: '2099-03-06' } })
    fireEvent.click(within(screen.getByTestId('mock-form-variant-count')).getByRole('radio', { name: 'Несколько' }))
    fireEvent.click(screen.getByTestId('mock-form-variant-add'))
    const labels = screen.getAllByTestId('mock-form-variant-label') as HTMLInputElement[]
    expect(labels).toHaveLength(3)
    expect(labels.map(l => l.placeholder)).toEqual(['Вариант 1', 'Вариант 2', 'Вариант 3'])
    expect(labels[0]).toHaveAccessibleName('Подпись варианта 1')
    expect(labels[0].maxLength).toBe(60)
    fireEvent.change(labels[0], { target: { value: 'Вариант А' } })
    fireEvent.change(labels[2], { target: { value: '  Резерв  ' } })
    pick('mock-form-file-input-condition', 0, pdf('variant_1.pdf'))
    pick('mock-form-file-input-condition', 1, pdf('variant_2.pdf'))
    expect(readyText()).toContain('Резерв: нет условия — не назначить')
    await waitFor(() => expect(screen.getByTestId('mock-form-distribution-counts')).toHaveTextContent('Вариант А (№1) — 2 · Вариант 2 — 1 · Резерв (№3) — 1'))
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    expect(screen.getByTestId('mock-form-status')).toHaveTextContent('Резерв: нет условия')
    expect(inserted).toHaveLength(0)

    pick('mock-form-file-input-condition', 2, pdf('variant_3.pdf'))
    await act(async () => { fireEvent.click(screen.getByTestId('mock-form-assign')) })
    await screen.findByTestId('landed')
    expect(insertsBy.mock_exam_variants).toEqual([[
      { mock_exam_id: 'new-1', position: 1, label: 'Вариант А' },
      { mock_exam_id: 'new-1', position: 2 },
      { mock_exam_id: 'new-1', position: 3, label: 'Резерв' },
    ]])
  })

  it('один вариант — поля подписи нет, подпись не пишется', async () => {
    mountCreate()
    await screen.findByTestId('mock-form-title')
    expect(screen.queryByTestId('mock-form-variant-label')).toBeNull()
  })

  it('«Настройка»: подпись сохраняется сразу (уход из поля) прямым update; пустая — null; Esc возвращает как было', async () => {
    tables = {
      group_students: ROSTER,
      mock_exam_variants: [
        { id: 'v1', position: 1, label: null, condition_path: 'ex1/v1/condition/1_var1.pdf', solution_path: null, criteria_path: null },
        { id: 'v2', position: 2, label: null, condition_path: 'ex1/v2/condition/1_var2.pdf', solution_path: null, criteria_path: null },
      ],
      mock_exam_variant_students: [{ student_id: 's1', variant_id: 'v1' }, { student_id: 's2', variant_id: 'v2' }, { student_id: 's3', variant_id: 'v1' }, { student_id: 's4', variant_id: 'v2' }],
    }
    mountEdit()
    await waitFor(() => expect(screen.getAllByTestId('mock-form-variant-label')).toHaveLength(2))
    const second = () => screen.getAllByTestId('mock-form-variant-label')[1] as HTMLInputElement
    fireEvent.change(second(), { target: { value: 'Резерв' } })
    await act(async () => { fireEvent.blur(second()) })
    await waitFor(() => expect(screen.getByTestId('mock-form-variant-label-status')).toHaveTextContent('сохранено'))
    expect(updates.filter(u => u.table === 'mock_exam_variants')).toEqual([{ table: 'mock_exam_variants', id: 'v2', row: { label: 'Резерв' } }])
    // Подпись сразу там, где было «Вариант 2»: в счёте раздачи.
    expect(screen.getByTestId('mock-form-distribution-counts')).toHaveTextContent('Резерв (№2) — 2')
    expect(second().value).toBe('Резерв')

    // Esc — вернуть как было, в базу ничего.
    fireEvent.change(second(), { target: { value: 'Черновик подписи' } })
    fireEvent.keyDown(second(), { key: 'Escape' })
    expect(second().value).toBe('Резерв')
    await act(async () => { fireEvent.blur(second()) })
    expect(updates.filter(u => u.table === 'mock_exam_variants')).toHaveLength(1)

    // Стёрли — null, снова «Вариант 2».
    fireEvent.change(second(), { target: { value: '   ' } })
    await act(async () => { fireEvent.keyDown(second(), { key: 'Enter' }); fireEvent.blur(second()) })
    await waitFor(() => expect(updates.filter(u => u.table === 'mock_exam_variants')).toHaveLength(2))
    expect(updates.filter(u => u.table === 'mock_exam_variants')[1]).toEqual({ table: 'mock_exam_variants', id: 'v2', row: { label: null } })
    await waitFor(() => expect(screen.getByTestId('mock-form-distribution-counts')).toHaveTextContent('Вариант 2 — 2'))
  })
})
