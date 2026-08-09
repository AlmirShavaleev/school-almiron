import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { MATERIAL_IMAGE_PRESET, compressImageFile } from '@/lib/imageCompression'
import { removeIfOrphan } from '@/lib/storageRefs'
import { UPLOAD_CACHE_CONTROL_S } from '@/lib/storage'
import {
  TOPIC_MATERIALS_BUCKET,
  bucketForMaterialPath,
  buildMaterialInsert,
  buildMaterialStoragePath,
  toTopicMaterial,
  type MaterialDraft,
  type TopicMaterial,
  type TopicMaterialItemRow,
} from '@/lib/topicMaterialItems'

/**
 * Материалы темы: текст, видео, ссылка, файл.
 *
 * Скрытые материалы (`is_visible = false`) ученику не приходят вовсе —
 * их отсекает RLS-политика `topic_material_items_student_select`. Она же
 * учитывает `topics.available_from` через `course_student_can_see_topic`,
 * поэтому клиент ничего дополнительно не фильтрует: если строка пришла,
 * её можно показывать.
 */
export function useTopicMaterialItems(topicId: string | null) {
  const profile = useAuthStore(s => s.profile)
  const [materials, setMaterials] = useState<TopicMaterial[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!topicId) {
      setMaterials([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('topic_material_items')
      .select('*')
      .eq('topic_id', topicId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        setMaterials(
          ((data ?? []) as unknown as TopicMaterialItemRow[])
            .map(toTopicMaterial)
            .filter((m): m is TopicMaterial => m !== null),
        )
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [topicId, tick])

  /** Загружает файл в приватный бакет и возвращает путь. Строку в БД не создаёт. */
  const uploadMaterialFile = useCallback(
    async (file: File, onProgress?: (percent: number) => void): Promise<{ storagePath: string; fileName: string; mimeType: string; sizeBytes: number }> => {
      if (!topicId) throw new Error('Тема не выбрана')
      // Пережимаем ДО построения пути: имя и расширение должны описывать
      // то, что реально ляжет в Storage.
      const upload = await compressImageFile(file, MATERIAL_IMAGE_PRESET)
      const storagePath = buildMaterialStoragePath(topicId, upload.name)

      const { data: signed, error: signErr } = await supabase.storage
        .from(TOPIC_MATERIALS_BUCKET)
        .createSignedUploadUrl(storagePath)

      if (signErr || !signed) {
        // Фолбэк: обычная загрузка без прогресса
        const { error: err } = await supabase.storage
          .from(TOPIC_MATERIALS_BUCKET)
          .upload(storagePath, upload, { contentType: upload.type, upsert: false, cacheControl: UPLOAD_CACHE_CONTROL_S })
        if (err) throw new Error('Ошибка загрузки файла: ' + err.message)
        return { storagePath, fileName: upload.name, mimeType: upload.type, sizeBytes: upload.size }
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', signed.signedUrl)
        xhr.setRequestHeader('content-type', upload.type || 'application/octet-stream')
        xhr.setRequestHeader('x-upsert', 'false')
        // Без этого заголовка объект приезжает с `no-cache`, и подписанная
        // ссылка не поможет: браузер каждый раз пойдёт в сеть (§105).
        xhr.setRequestHeader('cache-control', `max-age=${UPLOAD_CACHE_CONTROL_S}`)
        xhr.upload.onprogress = e => {
          if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
          ? resolve()
          : reject(new Error('Ошибка загрузки файла: HTTP ' + xhr.status))
        xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
        xhr.send(upload)
      })
      onProgress?.(100)
      return { storagePath, fileName: upload.name, mimeType: upload.type, sizeBytes: upload.size }
    },
    [topicId],
  )

  const addMaterial = useCallback(
    async (draft: MaterialDraft) => {
      if (!topicId) throw new Error('Тема не выбрана')
      if (!profile) throw new Error('Нет активного профиля')

      const nextPosition = materials.reduce((max, m) => Math.max(max, m.position), -1) + 1
      const payload = buildMaterialInsert(topicId, profile.id, nextPosition, draft)

      const { data, error: err } = await supabase
        .from('topic_material_items')
        .insert(payload as unknown as any)
        .select('*')
        .single()

      if (err) throw err
      if (!data?.id) throw new Error('Недостаточно прав для добавления материала')

      const mapped = toTopicMaterial(data as unknown as TopicMaterialItemRow)
      if (mapped) setMaterials(prev => [...prev, mapped])
    },
    [topicId, profile, materials],
  )

  /**
   * Удаляет материал и, если файл больше никому не нужен, убирает объект.
   *
   * До §101 объект не убирался вовсе — файлы копились в хранилище после
   * каждого удаления. Теперь порядок такой: сначала строка (её удаление и
   * есть операция, о которой просил человек), потом объект и только при нуле
   * ссылок: с общими объектами копий «удалил строку — удалил файл» выбило бы
   * файл у шаблона.
   */
  const deleteMaterial = useCallback(async (id: string) => {
    const target = materials.find(m => m.id === id)

    const { error: err } = await supabase.from('topic_material_items').delete().eq('id', id)
    if (err) throw err
    setMaterials(prev => prev.filter(m => m.id !== id))

    if (target?.kind === 'file' && target.storagePath && topicId) {
      // Ошибка уборки наверх не идёт: строки уже нет, и повторное нажатие
      // ничего не исправит. Осиротевший объект подберёт скрипт схлопывания.
      await removeIfOrphan(bucketForMaterialPath(target.storagePath, topicId), target.storagePath)
    }
  }, [materials, topicId])

  const toggleVisibility = useCallback(async (id: string, isVisible: boolean) => {
    const { error: err } = await supabase
      .from('topic_material_items')
      .update({ is_visible: isVisible })
      .eq('id', id)
    if (err) throw err
    setMaterials(prev => prev.map(m => (m.id === id ? { ...m, isVisible } : m)))
  }, [])

  /**
   * Двигает материал на одну позицию. Порядок пересчитывается целиком и
   * записывается подряд (0, 1, 2, ...) — так список не расползается, даже
   * если позиции когда-то разъехались.
   */
  const moveMaterial = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const index = materials.findIndex(m => m.id === id)
      if (index === -1) return
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= materials.length) return

      const reordered = [...materials]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(target, 0, moved)

      const withPositions = reordered.map((m, i) => ({ ...m, position: i }))
      const previous = materials
      setMaterials(withPositions)

      const results = await Promise.all(
        withPositions.map(m =>
          supabase.from('topic_material_items').update({ position: m.position }).eq('id', m.id),
        ),
      )
      const failed = results.find(r => r.error)
      if (failed?.error) {
        setMaterials(previous) // откат к тому, что было
        throw failed.error
      }
    },
    [materials],
  )

  return {
    materials,
    loading,
    error,
    reload,
    uploadMaterialFile,
    addMaterial,
    deleteMaterial,
    toggleVisibility,
    moveMaterial,
  }
}
