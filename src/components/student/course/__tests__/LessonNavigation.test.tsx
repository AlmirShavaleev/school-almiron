import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LessonNavigation } from '../LessonNavigation'

const st = vi.hoisted(() => ({ modules: [] as unknown[], error: null as unknown, calls: [] as string[] }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  st.calls.push(table)
  return { select: () => ({ eq: () => Promise.resolve({ data: st.modules, error: st.error }) }) }
} } }))
const topic = (id: string, order: number, extra = {}) => ({ id, title: id, order_index: order, kind: 'lesson', is_open: true, available_from: null, ...extra })
function Location() { return <div data-testid="location">{useLocation().pathname}</div> }
function renderNav(id = 't2', locks: Parameters<typeof LessonNavigation>[0]['locks'] = null) {
  return render(<MemoryRouter initialEntries={[`/my-course/g1/topic/${id}`]}><Routes>
    <Route path="/my-course/:groupId/topic/:topicId" element={<><LessonNavigation groupId="g1" courseId="c1" topicId={id} locks={locks} /><Location /></>} />
  </Routes></MemoryRouter>)
}
beforeEach(() => {
  st.error = null; st.calls = []
  st.modules = [
    { id: 'm2', order_index: 2, topics: [topic('t3', 1)] },
    { id: 'm1', order_index: 1, topics: [topic('t2', 2), topic('work', 3, { kind: 'control' }), topic('t1', 1)] },
  ]
})
describe('переходы между уроками', () => {
  it('сортирует уроки по программе, переходит через границу раздела и пропускает работы', async () => {
    renderNav()
    expect(await screen.findByRole('link', { name: 'Предыдущий урок: t1' })).toHaveAttribute('href', '/my-course/g1/topic/t1')
    const next = await screen.findByRole('link', { name: 'Следующий урок: t3' })
    fireEvent.click(next)
    expect(screen.getByTestId('location')).toHaveTextContent('/my-course/g1/topic/t3')
    expect(st.calls).toEqual(['modules'])
  })
  it('на первом и последнем уроке отсутствующий переход выключен', async () => {
    const first = renderNav('t1')
    await screen.findByRole('link', { name: 'Следующий урок: t2' })
    expect(screen.getByRole('button', { name: /Предыдущий урок/ })).toBeDisabled()
    first.unmount()
    renderNav('t3')
    await screen.findByRole('link', { name: 'Предыдущий урок: t2' })
    expect(screen.getByRole('button', { name: /Следующий урок/ })).toBeDisabled()
  })
  it('не даёт перейти в закрытый по дате урок', async () => {
    st.modules = [{ id: 'm1', order_index: 1, topics: [topic('t1', 1), topic('t2', 2, { is_open: null, available_from: '2099-01-01' })] }]
    renderNav('t1')
    expect(await screen.findByRole('button', { name: /Следующий урок.*t2/ })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /Следующий урок/ })).not.toBeInTheDocument()
  })
  it('использует уже загруженный замок прохождения вместо ручной даты', async () => {
    renderNav('t1', { mode: 'progress', topics: [{ topic_id: 't2', title: 't2', open: false, reason: null, closed: false, percent: null, after_topic_id: 't1', after_title: 't1', opens_on: null }] })
    expect(await screen.findByRole('button', { name: /Следующий урок.*t2/ })).toBeDisabled()
  })
  it('при ошибке навигации не предлагает ложные ссылки', async () => {
    st.error = { message: 'unavailable' }
    renderNav()
    expect(screen.getByRole('navigation', { name: 'Навигация по урокам' })).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
