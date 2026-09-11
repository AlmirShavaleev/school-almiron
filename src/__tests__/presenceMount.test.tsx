import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Отметка присутствия ставится на ВСЁ защищённое поддерево.
 *
 * Это не стилистика размещения, а условие работоспособности блока «кто сейчас
 * в школе»: список читает только админ, но ОТМЕТИТЬСЯ должны все вошедшие.
 * Смонтированная на экране панели, отметка показывала бы одних админов — то
 * есть отвечала бы не на тот вопрос, ради которого панель открывают.
 *
 * Поэтому проверка именно поведенческая и именно под УЧЕНИКОМ: тест на
 * «компонент присутствует в дереве» такую регрессию не заметил бы.
 */

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: [], error: null })
          return p.then.bind(p)
        }
        return () => new Proxy({}, { get: () => () => undefined })
      },
    }),
  },
}))

let profile: { id: string; role: string } | null = null

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector({ profile }),
}))

// Оболочка кабинета — чужая зона и к присутствию отношения не имеет.
vi.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: () => <div>layout-stub</div>,
}))

import AppRoutes from '@/AppRoutes'

function draw(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
}

const touches = () => rpc.mock.calls.filter(c => c[0] === 'school_presence_touch')

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null })
  profile = null
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})

describe('отметка присутствия на всём приложении', () => {
  it('ученик отмечается, а не только админ', async () => {
    profile = { id: 'p-student', role: 'student' }
    draw('/my-courses')

    // Ровно то, ради чего отметка поднята из панели наверх.
    await waitFor(() => expect(touches()).toHaveLength(1))
  })

  it('преподаватель тоже отмечается', async () => {
    profile = { id: 'p-teacher', role: 'teacher' }
    draw('/inbox')
    await waitFor(() => expect(touches()).toHaveLength(1))
  })

  it('отметка не зависит от того, какая страница открыта', async () => {
    // Публикатор стоит ВЫШЕ <Suspense>: не догрузившаяся ленивая страница не
    // должна задерживать отметку присутствия, а отказ отметки — страницу.
    profile = { id: 'p-1', role: 'student' }
    draw('/этого-адреса-нет')
    await waitFor(() => expect(touches()).toHaveLength(1))
  })

  it('гость ничего не отмечает', async () => {
    profile = null
    draw('/dashboard')

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(touches()).toHaveLength(0)
  })

  it('отмечается ровно один раз на открытие, а не по разу на страницу', async () => {
    profile = { id: 'p-1', role: 'student' }
    draw('/dashboard')

    await waitFor(() => expect(touches()).toHaveLength(1))
    // Второй публикатор означал бы вдвое больше записей от каждого ученика.
    expect(touches()).toHaveLength(1)
  })

  it('роль в отметку не передаётся — её ставит база из профиля', async () => {
    profile = { id: 'p-1', role: 'student' }
    draw('/dashboard')

    await waitFor(() => expect(touches()).toHaveLength(1))
    // Иначе клиент мог бы назваться кем угодно, и список онлайн врал бы ролями.
    expect(touches()[0]).toEqual(['school_presence_touch'])
  })
})
