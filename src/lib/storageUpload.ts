import { supabase } from '@/lib/supabase'
import { UPLOAD_CACHE_CONTROL_S } from '@/lib/storage'

/**
 * Загрузка одного файла в Storage с процентами — ОДНА на проект.
 *
 * До §221 этот код жил дважды внутри `useTopicHomework` (файл задания и
 * страница работы ученика), слово в слово. Пробнику (§221) нужна та же
 * загрузка фото второй части; третья копия — ровно то, чего правило
 * «переиспользуй» не допускает, поэтому код вынесен сюда, а ДЗ зовёт его же.
 *
 * Грузим через подписанную ссылку и XHR: только так видны проценты. Не
 * удалось подписать (нет права, сеть) — обычная загрузка без процентов; её
 * ошибка и есть ответ хранилища, её и показываем.
 */
export async function uploadToStorage(
  bucket: string,
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
  options: { idleTimeoutMs?: number } = {},
): Promise<void> {
  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path)

  if (signErr || !signed) {
    const up = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: UPLOAD_CACHE_CONTROL_S })
    if (up.error) throw new Error('Ошибка загрузки: ' + up.error.message)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signed.signedUrl)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-upsert', 'false')
    // Без этого заголовка объект приезжает с `no-cache`, и подписанная
    // ссылка не поможет: браузер каждый раз пойдёт в сеть (§105).
    xhr.setRequestHeader('cache-control', `max-age=${UPLOAD_CACHE_CONTROL_S}`)
    // Для работ по времени: ограничиваем именно отсутствие прогресса,
    // а не длительность всей передачи на медленном, но живом канале.
    let idle: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const clearIdle = () => { if (idle !== undefined) clearTimeout(idle) }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearIdle()
      if (error) reject(error)
      else resolve()
    }
    const armIdle = () => {
      clearIdle()
      if (options.idleTimeoutMs && options.idleTimeoutMs > 0) {
        idle = setTimeout(() => {
          finish(new Error('Нет прогресса загрузки. Проверьте соединение и повторите.'))
          xhr.abort()
        }, options.idleTimeoutMs)
      }
    }
    xhr.upload.onprogress = e => {
      armIdle()
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300
      ? undefined
      : new Error('Ошибка загрузки: HTTP ' + xhr.status))
    xhr.onerror = () => finish(new Error('Ошибка сети при загрузке файла'))
    xhr.onabort = () => finish(new Error('Загрузка прервана'))
    armIdle()
    try { xhr.send(file) }
    catch (error) { finish(error instanceof Error ? error : new Error('Ошибка загрузки')) }
  })
}
