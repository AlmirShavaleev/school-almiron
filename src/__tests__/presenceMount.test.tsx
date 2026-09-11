import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Публикатор присутствия смонтирован на ВСЁ защищённое поддерево.
 *
 * Это не стилистика размещения, а условие работоспособности блока «кто сейчас
 * в школе»: читает список только админ, но ОТМЕТИТЬСЯ должны все вошедшие.
 * Смонтированный на экране панели, публикатор показывал бы одних админов — то
 * есть отвечал бы не на тот вопрос, ради которого панель открывают.
 *
 * Поэтому проверка именно поведенческая и именно под УЧЕНИКОМ: тест на
 * «компонент присутствует в дереве» такую регрессию не заметил бы.
 */

const acquire = vi.fn((_profileId: string, _role: string) => vi.fn())

vi.mock('@/lib/schoolPresence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/schoolPresence')>('@/lib/schoolPresence')
  return { ...actual, acquirePresence: (id: string, role: string) => acquire(id, role) }
})

let profile: { id: string; role: string } | null = null

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector({ profile }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: [], error: null })
          return p.then.bind(p)
        }
        return () => new Proxy({}, { get: () => () => undefined })
      },
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

// Оболочка кабинета — чужая зона и к присутствию отношения не имеет.
vi.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: () => <div>layout-stub</div>,
}))

import AppRoutes from '@/AppRoutes'

function draw(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
}

beforeEach(() => {
  acquire.mockClear()
  profile = null
})

describe('публикация присутствия на всём приложении', () => {
  it('ученик отмечается в канале, а не только админ', async () => {
    profile = { id: 'p-student', role: 'student' }
    draw('/my-courses')

    // Ровно то, ради чего публикатор поднят из панели наверх.
    await waitFor(() => expect(acquire).toHaveBeenCalledWith('p-student', 'student'))
  })

  it('преподаватель тоже отмечается', async () => {
    profile = { id: 'p-teacher', role: 'teacher' }
    draw('/inbox')
    await waitFor(() => expect(acquire).toHaveBeenCalledWith('p-teacher', 'teacher'))
  })

  it('отметка не зависит от того, какая страница открыта', async () => {
    // Публикатор стоит ВЫШЕ <Suspense>: не догрузившаяся ленивая страница не
    // должна задерживать присутствие, а отказ канала — страницу.
    profile = { id: 'p-1', role: 'student' }
    draw('/этого-адреса-нет')
    await waitFor(() => expect(acquire).toHaveBeenCalledWith('p-1', 'student'))
  })

  it('гость ничего не публикует', async () => {
    profile = null
    draw('/dashboard')

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(acquire).not.toHaveBeenCalled()
  })

  it('отмечается ровно один раз, а не по разу на страницу', async () => {
    profile = { id: 'p-1', role: 'student' }
    draw('/dashboard')

    await waitFor(() => expect(acquire).toHaveBeenCalled())
    // Второй захват означал бы второй сокет у каждого ученика школы.
    expect(acquire).toHaveBeenCalledTimes(1)
  })
})
