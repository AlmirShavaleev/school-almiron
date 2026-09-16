import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useVariants } from '@/hooks/useVariants'
import { VariantsHomePage } from '@/pages/variants/VariantsHomePage'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * §187. Таблица `test_variants` обслуживает две сущности: самостоятельный
 * вариант и вариант-носитель задач к уроку (§164, `topic_id` заполнен).
 * В «Тестах» нужна только первая: носителей в физике ЕГЭ сотни, они
 * закрывали собой собранный вариант, ими же завышался счётчик на карточке
 * экзамена, а корзина строки списка сносила задачи к уроку у класса.
 *
 * Проверка поведенческая: мок PostgREST честно применяет фильтры запроса,
 * поэтому хук, забывший условие, вернул бы носителя и тест бы упал. Отдельно
 * смотрим, что условие действительно ушло в запрос, — на случай, если
 * носителя однажды отфильтруют в компоненте, а сотни строк всё равно поедут
 * по сети.
 */

const OWNER_ID = 'owner-profile'

const ROWS = [
  { id: 'v-real-new',  title: 'Вариант от 11 сентября', topic_id: null,     subject: 'physics', exam_type: 'ege', status: 'ready', tasks_count: 30, created_by: OWNER_ID, settings: {}, created_at: '2026-09-11T00:00:00.000Z', updated_at: '2026-09-11T00:00:00.000Z' },
  { id: 'v-carrier',   title: 'Задачи к уроку «Кинематика»', topic_id: 't-1', subject: 'physics', exam_type: 'ege', status: 'ready', tasks_count: 7,  created_by: OWNER_ID, settings: {}, created_at: '2026-09-15T00:00:00.000Z', updated_at: '2026-09-15T00:00:00.000Z' },
  { id: 'v-real-old',  title: 'Вариант №2',            topic_id: null,     subject: 'physics', exam_type: 'ege', status: 'ready', tasks_count: 26, created_by: OWNER_ID, settings: {}, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' },
  { id: 'v-math',      title: 'Вариант по математике', topic_id: null,     subject: 'math',    exam_type: 'ege', status: 'ready', tasks_count: 19, created_by: OWNER_ID, settings: {}, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
]

type Filter = { op: string; column: string; value: unknown }

/** Что ушло в базу за прогон: по одному входу на каждый `from(...)`. */
const queries: Array<{ table: string; filters: Filter[]; deletedIds: unknown[] }> = []

/**
 * Мини-PostgREST. Фильтры применяются по-настоящему: мок, который бы их
 * игнорировал, позеленел бы и на хуке без условия.
 */
function makeChain(table: string, rows: Array<Record<string, unknown>>) {
  const filters: Filter[] = []
  const deletedIds: unknown[] = []
  const entry = { table, filters, deletedIds }
  queries.push(entry)

  let deleting = false

  const resolve = () => {
    const kept = rows.filter(row =>
      filters.every(f => {
        const v = row[f.column]
        if (f.op === 'eq')    return v === f.value
        if (f.op === 'is')    return f.value === null ? v === null : v === f.value
        if (f.op === 'ilike') return String(v ?? '').toLowerCase().includes(String(f.value).replace(/%/g, '').toLowerCase())
        return true
      })
    )
    if (deleting) {
      for (const row of kept) deletedIds.push(row.id)
      return { data: null, error: null }
    }
    return { data: kept, error: null }
  }

  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.order  = () => chain
  chain.delete = () => { deleting = true; return chain }
  chain.eq     = (column: string, value: unknown) => { filters.push({ op: 'eq',    column, value }); return chain }
  chain.is     = (column: string, value: unknown) => { filters.push({ op: 'is',    column, value }); return chain }
  chain.ilike  = (column: string, value: unknown) => { filters.push({ op: 'ilike', column, value }); return chain }
  chain.then   = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled)
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeChain(table, table === 'test_variants' ? ROWS : []),
    // Прохождений в этой проверке нет: важно только, за какие id их спросили.
    rpc: (_name: string, _body: unknown) => Promise.resolve({ data: [], error: null }),
  },
}))

function setOwner() {
  useAuthStore.setState({
    profile: {
      id: OWNER_ID,
      email: 'owner@almiron.ru',
      full_name: 'Шавалеев Альмир',
      role: 'admin',
      created_at: '2026-08-04T00:00:00.000Z',
      updated_at: '2026-08-04T00:00:00.000Z',
    },
    loading: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

function variantsQueries() {
  return queries.filter(q => q.table === 'test_variants')
}

describe('«Тесты»: в списке только самостоятельные варианты (§187)', () => {
  beforeEach(() => {
    queries.length = 0
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
    setOwner()
  })

  it('в выдачу не попадает вариант-носитель задач темы', async () => {
    const { result } = renderHook(() => useVariants({ subject: 'physics', exam_type: 'ege' }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ids = result.current.variants.map(v => v.id)
    expect(ids).toEqual(['v-real-new', 'v-real-old'])
    expect(ids).not.toContain('v-carrier')
  })

  it('условие «носитель» ушло в запрос, а не осталось фильтром в компоненте', async () => {
    const { result } = renderHook(() => useVariants())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const q = variantsQueries().at(-1)
    expect(q?.filters).toContainEqual({ op: 'is', column: 'topic_id', value: null })
  })

  it('удаление из списка не может получить id носителя: его в списке нет', async () => {
    const { result } = renderHook(() => useVariants({ subject: 'physics', exam_type: 'ege' }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Страница удаляет ровно то, что ей отдал хук. Пробуем удалить всё подряд.
    for (const v of result.current.variants) {
      await result.current.deleteVariant(v.id)
    }

    const deleted = variantsQueries().flatMap(q => q.deletedIds)
    expect(deleted).toEqual(['v-real-new', 'v-real-old'])
    expect(deleted).not.toContain('v-carrier')
  })

  it('счётчик на карточке экзамена считает то же: два теста, а не три', async () => {
    render(
      <MemoryRouter>
        <VariantsHomePage />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('Физика ЕГЭ')).toBeInTheDocument())
    // Физика ЕГЭ: два самостоятельных варианта, носитель не в счёт.
    await waitFor(() => expect(screen.getByText('2 теста')).toBeInTheDocument())
    // Математика ЕГЭ — один, чтобы «2 теста» не оказалось случайным совпадением.
    expect(screen.getByText('1 тест')).toBeInTheDocument()
  })
})
