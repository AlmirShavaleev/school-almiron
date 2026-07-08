import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type {
  TaskCollection,
  TaskCollectionItem,
  CollectionItemInput,
} from '@/types/collections'

// Catalog tables aren't in the generated types yet — use any cast
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── List all collections for current user ─────────────────────────────────────

export function useCollections() {
  const profile = useAuthStore(s => s.profile)
  const [collections, setCollections] = useState<TaskCollection[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [tick,        setTick]        = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setLoading(true)
    setError(null)

    db.from('task_collections')
      .select('*')
      .eq('created_by', profile.id)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .then(({ data, error: err }: { data: TaskCollection[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else     setCollections(data ?? [])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [profile, tick])

  return { collections, loading, error, reload }
}

// ── Load single collection + items ────────────────────────────────────────────

export interface CollectionWithItems {
  collection: TaskCollection
  items:      TaskCollectionItem[]
}

export function useCollection(collectionId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [data,    setData]    = useState<CollectionWithItems | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !collectionId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: col, error: e1 } = await db
        .from('task_collections')
        .select('*')
        .eq('id', collectionId)
        .single()

      if (cancelled) return
      if (e1) { setError(e1.message); setLoading(false); return }

      // RLS enforces ownership, but check explicitly for clear error
      if (col.created_by !== profile!.id) {
        setError('Доступ запрещён')
        setLoading(false)
        return
      }

      const { data: items, error: e2 } = await db
        .from('task_collection_items')
        .select('*')
        .eq('collection_id', collectionId)
        .order('position')

      if (cancelled) return
      if (e2) { setError(e2.message); setLoading(false); return }

      setData({ collection: col, items: items ?? [] })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile, collectionId, tick])

  return { data, loading, error, reload }
}

// ── Atomic save via RPC ───────────────────────────────────────────────────────

export interface SaveCollectionParams {
  collection_id: string | null
  title:         string
  description:   string | null
  subject:       string
  work_type:     string
  items:         CollectionItemInput[]
}

export function useSaveCollection() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const save = useCallback(async (params: SaveCollectionParams): Promise<string | null> => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: err } = await db.rpc('save_collection_atomic', {
        p_collection_id: params.collection_id,
        p_title:         params.title,
        p_description:   params.description,
        p_subject:       params.subject,
        p_work_type:     params.work_type,
        p_items:         params.items,
      })

      if (err) throw new Error(err.message)
      return data as string
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { save, loading, error }
}

// ── Update collection metadata only (title, description) ─────────────────────

export function useUpdateCollectionMeta(collectionId: string | undefined) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const update = useCallback(async (fields: { title?: string; description?: string }) => {
    if (!collectionId) return false
    setLoading(true)
    setError(null)

    const { error: err } = await db
      .from('task_collections')
      .update(fields)
      .eq('id', collectionId)

    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [collectionId])

  return { update, loading, error }
}

// ── Delete single item from collection ────────────────────────────────────────

export function useDeleteCollectionItem(collectionId: string | undefined) {
  const [loading, setLoading] = useState(false)

  const deleteItem = useCallback(async (itemId: string) => {
    if (!collectionId) return false
    setLoading(true)

    const { error: err } = await db
      .from('task_collection_items')
      .delete()
      .eq('id', itemId)
      .eq('collection_id', collectionId)

    setLoading(false)
    return !err
  }, [collectionId])

  return { deleteItem, loading }
}
