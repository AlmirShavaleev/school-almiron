/**
 * §230. На страницах пробника у преподавателя круглая кнопка помощи ложилась
 * на «Уведомить» в нижних строках таблицы и на липкую полосу проверки. Там она
 * компактная (44 px, 8 px от края — класс `fab-compact`), на остальных
 * страницах — прежняя. Пиксели в jsdom условны: проверяем, какая кнопка на
 * каком адресе, и что она остаётся в общем стеке (слот 0).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SupportWidget } from '@/components/shared/SupportWidget'
import { useAuthStore } from '@/store/authStore'
import { isFabCompactPath } from '@/lib/floatingStack'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ then: () => Promise.resolve({ data: [], error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }) }) },
  },
}))

function buttonAt(path: string) {
  const r = render(<MemoryRouter initialEntries={[path]}><SupportWidget /></MemoryRouter>)
  const b = screen.getByTestId('support-widget-button')
  const out = { compact: b.classList.contains('fab-compact'), big: b.classList.contains('w-14'), slot0: b.classList.contains('fab-slot-0') }
  r.unmount()
  return out
}

beforeEach(() => {
  useAuthStore.setState({ profile: { id: 'p1', role: 'teacher', full_name: 'Учитель' } as never })
})

describe('кнопка помощи на страницах пробника (§230)', () => {
  it('страница пробника, таблица, проверка работы, форма — компактная, в том же слоте стека', () => {
    for (const path of ['/mock-exams/ex1', '/mock-exams/ex1?tab=table', '/mock-exams/ex1/review/s1', '/mock-exams/new']) {
      expect(buttonAt(path)).toEqual({ compact: true, big: false, slot0: true })
    }
  })

  it('остальные страницы (и список пробников, шаблоны, пробник ученика) — прежняя кнопка', () => {
    for (const path of ['/mock-exams', '/mock-exams/templates', '/students', '/homework-queue', '/my-course/g1/mock/ex1', '/my-mock-exams']) {
      expect(buttonAt(path)).toEqual({ compact: false, big: true, slot0: true })
    }
  })

  it('isFabCompactPath — только адреса пробника у преподавателя', () => {
    expect(isFabCompactPath('/mock-exams/abc')).toBe(true)
    expect(isFabCompactPath('/mock-exams/abc/review/s')).toBe(true)
    expect(isFabCompactPath('/mock-exams')).toBe(false)
    expect(isFabCompactPath('/mock-exams/')).toBe(false)
    expect(isFabCompactPath('/mock-exams/templates')).toBe(false)
    expect(isFabCompactPath('/my-mock-exams')).toBe(false)
  })
})
