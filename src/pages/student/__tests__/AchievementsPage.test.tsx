import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useToastStore } from '@/store/toastStore'
import { useAchievementsBadge } from '@/store/achievementsStore'
import { syncResponse } from '@/test/achievementsFixture'

/**
 * §257. Страница «Достижения» — настоящие хуки (`useAchievements`,
 * `useSchoolPoints`), подменён только вызов базы `supabase.rpc`.
 */
const state = {
  sync: null as unknown,
  syncError: null as string | null,
  points: null as unknown,
  calls: [] as string[],
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string) => {
      state.calls.push(fn)
      if (fn === 'student_achievements_sync') {
        return Promise.resolve(state.syncError ? { data: null, error: { message: state.syncError } } : { data: state.sync, error: null })
      }
      if (fn === 'student_school_points') return Promise.resolve({ data: state.points, error: null })
      if (fn === 'mark_achievements_seen') return Promise.resolve({ data: 2, error: null })
      return Promise.resolve({ data: null, error: { message: 'нет функции' } })
    },
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', full_name: 'Shavaleev Almir' } }),
}))

import { AchievementsPage } from '@/pages/student/AchievementsPage'

const HAVE = { catalog: 23, hw: 18, ontime: 14, five: 3, mock: 1, mockscore: 80, streak: 9, daily: 4, weekly: 1, confident: 5, closed: 2, forecast: 6, tests: 2, topics: 15, redo: 1, 'special:flawless': 10 }
const POINTS = {
  total: 340,
  level: { n: 4, name: 'Упорство', from: 300, next: 450, next_name: 'Система' },
  rules: { hw_ontime: 10, hw_late: 4, grade5: 10, grade4: 6, accepted: 6, variant: 2, mock_point: 1, streak_day: 3 },
  feed: [],
}

async function renderPage() {
  const r = render(<MemoryRouter><AchievementsPage /></MemoryRouter>)
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
  return r
}

beforeEach(() => {
  state.sync = syncResponse({ have: HAVE, isNew: ['hw:10', 'streak:7'] })
  state.syncError = null
  state.points = POINTS
  state.calls = []
  useToastStore.setState({ toasts: [] })
  useAchievementsBadge.setState({ newCount: null })
})

describe('«Достижения»: уровень, счётчики, ближайшие', () => {
  it('уровень и баллы: сумма, «уровень 4 «Упорство»», «до уровня 5 «Система» — 110 баллов»; 4 счётчика', async () => {
    await renderPage()
    const lv = await screen.findByTestId('ach-level')
    expect(within(lv).getByTestId('ach-points')).toHaveTextContent('340')
    expect(lv).toHaveTextContent('баллов · уровень 4 «Упорство»')
    expect(within(lv).getByTestId('ach-next-level')).toHaveTextContent('до уровня 5 «Система» — 110 баллов')
    const stats = within(lv).getByTestId('ach-stats')
    expect(stats).toHaveTextContent(/наград из 79/)
    expect(stats).toHaveTextContent('23задачи каталога')
    expect(stats).toHaveTextContent('18ДЗ сдано')
    expect(stats).toHaveTextContent('9дней — рекорд серии')
  })

  it('ближайшие — 4 строки «Категория: награда», «N из M · осталось K», баллы', async () => {
    await renderPage()
    const rows = within(await screen.findByTestId('ach-near')).getAllByTestId('ach-near-row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent(/из \d+ · осталось \d+/)
  })
})

describe('«Достижения»: лестницы и фильтр', () => {
  it('все 16 категорий; полученные / текущая / серые; «23 из 50» у текущей каталога', async () => {
    await renderPage()
    const ladders = screen.getAllByTestId('ach-ladder')
    expect(ladders).toHaveLength(16)
    const cat = ladders.find(l => l.dataset.category === 'catalog')!
    expect(within(cat).getByText('4 из 9')).toBeInTheDocument()
    const cur = cat.querySelector('[data-state=current]') as HTMLElement
    expect(cur.dataset.key).toBe('catalog:50')
    expect(cur).toHaveTextContent('23 из 50')
    expect(cat.querySelectorAll('[data-state=earned]')).toHaveLength(4)
    expect(cat.querySelectorAll('[data-state=locked]')).toHaveLength(4)
  })

  it('фильтр «Полученные», «Ближайшие», одна категория; выбранная кнопка — aria-pressed', async () => {
    await renderPage()
    const filter = screen.getByTestId('ach-filter')
    fireEvent.click(within(filter).getByRole('button', { name: 'Полученные' }))
    expect(within(filter).getByRole('button', { name: 'Полученные' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('ach-tile').every(t => t.dataset.state === 'earned')).toBe(true)
    fireEvent.click(within(filter).getByRole('button', { name: 'Ближайшие' }))
    const near = screen.getAllByTestId('ach-tile')
    expect(near.every(t => t.dataset.state === 'current')).toBe(true)
    expect(near).toHaveLength(15) // по одной в каждой лестнице; у «Особых» текущей нет
    fireEvent.click(within(filter).getByRole('button', { name: 'Серия дней с решением' }))
    expect(screen.getAllByTestId('ach-ladder').map(l => l.dataset.category)).toEqual(['streak'])
    fireEvent.click(within(filter).getByRole('button', { name: 'Все' }))
    expect(screen.getAllByTestId('ach-ladder')).toHaveLength(16)
  })

  it('подсказка «как получить» — при фокусе с клавиатуры (и наведении)', async () => {
    await renderPage()
    const tile = document.querySelector('[data-key="catalog:50"]') as HTMLElement
    fireEvent.focus(tile)
    expect(screen.getByTestId('home-tip')).toHaveTextContent('Решите верно 50 задач каталога с проверкой ответа · +25 баллов школы · пока 23 из 50')
    fireEvent.blur(tile)
    expect(screen.queryByTestId('home-tip')).toBeNull()
    fireEvent.mouseEnter(document.querySelector('[data-key="special:goal"]') as HTMLElement)
    expect(screen.getByTestId('home-tip')).toHaveTextContent('без баллов школы')
  })

  it('легенда уровней — баллы из ответа; «Подробная статистика» — аналитика, журнал, все ДЗ', async () => {
    await renderPage()
    expect(screen.getByTestId('ach-legend')).toHaveTextContent('бронза +10серебро +25золото +50легенда +100')
    const det = screen.getByTestId('ach-details')
    expect(det.tagName).toBe('DETAILS')
    const links = within(det).getAllByRole('link').map(a => a.getAttribute('href'))
    expect(links).toEqual(['/student/variants/stats', '/my-journal', '/my-homework'])
  })
})

describe('«Достижения»: новые награды', () => {
  it('новые помечены «новая», страница отмечает их просмотренными — счётчик в меню 0', async () => {
    await renderPage()
    expect(document.querySelector('[data-key="hw:10"]')).toHaveAttribute('data-new')
    expect(document.querySelector('[data-key="hw:1"]')).not.toHaveAttribute('data-new')
    expect(state.calls).toContain('mark_achievements_seen')
    expect(useAchievementsBadge.getState().newCount).toBe(0)
  })

  it('новых нет — mark_achievements_seen не зовётся', async () => {
    state.sync = syncResponse({ have: HAVE })
    await renderPage()
    expect(state.calls).not.toContain('mark_achievements_seen')
    expect(useAchievementsBadge.getState().newCount).toBe(0)
  })

  it('свежая награда (вставлена этим вызовом) — тост «Новая награда: 20 ДЗ · +25» один раз и перечитанные баллы', async () => {
    state.sync = syncResponse({ have: { ...HAVE, hw: 20 }, fresh: ['hw:20'], isNew: ['hw:20'] })
    await renderPage()
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['Новая награда: 20 ДЗ · +25'])
    expect(state.calls.filter(c => c === 'student_school_points')).toHaveLength(2)
  })

  it('sync не удался (функции ещё нет) — «Не удалось загрузить награды. Повторить», страница живёт', async () => {
    state.syncError = 'Could not find the function public.student_achievements_sync'
    await renderPage()
    expect(screen.getByTestId('ach-near')).toHaveTextContent('Не удалось загрузить награды.')
    expect(screen.getByTestId('ach-points')).toHaveTextContent('340')
    expect(screen.getByTestId('ach-details')).toBeInTheDocument()
  })
})
