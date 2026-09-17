import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  CATALOG_ASSETS_BUCKET,
  buildCatalogAssetPath,
  isDuplicateStorageError,
  normalizeAssetFolder,
  type CatalogAssetUploadResult,
} from '@/lib/catalogAssets'

/**
 * Работа с бакетом `catalog-assets` из браузера (§195).
 *
 * Сессия обычная, пользовательская: писать в бакет разрешает политика
 * `catalog_assets_admin_write` (`is_admin_or_owner()`), сервисный ключ здесь
 * не нужен и не появляется. Ровно поэтому экран вообще стало возможно сделать
 * страницей, а не очередным скриптом с ключом в переменных окружения.
 */

/** Строка листинга папки — то, что отдаёт `storage.list()`. */
export interface CatalogAssetObject {
  name: string
  size: number | null
  updatedAt: string | null
}

/** Сколько строк показываем в листинге: глава каталога — это десятки файлов. */
const LIST_LIMIT = 200

/**
 * Один файл в бакет.
 *
 * `upsert: false` по умолчанию — это главное решение экрана: картинки каталога
 * уже разложены по задачам, и тихая перезапись ломает чужую задачу молча, без
 * ошибки и без следа. Занятый путь превращается в «уже есть», а перезапись —
 * отдельное осознанное «да» галочкой.
 */
export async function uploadCatalogAsset(
  folder: string,
  file: File,
  overwrite: boolean,
): Promise<CatalogAssetUploadResult> {
  const path = buildCatalogAssetPath(folder, file.name)
  const { error } = await supabase.storage.from(CATALOG_ASSETS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: overwrite,
  })

  if (!error) {
    return { fileName: file.name, path, size: file.size, status: overwrite ? 'replaced' : 'uploaded', detail: null }
  }
  if (isDuplicateStorageError(error)) {
    return { fileName: file.name, path, size: file.size, status: 'skipped', detail: null }
  }
  // Текст ошибки показываем как есть: у Storage их немного, и каждая говорит
  // о разном (нет прав, тип, размер, сеть). Свой перевод здесь только спрятал
  // бы причину — экран нужен именно тогда, когда что-то пошло не так.
  return {
    fileName: file.name,
    path,
    size: file.size,
    status: 'failed',
    detail: String((error as { message?: unknown }).message ?? error),
  }
}

/** Содержимое папки бакета. Пустой ответ и «папки нет» для Storage — одно и то же. */
export async function listCatalogAssetFolder(folder: string): Promise<CatalogAssetObject[]> {
  const prefix = normalizeAssetFolder(folder)
  const { data, error } = await supabase.storage.from(CATALOG_ASSETS_BUCKET).list(prefix, {
    limit: LIST_LIMIT,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw new Error(error.message)
  return (data ?? [])
    // У «папки» нет ни id, ни метаданных — это агрегат Storage, а не файл;
    // показывать её в списке файлов значило бы врать про размер и дату.
    .filter(row => row.id != null)
    .map(row => ({
      name: row.name,
      size: typeof row.metadata?.size === 'number' ? row.metadata.size : null,
      updatedAt: row.updated_at ?? row.created_at ?? null,
    }))
}

/**
 * Листинг папки для экрана: «я это уже заливал или нет».
 *
 * Перезапрашивается по `reload()` после каждой пачки — иначе список врал бы
 * ровно в тот момент, когда на него и смотрят.
 */
export function useCatalogAssetFolder(folder: string) {
  const [objects, setObjects] = useState<CatalogAssetObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  const prefix = normalizeAssetFolder(folder)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listCatalogAssetFolder(prefix)
      .then(rows => { if (!cancelled) setObjects(rows) })
      .catch((e: unknown) => {
        if (cancelled) return
        setObjects([])
        setError(String((e as { message?: unknown })?.message ?? e))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [prefix, tick])

  return { objects, loading, error, reload }
}
