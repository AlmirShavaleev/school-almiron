import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  LESSON_TEMPLATE_LINK_TYPE,
  loadLessonTemplateLinkMetadata,
  prepareLessonTemplateLinkMaterial,
  removeLessonTemplateLinkMarker,
  uploadLessonTemplateLinkMarker,
} from '@/lib/lessonTemplateLinkMaterials'
import type {
  LessonTemplate,
  LessonTemplateMaterial,
  LessonTemplateMaterialType,
  LessonTemplateTask,
  LessonTemplateWithDetails,
} from '@/types/lessonLibrary'

// Generated types lag behind live schema for lesson library.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function useLessonTemplates() {
  const profile = useAuthStore(s => s.profile)
  const [templates, setTemplates] = useState<LessonTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(v => v + 1), [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setLoading(true)
    setError(null)

    db.from('lesson_templates')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error: err }: { data: LessonTemplate[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setTemplates(data ?? [])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [profile, tick])

  const createTemplate = useCallback(async (input: Pick<LessonTemplate, 'title' | 'subject' | 'exam_type' | 'description'>) => {
    if (!profile) throw new Error('Профиль не загружен')
    const { data, error } = await db
      .from('lesson_templates')
      .insert({
        owner_id: profile.id,
        title: input.title,
        subject: input.subject,
        exam_type: input.exam_type,
        catalog_topic_id: null,
        description: input.description,
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    setTemplates(prev => [data, ...prev])
    return data as LessonTemplate
  }, [profile])

  const updateTemplate = useCallback(async (templateId: string, patch: Partial<Pick<LessonTemplate, 'title' | 'subject' | 'exam_type' | 'catalog_topic_id' | 'description'>>) => {
    const { data, error } = await db
      .from('lesson_templates')
      .update(patch)
      .eq('id', templateId)
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    setTemplates(prev => prev.map(item => item.id === templateId ? data : item))
    return data as LessonTemplate
  }, [])

  const deleteTemplate = useCallback(async (templateId: string) => {
    const { error } = await db.from('lesson_templates').delete().eq('id', templateId)
    if (error) throw new Error(error.message)
    setTemplates(prev => prev.filter(item => item.id !== templateId))
  }, [])

  return { templates, loading, error, reload, createTemplate, updateTemplate, deleteTemplate }
}

export function useLessonTemplate(templateId: string | null) {
  const profile = useAuthStore(s => s.profile)
  const [data, setData] = useState<LessonTemplateWithDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(v => v + 1), [])

  useEffect(() => {
    if (!profile || !templateId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const [{ data: template, error: templateError }, { data: materials, error: materialsError }, { data: tasks, error: tasksError }, { data: linkedTopic, error: linkedTopicError }] = await Promise.all([
          db.from('lesson_templates').select('*').eq('id', templateId).single(),
          db.from('lesson_template_materials').select('*').eq('template_id', templateId).order('sort_order').order('created_at'),
          db.from('lesson_template_tasks').select('*').eq('template_id', templateId).order('sort_order').order('created_at'),
          db.from('lesson_templates').select('catalog_topics(id, title)').eq('id', templateId).maybeSingle(),
        ])

        if (templateError) throw new Error(templateError.message)
        if (materialsError) throw new Error(materialsError.message)
        if (tasksError) throw new Error(tasksError.message)
        if (linkedTopicError) throw new Error(linkedTopicError.message)

        const linkMap = await loadLessonTemplateLinkMetadata(
          ((materials ?? []) as LessonTemplateMaterial[])
            .filter(row => row.type === LESSON_TEMPLATE_LINK_TYPE && !!row.file_path)
            .map(row => row.file_path as string),
        )

        const normalizedMaterials = ((materials ?? []) as LessonTemplateMaterial[]).map(row => ({
          ...row,
          link_meta: row.type === LESSON_TEMPLATE_LINK_TYPE && row.file_path ? (linkMap.get(row.file_path) ?? null) : null,
        }))

        if (!cancelled) {
          setData({
            ...(template as LessonTemplate),
            catalog_topic: (linkedTopic as { catalog_topics?: { id: string; title: string } | null } | null)?.catalog_topics ?? null,
            materials: normalizedMaterials,
            tasks: (tasks ?? []) as LessonTemplateTask[],
          })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить урок')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile, templateId, tick])

  const materialsByType = useMemo(() => {
    const map = {} as Record<LessonTemplateMaterialType, LessonTemplateMaterial | undefined>
    for (const row of data?.materials ?? []) map[row.type] = row
    return map
  }, [data?.materials])

  const saveTemplate = useCallback(async (patch: Partial<Pick<LessonTemplate, 'title' | 'subject' | 'exam_type' | 'catalog_topic_id' | 'description'>>) => {
    if (!templateId) return
    const { data: updated, error } = await db
      .from('lesson_templates')
      .update(patch)
      .eq('id', templateId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    setData(prev => prev ? { ...prev, ...(updated as LessonTemplate) } : prev)
  }, [templateId])

  const saveMaterial = useCallback(async (
    type: LessonTemplateMaterialType,
    patch: Partial<Omit<LessonTemplateMaterial, 'id' | 'template_id' | 'type' | 'sort_order'>>,
  ) => {
    if (!templateId) return
    const existing = materialsByType[type]
    if (existing?.id) {
      const { error } = await db
        .from('lesson_template_materials')
        .update(patch)
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
      setData(prev => prev ? {
        ...prev,
        materials: prev.materials.map(item => item.id === existing.id ? { ...item, ...patch } : item),
      } : prev)
      return
    }

    const nextSortOrder = (data?.materials.length ?? 0) + 1
    const { data: inserted, error } = await db
      .from('lesson_template_materials')
      .insert({
        template_id: templateId,
        type,
        sort_order: nextSortOrder,
        ...patch,
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    setData(prev => prev ? { ...prev, materials: [...prev.materials, inserted as LessonTemplateMaterial] } : prev)
  }, [data?.materials.length, materialsByType, templateId])

  const uploadMaterialFile = useCallback(async (
    type: LessonTemplateMaterialType,
    file: File,
    onProgress?: (percent: number) => void,
  ) => {
    if (!templateId) throw new Error('Урок не выбран')
    if (!profile?.id) throw new Error('Профиль не загружен')
    const ext = file.name.split('.').pop()
    const path = `owner/${profile.id}/templates/${templateId}/${type}/${Date.now()}.${ext}`
    await uploadFileWithProgress('lesson-library', path, file, onProgress)
    return path
  }, [profile?.id, templateId])

  const createLinkMaterial = useCallback(async (title: string, url: string) => {
    if (!templateId) return
    const draft = await prepareLessonTemplateLinkMaterial(templateId, title, url)
    const existing = materialsByType.link
    await uploadLessonTemplateLinkMarker(draft)

    if (existing?.id) {
      if (existing.file_path && existing.file_path !== draft.object_path) await removeLessonTemplateLinkMarker(existing.file_path)
      const { error } = await db
        .from('lesson_template_materials')
        .update({
          file_path: draft.object_path,
          content: null,
          link_url: null,
        })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await db
        .from('lesson_template_materials')
        .insert({
          template_id: templateId,
          type: 'link',
          sort_order: (data?.materials.length ?? 0) + 1,
          file_path: draft.object_path,
          content: null,
          link_url: null,
        })
      if (error) throw new Error(error.message)
    }

    reload()
  }, [data?.materials.length, materialsByType.link, reload, templateId])

  const deleteMaterial = useCallback(async (type: LessonTemplateMaterialType) => {
    const existing = materialsByType[type]
    if (!existing?.id) return

    if (type === 'link') {
      if (existing.file_path) await removeLessonTemplateLinkMarker(existing.file_path)
      const { error } = await db.from('lesson_template_materials').delete().eq('id', existing.id)
      if (error) throw new Error(error.message)
      setData(prev => prev ? { ...prev, materials: prev.materials.filter(item => item.id !== existing.id) } : prev)
      return
    }

    if (existing.file_path) {
      const { error: storageError } = await supabase.storage.from('lesson-library').remove([existing.file_path])
      if (storageError) throw new Error(storageError.message || 'Не удалось удалить файл')
    }

    const hasOtherPayload = !!existing.content || !!existing.link_url
    if (!hasOtherPayload) {
      const { error } = await db.from('lesson_template_materials').delete().eq('id', existing.id)
      if (error) throw new Error(error.message)
      setData(prev => prev ? { ...prev, materials: prev.materials.filter(item => item.id !== existing.id) } : prev)
      return
    }

    const { error } = await db
      .from('lesson_template_materials')
      .update({ file_path: null })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
    setData(prev => prev ? {
      ...prev,
      materials: prev.materials.map(item => item.id === existing.id ? { ...item, file_path: null } : item),
    } : prev)
  }, [materialsByType])

  const replaceTasks = useCallback(async (taskIds: string[]) => {
    if (!templateId) return
    const currentIds = (data?.tasks ?? []).map(item => item.id)
    if (currentIds.length) {
      const { error } = await db.from('lesson_template_tasks').delete().in('id', currentIds)
      if (error) throw new Error(error.message)
    }

    if (!taskIds.length) {
      setData(prev => prev ? { ...prev, tasks: [] } : prev)
      return
    }

    const { data: inserted, error } = await db
      .from('lesson_template_tasks')
      .insert(taskIds.map((taskId, index) => ({
        template_id: templateId,
        task_kind: 'homework_template',
        catalog_task_id: taskId,
        sort_order: index + 1,
        payload: {},
      })))
      .select('*')
      .order('sort_order')

    if (error) throw new Error(error.message)
    setData(prev => prev ? { ...prev, tasks: (inserted ?? []) as LessonTemplateTask[] } : prev)
  }, [data?.tasks, templateId])

  return {
    data,
    loading,
    error,
    reload,
    materialsByType,
    saveTemplate,
    saveMaterial,
    uploadMaterialFile,
    createLinkMaterial,
    deleteMaterial,
    replaceTasks,
  }
}

async function uploadFileWithProgress(
  bucket: 'lesson-library',
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
) {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Сессия истекла. Войдите снова.')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!supabaseUrl) throw new Error('Не задан VITE_SUPABASE_URL')

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.setRequestHeader('x-upsert', 'true')
    xhr.setRequestHeader('cache-control', '0')
    if (file.type) xhr.setRequestHeader('content-type', file.type)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))))
    }

    xhr.onerror = () => reject(new Error('Не удалось загрузить файл'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100)
        resolve()
        return
      }

      try {
        const payload = JSON.parse(xhr.responseText) as { message?: string; error?: string }
        reject(new Error(payload.message || payload.error || 'Не удалось загрузить файл'))
      } catch {
        reject(new Error('Не удалось загрузить файл'))
      }
    }

    xhr.send(file)
  })
}
