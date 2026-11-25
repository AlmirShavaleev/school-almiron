import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useCatalogTopicTasks } from '@/hooks/useCatalog'

const mocks = vi.hoisted(() => ({ from: vi.fn(), texts: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ profile: { id: 'student-1', role: 'student' } }) }))
vi.mock('@/lib/catalogTaskTexts', async original => ({
  ...await original<typeof import('@/lib/catalogTaskTexts')>(),
  fetchCatalogTaskTexts: mocks.texts,
}))

describe('useCatalogTopicTasks', () => {
  it('запрашивает условия и иллюстрации только для нужных порций после фильтрации всей темы', async () => {
    const index = Array.from({ length: 78 }, (_, i) => ({
      id: `task-${i}`,
      external_id: i,
      position: i,
      difficulty: null,
      completed: i % 3 === 0 ? [{ task_id: `task-${i}` }] : [],
    }))
    const bodyRequests: string[][] = []
    mocks.texts.mockImplementation(async () => new Map())
    mocks.from.mockImplementation(() => ({
      select: (columns: string) => {
        let selectedIds: string[] = []
        const query = {
          eq: () => query,
          order: () => query,
          range: () => query,
          in: (_column: string, ids: string[]) => {
            expect(columns).toContain('assets:catalog_task_assets')
            selectedIds = ids
            bodyRequests.push(ids)
            return query
          },
          abortSignal: async () => columns.includes('links:')
            ? { data: index, error: null }
            : { data: selectedIds.map(id => ({ id, statement_html: 'условие' })), error: null },
        }
        return query
      },
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const options: Parameters<typeof useCatalogTopicTasks>[1] = {
      view: 'exam', retryKey: 0, filter: 'all', difficulties: new Set(), visibleCount: 25, pageSize: 25,
    }
    const { result, rerender } = renderHook(props => useCatalogTopicTasks('topic-1', props), {
      wrapper, initialProps: options,
    })

    await waitFor(() => expect(result.current.tasks).toHaveLength(25))
    expect(bodyRequests).toEqual([index.slice(0, 25).map(task => task.id)])
    expect(result.current.totalCount).toBe(78)
    expect(result.current.doneCount).toBe(26)

    rerender({ ...options, visibleCount: 50 })
    await waitFor(() => expect(result.current.tasks).toHaveLength(50))
    expect(bodyRequests).toHaveLength(2)
    expect(bodyRequests[1]).toEqual(index.slice(25, 50).map(task => task.id))

    rerender({ ...options, filter: 'done' })
    await waitFor(() => expect(result.current.tasks).toHaveLength(25))
    expect(result.current.filteredCount).toBe(26)
    expect(bodyRequests[2]).toEqual(index.filter(task => task.completed.length).slice(0, 25).map(task => task.id))
    expect(mocks.texts.mock.calls.map(([ids]) => ids)).toEqual(bodyRequests)
  })
})
