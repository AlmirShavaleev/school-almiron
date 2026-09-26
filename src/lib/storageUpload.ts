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
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error('Ошибка загрузки: HTTP ' + xhr.status))
    xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
    xhr.send(file)
  })
}
