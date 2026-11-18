import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Camera, Check, ImagePlus, Trash2, X } from 'lucide-react'
import { SignedImage } from '@/components/ui/SignedImage'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { HOMEWORK_PHOTO_ACCEPT, TOPIC_HOMEWORK_ATTEMPTS_BUCKET, type TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

interface Props {
  numbers: string[]
  files: readonly TopicHomeworkAttemptFileRow[]
  selected: string | null
  condition: ReactNode
  feedback: ReactNode
  readOnly: boolean
  disabled: boolean
  onSelect: (number: string | null) => void
  onPick: (number: string, files: File[]) => Promise<void>
  onDelete: (file: TopicHomeworkAttemptFileRow) => Promise<void>
}

export function HomeworkTaskPhotos({ numbers, files, selected, condition, feedback, readOnly, disabled, onSelect, onPick, onDelete }: Props) {
  const attached = new Set(files.map(file => file.photo_task_number))
  const completed = numbers.filter(number => attached.has(number)).length
  const currentFiles = files.filter(file => file.photo_task_number === selected)

  return (
    <section className="space-y-3" aria-label="Решения по номерам">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Фото решений</h3>
        <span className="text-sm tabular-nums text-gray-600" role="status">{completed} из {numbers.length} номеров</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {numbers.map(number => {
          const hasPhoto = attached.has(number)
          return (
            <button
              key={number}
              type="button"
              aria-haspopup="dialog"
              aria-label={'Задание №' + number + (hasPhoto ? ', фото приложено' : '')}
              onClick={() => onSelect(number)}
              className={cn(
                'inline-flex min-h-11 min-w-14 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold tabular-nums',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-safe:transition-transform motion-safe:active:scale-[0.96]',
                hasPhoto ? 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100' : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100',
              )}
            >
              {number}
              {hasPhoto && <Check size={15} aria-hidden />}
            </button>
          )
        })}
      </div>
      {!readOnly && (
        <p className="text-sm text-gray-600">Фото сохраняются в черновике до сдачи работы.</p>
      )}
      {selected !== null && (
        <PhotoTaskDialog key={selected} number={selected} onClose={() => onSelect(null)}>
          {condition}
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              {[false, true].map(camera => {
                const text = camera ? 'Снять фото' : 'Загрузить фото решения'
                return (
                  <label key={String(camera)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-primary-200 px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-within:ring-2 focus-within:ring-primary-500 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                    {camera ? <Camera size={16} aria-hidden /> : <ImagePlus size={16} aria-hidden />}
                    {text}
                    <input
                      type="file"
                      aria-label={text + ' для задания №' + selected}
                      accept={camera ? 'image/*' : HOMEWORK_PHOTO_ACCEPT}
                      capture={camera ? 'environment' : undefined}
                      multiple={!camera}
                      disabled={disabled}
                      className="sr-only"
                      onChange={event => {
                        const picked = Array.from(event.target.files ?? [])
                        event.target.value = ''
                        void onPick(selected, picked)
                      }}
                    />
                  </label>
                )
              })}
            </div>
          )}
          {feedback}
          {readOnly && currentFiles.length === 0 && <p className="text-sm text-gray-600">Решение не приложено</p>}
          {currentFiles.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {currentFiles.map((file, index) => (
                <li key={file.id} className="min-w-0 rounded-xl bg-gray-50 p-2">
                  <SignedFileLink bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET} url={file.storage_path} className="block">
                    <SignedImage bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET} path={file.storage_path} alt={'Задание №' + selected + ', фото ' + (index + 1)} className="h-24 w-full rounded object-contain outline outline-1 outline-black/10" />
                  </SignedFileLink>
                  {!readOnly && (
                    <button type="button" disabled={disabled} aria-label={'Удалить фото ' + (index + 1) + ' задания №' + selected} onClick={() => void onDelete(file)} className="mt-1 flex min-h-10 items-center gap-1 rounded px-2 text-xs text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
                      <Trash2 size={14} aria-hidden /> Удалить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PhotoTaskDialog>
      )}
    </section>
  )
}

function PhotoTaskDialog({ number, onClose, children }: { number: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])

  function close() {
    ref.current?.close()
    onClose()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-3xl bg-white shadow-xl backdrop:bg-graphite-950/50 sm:inset-0 sm:m-auto sm:w-[min(36rem,calc(100vw-2rem))] sm:rounded-3xl"
      onCancel={event => {
        event.preventDefault()
        close()
      }}
      onClick={event => { if (event.target === event.currentTarget) close() }}
    >
      <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h4 id={titleId} className="text-lg font-semibold text-gray-900">Задание №{number}</h4>
          <button type="button" autoFocus onClick={close} aria-label="Закрыть задание" className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <X size={19} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
