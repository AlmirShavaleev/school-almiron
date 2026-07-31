import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { MATERIAL_IMAGE_PRESET, compressImageFile } from '@/lib/imageCompression'
import type { LessonMaterial, MaterialType } from '@/types/lessons'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const BUCKET = 'lesson-materials'
const SIGNED_URL_TTL_SECONDS = 300

export function lessonMaterialPath(lessonId: string, uploaderProfileId: string, filename: string): string {
  return `${lessonId}/${uploaderProfileId}/${filename}`
}

export async function uploadLessonMaterialFile(
  lessonId: string, uploaderProfileId: string, file: File,
): Promise<string | null> {
  // Пережимаем ДО построения пути: расширение в имени объекта должно
  // совпадать с тем, что реально ляжет в Storage.
  const upload = await compressImageFile(file, MATERIAL_IMAGE_PRESET)
  const ext = upload.name.split('.').pop()
  const path = lessonMaterialPath(lessonId, uploaderProfileId, `${Date.now()}.${ext}`)
  // cacheControl: '0' — Supabase defaults to max-age=3600, which lets a
  // signed URL keep serving a stale (already-deleted) file from CDN cache
  // for up to an hour. These are private per-lesson materials, not static
  // assets — disable caching so deletion takes effect immediately.
  const { error } = await supabase.storage.from(BUCKET).upload(path, upload, { contentType: upload.type, upsert: true, cacheControl: '0' })
  if (error) return null
  return path
}

export async function getLessonMaterialSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) return null
  return data.signedUrl
}

export function useLessonMaterials(lessonId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [materials, setMaterials] = useState<LessonMaterial[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [tick,      setTick]      = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !lessonId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    db.from('lesson_materials')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: true })
      .then(({ data, error: err }: { data: LessonMaterial[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else     setMaterials(data ?? [])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [profile, lessonId, tick])

  return { materials, loading, error, reload }
}

export interface AddMaterialParams {
  material_type:         MaterialType
  title?:                string | null
  url?:                  string | null
  storage_path?:         string | null
  is_visible_to_student: boolean
}

export function useAddLessonMaterial(lessonId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const add = useCallback(async (params: AddMaterialParams): Promise<boolean> => {
    if (!profile || !lessonId) return false
    setLoading(true)
    setError(null)

    const { error: err } = await db.from('lesson_materials').insert({
      lesson_id:             lessonId,
      created_by:            profile.id,
      material_type:         params.material_type,
      title:                 params.title ?? null,
      url:                   params.url ?? null,
      storage_path:          params.storage_path ?? null,
      is_visible_to_student: params.is_visible_to_student,
    })

    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [profile, lessonId])

  return { add, loading, error }
}

export function useDeleteLessonMaterial() {
  const [loading, setLoading] = useState(false)

  const remove = useCallback(async (materialId: string, _storagePath: string | null): Promise<boolean> => {
    setLoading(true)
    // Atomic: the DB row (source of truth for access control) is deleted
    // server-side FIRST via RPC. Only then do we best-effort remove the
    // Storage object. If that second step fails, the orphaned bytes are
    // inert — RLS requires a matching lesson_materials row to grant a
    // signed URL, so a leftover object with no row is inaccessible, never
    // a security leak. The reverse order (storage-first) would risk a
    // dangling row pointing at nothing, which is user-visible breakage.
    const { data, error } = await db.rpc('delete_lesson_material', { p_material_id: materialId })
    if (error) { console.error('delete_lesson_material RPC failed:', error); setLoading(false); return false }

    const path = data?.[0]?.deleted_storage_path as string | null | undefined
    if (path) {
      try {
        await supabase.storage.from(BUCKET).remove([path])
      } catch (e) {
        // Row is already gone (source of truth) — a failed object removal
        // just leaves inert orphan bytes, never a security leak. Log for
        // ops visibility rather than surfacing an error to the user.
        console.error('lesson material storage cleanup failed (row already deleted):', e)
      }
    }

    setLoading(false)
    return true
  }, [])

  return { remove, loading }
}
