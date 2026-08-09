import { supabase } from '@/lib/supabase'

/**
 * Уборка объекта хранилища по счёту ссылок (§101).
 *
 * С §101 копия курса не заливает свои файлы, а ссылается на те же объекты:
 * один путь встречается в нескольких строках и в двух таблицах
 * (`topic_material_items` и `topic_homework_files`). Поэтому «удалили строку —
 * удаляем файл» больше не работает: так копия выбивала бы файл у шаблона.
 *
 * Правило одно и живёт в базе — `storage_path_refs`. Здесь только порядок:
 * строка удаляется ПЕРВОЙ, объект убирается после и только если на него никто
 * не ссылается.
 */
export type OrphanCleanup = 'removed' | 'kept' | 'failed'

/**
 * Удаляет объект, если на него больше нет ссылок.
 *
 * Никогда не бросает: строка к этому моменту уже удалена, и падение здесь
 * заставило бы человека думать, что операция не прошла, и жать кнопку снова
 * (тот же довод, что в `deleteCourse`). Не смогли узнать число ссылок —
 * объект остаётся: лишний файл в хранилище дешевле, чем выбитый у чужого
 * курса.
 */
export async function removeIfOrphan(bucket: string, path: string | null | undefined): Promise<OrphanCleanup> {
  if (!path) return 'kept'

  try {
    const { data, error } = await supabase.rpc('storage_path_refs', {
      p_bucket: bucket,
      p_path: path,
    } as never)
    if (error) return 'failed'
    // Неизвестный ответ считаем «ссылка есть»: ошибаться эта проверка должна
    // в сторону сохранения файла.
    const refs = typeof data === 'number' ? data : 1
    if (refs > 0) return 'kept'

    const { error: rmError } = await supabase.storage.from(bucket).remove([path])
    return rmError ? 'failed' : 'removed'
  } catch {
    return 'failed'
  }
}
