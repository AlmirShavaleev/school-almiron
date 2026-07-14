import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { loadTopicLinkMetadata, prepareTopicLinkMaterial, removeTopicLinkMarker, TOPIC_LINK_TYPE, uploadTopicLinkMarker, type TopicLinkMaterialView } from '@/lib/topicLinkMaterials'

export type MaterialType = 'notes' | 'theory' | 'tasks' | 'homework' | 'solution' | 'video' | 'link'

export interface TopicMaterial {
  id?: string
  topic_id: string
  type: MaterialType
  content: string | null
  file_url: string | null
  link_url: string | null
  link_meta?: TopicLinkMaterialView | null
}

export function useTopicMaterials(topicId: string | null) {
  const [materials, setMaterials] = useState<Record<MaterialType, TopicMaterial>>({} as any)
  const [loading, setLoading]     = useState(false)
  const [tick, setTick]           = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!topicId) return
    setLoading(true)

    supabase
      .from('topic_materials')
      .select('*')
      .eq('topic_id', topicId)
      .then(async ({ data }) => {
        const linkMap = await loadTopicLinkMetadata(
          (data || [])
            .filter(row => row.type === TOPIC_LINK_TYPE && !!row.file_url)
            .map(row => row.file_url as string),
        )
        const map: Record<string, TopicMaterial> = {}
        for (const row of data || []) {
          map[row.type] = {
            ...(row as any),
            link_meta: row.type === TOPIC_LINK_TYPE && row.file_url ? (linkMap.get(row.file_url) ?? null) : null,
          }
        }
        setMaterials(map as any)
        setLoading(false)
      })
  }, [topicId, tick])

  async function saveMaterial(type: MaterialType, patch: Partial<Omit<TopicMaterial, 'type' | 'topic_id'>>) {
    if (!topicId) return
    const existing = materials[type]

    if (existing?.id) {
      const { error } = await supabase
        .from('topic_materials')
        .update({ ...(patch as any), updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { data, error } = await supabase
        .from('topic_materials')
        .insert({ topic_id: topicId, type, ...(patch as any) })
        .select()
        .single()
      if (error) throw error
      setMaterials(prev => ({ ...prev, [type]: data as TopicMaterial }))
      return
    }

    setMaterials(prev => ({
      ...prev,
      [type]: { ...(prev[type] || { topic_id: topicId, type }), ...patch } as TopicMaterial,
    }))
  }

  async function uploadFile(type: MaterialType, file: File): Promise<string> {
    const ext  = file.name.split('.').pop()
    const path = `topics/${topicId}/${type}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('course-materials')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw new Error('Ошибка загрузки: ' + error.message)
    // Private bucket: store the storage path, not a public URL.
    return path
  }

  async function createLinkMaterial(title: string, url: string) {
    if (!topicId) return
    const draft = await prepareTopicLinkMaterial(topicId, title, url)
    const existing = materials.link
    await uploadTopicLinkMarker(draft)

    if (existing?.id) {
      if (existing.file_url && existing.file_url !== draft.object_path) {
        await removeTopicLinkMarker(existing.file_url)
      }
      const { error } = await supabase
        .from('topic_materials')
        .update({
          file_url: draft.object_path,
          content: null,
          link_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('topic_materials').insert({
        topic_id: topicId,
        type: TOPIC_LINK_TYPE,
        file_url: draft.object_path,
        content: null,
        link_url: null,
      })
      if (error) throw error
    }

    setMaterials(prev => ({
      ...prev,
      link: {
        ...(prev.link || { topic_id: topicId, type: 'link' as const }),
        file_url: draft.object_path,
        content: null,
        link_url: null,
        link_meta: { path: draft.object_path, title: draft.normalized_title, url: draft.normalized_url },
      } as TopicMaterial,
    }))
  }

  async function deleteMaterial(type: MaterialType) {
    if (!topicId) return
    const existing = materials[type]
    if (!existing?.id) return

    if (type === 'link') {
      if (existing.file_url) {
        await removeTopicLinkMarker(existing.file_url)
      }
      const { error } = await supabase.from('topic_materials').delete().eq('id', existing.id)
      if (error) throw error

      setMaterials(prev => {
        const next = { ...prev } as Partial<Record<MaterialType, TopicMaterial>>
        delete next[type]
        return next as Record<MaterialType, TopicMaterial>
      })
      return
    }

    const { error } = await supabase
      .from('topic_materials')
      .update({ file_url: null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw error

    setMaterials(prev => ({
      ...prev,
      [type]: { ...prev[type], file_url: null },
    }))
  }

  return { materials, loading, saveMaterial, uploadFile, createLinkMaterial, deleteMaterial, reload }
}
