import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { SignedImage } from '@/components/ui/SignedImage'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { HOMEWORK_PHOTO_ACCEPT, TOPIC_HOMEWORK_ATTEMPTS_BUCKET, type TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'

interface Props {
  numbers: string[]
  files: readonly TopicHomeworkAttemptFileRow[]
  readOnly: boolean
  disabled: boolean
  onPick: (number: string, files: File[]) => Promise<void>
  onDelete: (file: TopicHomeworkAttemptFileRow) => Promise<void>
}

export function HomeworkTaskPhotos({ numbers, files, readOnly, disabled, onPick, onDelete }: Props) {
  const attached = new Set(files.map(file => file.photo_task_number))
  const completed = numbers.filter(number => attached.has(number)).length

  return (
    <section className="space-y-3" aria-label="Решения по номерам">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Фото решений</h3>
        <span className="text-sm tabular-nums text-gray-600" role="status">{completed} из {numbers.length} номеров</span>
      </div>
      {!readOnly && (
        <p className="text-sm text-gray-600">Фото сохраняются в черновике. Когда будете готовы отправить работу преподавателю, нажмите «Сдать работу».</p>
      )}
      {numbers.map(number => (
        <article key={number} className="rounded-xl border border-gray-200 p-3" aria-label={`Задание №${number}`}>
          <h4 className="text-sm font-semibold text-gray-900">Задание №{number}</h4>
          {!readOnly && (
            <div className="mt-2 flex flex-wrap gap-2">
              {[false, true].map(camera => {
                const text = camera ? 'Снять фото' : 'Загрузить фото решения'
                return (
                  <label key={String(camera)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-primary-200 px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-within:ring-2 focus-within:ring-primary-500 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                    {camera ? <Camera size={16} aria-hidden /> : <ImagePlus size={16} aria-hidden />}
                    {text}
                    <input
                      type="file"
                      aria-label={`${text} для задания №${number}`}
                      accept={camera ? 'image/*' : HOMEWORK_PHOTO_ACCEPT}
                      capture={camera ? 'environment' : undefined}
                      multiple={!camera}
                      disabled={disabled}
                      className="sr-only"
                      onChange={event => {
                        const selected = Array.from(event.target.files ?? [])
                        event.target.value = ''
                        void onPick(number, selected)
                      }}
                    />
                  </label>
                )
              })}
            </div>
          )}
          {readOnly && !attached.has(number) && <p className="mt-1 text-sm text-gray-500">Решение не приложено</p>}
          {attached.has(number) && (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {files.filter(file => file.photo_task_number === number).map((file, index) => (
                <li key={file.id} className="min-w-0 rounded-lg bg-gray-50 p-2">
                  <SignedFileLink bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET} url={file.storage_path} className="block">
                    <SignedImage bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET} path={file.storage_path} alt={`Задание №${number}, фото ${index + 1}`} className="h-24 w-full rounded object-contain" />
                  </SignedFileLink>
                  {!readOnly && (
                    <button type="button" disabled={disabled} aria-label={`Удалить фото ${index + 1} задания №${number}`} onClick={() => void onDelete(file)} className="mt-1 flex min-h-10 items-center gap-1 rounded px-2 text-xs text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
                      <Trash2 size={14} aria-hidden /> Удалить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  )
}
