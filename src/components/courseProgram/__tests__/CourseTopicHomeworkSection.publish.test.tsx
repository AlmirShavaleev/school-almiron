import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §116. После импорта курса (§101) все ДЗ лежат черновиками, и ученик не видит
 * рубрику «Домашнее задание» вовсе. Проверяем массовую публикацию: что она
 * пишет то же поле, что и кнопка в модалке темы, не трогает уже
 * опубликованное и честно отчитывается.
 */

const updateSpy = vi.fn()
const eqSpy = vi.fn()
const { toastSuccess, toastInfo, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(), toastInfo: vi.fn(), toastError: vi.fn(),
}))

const MODULES = [{
  id: 'mod-1',
  title: 'Механика',
  topics: [
    { id: 't1', title: 'Кинематика', is_open: true, available_from: null },
    { id: 't2', title: 'Динамика', is_open: true, available_from: null },
  ],
}]

const ROSTER = [{ student_id: 's1', students: { id: 's1', profiles: { full_name: 'Ученик' } } }]

let homeworks = [
  { id: 'h1', topic_id: 't1', title: 'ДЗ 1', grade_scale: 'five', is_published: false },
  { id: 'h2', topic_id: 't2', title: 'ДЗ 2', grade_scale: 'five', is_published: true },
]
let files = [{ homework_id: 'h1' }, { homework_id: 'h2' }]
let updateResult: { data: unknown; error: { message: string } | null } = { data: [{ id: 'h1' }], error: null }

function selectChain(rows: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'group_students') return selectChain(ROSTER)
      if (table === 'topic_homework_files') return selectChain(files)
      if (table === 'topic_homework_attempts') return selectChain([])
      if (table === 'topic_homework') {
        const c: any = selectChain(homeworks)
        c.update = (patch: unknown) => {
          updateSpy(patch)
          const u: any = {}
          u.in = (_col: string, ids: string[]) => { updateSpy.mock.calls.at(-1)!.push(ids); return u }
          u.eq = (col: string, value: unknown) => { eqSpy(col, value); return u }
          u.select = () => Promise.resolve(updateResult)
          return u
        }
        return c
      }
      return selectChain([])
    },
  },
}))

vi.mock('@/store/toastStore', () => ({
  toast: { success: toastSuccess, info: toastInfo, error: toastError, saved: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/components/courseProgram/TopicOpenToggle', () => ({ TopicOpenToggle: () => null }))

import { CourseTopicHomeworkSection } from '@/components/courseProgram/CourseTopicHomeworkSection'

function renderSection() {
  return render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
}

describe('Массовая публикация ДЗ (§116)', () => {
  beforeEach(() => {
    updateSpy.mockReset()
    eqSpy.mockReset()
    toastSuccess.mockReset(); toastInfo.mockReset(); toastError.mockReset()
    homeworks = [
      { id: 'h1', topic_id: 't1', title: 'ДЗ 1', grade_scale: 'five', is_published: false },
      { id: 'h2', topic_id: 't2', title: 'ДЗ 2', grade_scale: 'five', is_published: true },
    ]
    files = [{ homework_id: 'h1' }, { homework_id: 'h2' }]
    updateResult = { data: [{ id: 'h1' }], error: null }
  })

  it('показывает, сколько ДЗ ещё не выдано ученикам', async () => {
    renderSection()

    expect(await screen.findByTestId('publish-course-homework')).toBeInTheDocument()
    expect(screen.getByText(/Не опубликовано ДЗ:/)).toBeInTheDocument()
  })

  it('публикует только неопубликованное и тем же полем, что модалка темы', async () => {
    renderSection()

    fireEvent.click(await screen.findByTestId('publish-course-homework'))

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0][0]).toEqual({ is_published: true })
    // В запрос ушёл только черновик h1: уже опубликованное h2 не трогаем —
    // повторная выдача ученикам ничего не меняет (§58).
    expect(updateSpy.mock.calls[0][1]).toEqual(['h1'])
    // И страховка на гонку: между планом и записью тему могли опубликовать.
    expect(eqSpy).toHaveBeenCalledWith('is_published', false)
  })

  it('итог считает по ответу базы и называет причины пропусков', async () => {
    renderSection()

    fireEvent.click(await screen.findByTestId('publish-course-homework'))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toContain('Опубликовано ДЗ: 1')
    expect(toastSuccess.mock.calls[0][0]).toContain('уже опубликовано — 1')
  })

  it('ДЗ без файлов не публикуется и попадает в пропуски', async () => {
    files = [{ homework_id: 'h2' }] // у h1 файлов нет
    renderSection()

    fireEvent.click(await screen.findByTestId('publish-course-homework'))

    await waitFor(() => expect(toastInfo).toHaveBeenCalled())
    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastInfo.mock.calls[0][0]).toContain('нет файлов задания — 1')
  })

  it('отказ базы показывается ошибкой, а не молчанием', async () => {
    updateResult = { data: null, error: { message: 'нет прав' } }
    renderSection()

    fireEvent.click(await screen.findByTestId('publish-course-homework'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('нет прав'))
  })

  it('у модуля своя кнопка со счётчиком', async () => {
    renderSection()

    const button = await screen.findByTestId('publish-module-mod-1')
    expect(button).toHaveTextContent('Опубликовать ДЗ · 1')
  })

  it('всё опубликовано — кнопок нет вовсе', async () => {
    homeworks = homeworks.map(h => ({ ...h, is_published: true }))
    renderSection()

    await screen.findByText(/Выполнено/)
    expect(screen.queryByTestId('publish-course-homework')).not.toBeInTheDocument()
    expect(screen.queryByTestId('publish-module-mod-1')).not.toBeInTheDocument()
  })
})
