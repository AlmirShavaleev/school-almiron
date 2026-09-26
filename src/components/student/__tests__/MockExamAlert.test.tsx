/**
 * §224.2. Баннер «Идёт пробник» — одна главная кнопка на страницу пробника;
 * ближайший — тихая строка с отсчётом; прошедший — ничего.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import type { MockLessonListRow } from '@/lib/mockExamLesson'

const MIN = 60_000
function row(startOffsetMin: number, extra: Partial<MockLessonListRow> = {}): MockLessonListRow {
  const now = Date.now()
  const s = now + startOffsetMin * MIN
  return {
    id: 'ex1', title: '№1', starts_at: new Date(s).toISOString(), ends_at: new Date(s + 240 * MIN).toISOString(),
    photos_until: new Date(s + 255 * MIN).toISOString(), duration_minutes: 240,
    submitted_at: null, has_work: false, notified: false, server_now: new Date(now).toISOString(), ...extra,
  }
}

function mount(exams: MockLessonListRow[], props: Partial<Parameters<typeof MockExamAlert>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <Routes>
        <Route path="/x" element={<MockExamAlert exams={exams} groupId="g1" {...props} />} />
        <Route path="/my-course/:groupId/mock/:examId" element={<p>страница пробника</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MockExamAlert', () => {
  it('идёт: «Идёт пробник «№1» · осталось 7 мин», кнопка «Начать» ведёт на пробник', () => {
    mount([row(-233)])
    const alert = screen.getByTestId('mock-alert')
    expect(alert).toHaveAttribute('data-kind', 'open')
    expect(alert).toHaveTextContent('Идёт пробник «№1»')
    expect(screen.getByTestId('mock-alert-line')).toHaveTextContent('осталось 7 мин')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    fireEvent.click(screen.getByRole('link', { name: /Начать/ }))
    expect(screen.getByText('страница пробника')).toBeInTheDocument()
  })

  it('есть ответы — «Продолжить»; подпись курса — в строке', () => {
    mount([row(-10, { has_work: true })], { context: 'Песочница' })
    expect(screen.getByRole('link', { name: /Продолжить/ })).toBeInTheDocument()
    expect(screen.getByTestId('mock-alert-line')).toHaveTextContent('Песочница')
  })

  it('ближайший (< суток) — тихая строка с отсчётом и ссылкой «Открыть»', () => {
    mount([row(90)])
    const alert = screen.getByTestId('mock-alert')
    expect(alert).toHaveAttribute('data-kind', 'soon')
    expect(alert).toHaveTextContent('Пробник «№1»')
    expect(alert).toHaveTextContent('через 1 ч 30 мин')
    expect(screen.getByRole('link', { name: /Открыть/ })).toBeInTheDocument()
  })

  it('прошедший или через неделю — ничего', () => {
    const { container } = mount([row(-600), row(7 * 24 * 60, { id: 'ex2' })])
    expect(container).toBeEmptyDOMElement()
  })

  describe('время идёт само, без перезагрузки', () => {
    afterEach(() => { vi.useRealTimers() })
    it('в момент начала тихая строка становится баннером «Идёт»', () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(new Date('2026-09-26T06:59:30Z'))
      mount([row(0.5)])
      expect(screen.getByTestId('mock-alert')).toHaveAttribute('data-kind', 'soon')
      act(() => { vi.advanceTimersByTime(45_000) })
      expect(screen.getByTestId('mock-alert')).toHaveAttribute('data-kind', 'open')
      expect(screen.getByRole('link', { name: /Начать/ })).toBeInTheDocument()
    })
  })
})
