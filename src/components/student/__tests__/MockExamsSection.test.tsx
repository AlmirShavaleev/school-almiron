/**
 * §224. Раздел «Пробники» у ученика: над разделами курса, идёт → ближайшие →
 * прошедшие, одна главная кнопка, итог — только когда база его отдала.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MockExamsSection } from '@/components/student/MockExamsSection'
import type { MockLessonListRow } from '@/lib/mockExamLesson'

const min = 60_000
const NOW = Date.now()
const iso = (offMin: number) => new Date(NOW + offMin * min).toISOString()
const row = (id: string, title: string, startOff: number, extra: Partial<MockLessonListRow> = {}): MockLessonListRow => ({
  id, title,
  starts_at: iso(startOff), ends_at: iso(startOff + 240), photos_until: iso(startOff + 255),
  duration_minutes: 240, submitted_at: null, has_work: false, notified: false,
  server_now: new Date(NOW).toISOString(), ...extra,
})

describe('MockExamsSection', () => {
  it('нет пробников — раздела нет вовсе', () => {
    const { container } = render(<MockExamsSection exams={[]} onOpen={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('идёт → ближайший (отсчёт, если меньше суток) → дальний → прошедшие; главная кнопка одна — «Начать»', () => {
    const onOpen = vi.fn()
    render(<MockExamsSection onOpen={onOpen} exams={[
      row('past-res', 'Пробник №1', -30 * 24 * 60, { notified: true, has_work: true, score: 72, max_score: 100 }),
      row('far', 'Пробник №5', 6 * 24 * 60),
      row('run', 'Пробник №3', -47),
      row('past-wait', 'Пробник №2', -7 * 24 * 60, { has_work: true }),
      row('near', 'Пробник №4', 180),
    ]} />)
    const rows = screen.getAllByTestId('mock-section-row')
    expect(rows.map(r => r.getAttribute('data-status'))).toEqual(['open', 'upcoming', 'upcoming', 'checking', 'result'])
    expect(rows[0]).toHaveTextContent(/Пробник №3.*идёт.*осталось 3 ч 13 мин · до \d\d:\d\d/)
    expect(within(rows[1]).getByTestId('mock-section-line')).toHaveTextContent(/, \d\d:\d\d · 4 ч · через 3 ч$/)
    expect(within(rows[2]).getByTestId('mock-section-line')).not.toHaveTextContent('через')
    expect(rows[3]).toHaveTextContent('ждёт проверки')
    expect(rows[4]).toHaveTextContent(/итог.*72 из 100/)

    const primary = screen.getAllByTestId('mock-section-primary')
    expect(primary).toHaveLength(1)
    expect(primary[0]).toHaveTextContent('Начать')
    fireEvent.click(primary[0])
    expect(onOpen).toHaveBeenCalledWith('run')
  })

  it('начатый — «Продолжить»; сданный в окне догрузки — тихая ссылка «Догрузить фото», без главной кнопки', () => {
    const { unmount } = render(<MockExamsSection onOpen={() => {}} exams={[row('run', 'П', -47, { has_work: true })]} />)
    expect(screen.getByTestId('mock-section-primary')).toHaveTextContent('Продолжить')
    unmount()
    render(<MockExamsSection onOpen={() => {}} exams={[row('g', 'П', -245, { submitted_at: iso(-60), has_work: true })]} />)
    expect(screen.queryByTestId('mock-section-primary')).toBeNull()
    expect(screen.getByTestId('mock-section-open')).toHaveTextContent('Догрузить фото')
  })

  it('отправленный, но окно не закрылось — итога нет (база отдаёт notified только после конца)', () => {
    render(<MockExamsSection onOpen={() => {}} exams={[row('p', 'П', -300, { has_work: true, notified: false, score: null })]} />)
    expect(screen.getByTestId('mock-section-row')).toHaveAttribute('data-status', 'checking')
    expect(screen.getByTestId('mock-section-row')).not.toHaveTextContent('итог')
  })
})
