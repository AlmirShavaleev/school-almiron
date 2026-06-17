import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export type MaterialType = 'notes' | 'theory' | 'tasks' | 'homework' | 'solution' | 'video'

export interface TopicMaterial {
  id?: string
  topic_id: string
  type: MaterialType
  content: string | null
  file_url: string | null
  link_url: string | null
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
      .then(({ data }) => {
        const map: Record<string, TopicMaterial> = {}
        for (const row of data || []) map[row.type] = row as any
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
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { data, error } = await supabase
        .from('topic_materials')
        .insert({ topic_id: topicId, type, ...patch })
        .select()
        .single()
      if (error) throw error
      setMaterials(prev => ({ ...prev, [type]: data }))
      return
    }

    setMaterials(prev => ({
      ...prev,
      [type]: { ...(prev[type] || { topic_id: topicId, type }), ...patch },
    }))
  }

  async function uploadFile(type: MaterialType, file: File): Promise<string> {
    const ext  = file.name.split('.').pop()
    const path = `topics/${topicId}/${type}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('course-materials')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw new Error('Ошибка загрузки: ' + error.message)
    const { data } = supabase.storage.from('course-materials').getPublicUrl(path)
    return data.publicUrl
  }

  return { materials, loading, saveMaterial, uploadFile, reload }
}
