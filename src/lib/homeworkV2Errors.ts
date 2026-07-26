/** Maps homework v2 RPC error codes (RAISE EXCEPTION '<CODE>[:...]' in Postgres) to
 * user-facing Russian messages. Falls back to the raw message for anything unrecognized. */
export function describeHomeworkV2Error(raw: string | undefined | null): string {
  if (!raw) return 'Неизвестная ошибка'

  const rateLimited = raw.match(/^RATE_LIMITED:(\d+)/)
  if (rateLimited) {
    const seconds = Number(rateLimited[1])
    const unit = seconds >= 60 ? `${Math.ceil(seconds / 60)} мин.` : `${seconds} сек.`
    return `Слишком много попыток подряд. Попробуйте снова через ${unit}.`
  }

  if (raw.startsWith('TOO_MANY_FILES')) return 'Слишком много файлов — максимум 10 на попытку.'
  if (raw.startsWith('FILE_TOO_LARGE')) return 'Файл слишком большой — максимум 20 МБ.'
  if (raw.startsWith('ATTEMPT_TOO_LARGE')) return 'Суммарный размер файлов превышает 100 МБ.'
  if (raw.startsWith('INVALID_FILE_TYPE')) return 'Недопустимый тип файла. Разрешены: PDF, JPG, PNG, WEBP, HEIC, DOC, DOCX, TXT.'
  if (raw.startsWith('ANSWER_TOO_LONG')) return 'Ответ слишком длинный — максимум 20 000 символов.'
  if (raw.startsWith('EMPTY_SUBMISSION')) return 'Прикрепите файл или введите ответ перед отправкой.'
  if (raw.startsWith('MAX_ATTEMPTS_REACHED')) return 'Использованы все доступные попытки.'
  if (raw.startsWith('PAST_DUE')) return 'Дедлайн прошёл, поздняя сдача не разрешена.'
  if (raw.startsWith('ASSIGNMENT_NOT_OPEN')) return 'Задание закрыто или отменено преподавателем.'
  if (raw.startsWith('ASSIGNMENT_NOT_PUBLISHED_YET')) return 'Задание ещё не опубликовано.'
  if (raw.startsWith('NOT_A_RECIPIENT')) return 'Это задание вам не назначено.'
  if (raw.startsWith('INVALID_STORAGE_PATH') || raw.startsWith('STORAGE_OBJECT_NOT_FOUND') || raw.startsWith('FORBIDDEN')) {
    return 'Не удалось прикрепить файл. Попробуйте загрузить его заново.'
  }
  if (raw.startsWith('ATTEMPT_NOT_EDITABLE')) return 'Эта попытка уже отправлена и не может быть изменена.'
  if (raw.startsWith('INVALID_SCORE')) return 'Оценка вне допустимого диапазона для этого задания.'

  return raw
}

export const HOMEWORK_ATTEMPT_LIMITS = {
  maxFiles: 10,
  maxFileSizeBytes: 20 * 1024 * 1024,
  maxTotalSizeBytes: 100 * 1024 * 1024,
  maxAnswerLength: 20000,
  allowedMimeTypes: [
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ],
} as const

export function validateAttemptFilesClientSide(files: File[]): string | null {
  if (files.length > HOMEWORK_ATTEMPT_LIMITS.maxFiles) {
    return `Слишком много файлов — максимум ${HOMEWORK_ATTEMPT_LIMITS.maxFiles}.`
  }
  let total = 0
  for (const f of files) {
    if (f.size > HOMEWORK_ATTEMPT_LIMITS.maxFileSizeBytes) {
      return `Файл «${f.name}» больше 20 МБ.`
    }
    if (!(HOMEWORK_ATTEMPT_LIMITS.allowedMimeTypes as readonly string[]).includes(f.type)) {
      return `Недопустимый тип файла «${f.name}». Разрешены: PDF, JPG, PNG, WEBP, HEIC, DOC, DOCX, TXT.`
    }
    total += f.size
  }
  if (total > HOMEWORK_ATTEMPT_LIMITS.maxTotalSizeBytes) {
    return 'Суммарный размер файлов превышает 100 МБ.'
  }
  return null
}
