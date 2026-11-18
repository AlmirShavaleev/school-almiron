import type { ReactNode } from 'react'
import { Camera, Check, ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedImage } from '@/components/ui/SignedImage'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { HOMEWORK_PHOTO_ACCEPT, TOPIC_HOMEWORK_ATTEMPTS_BUCKET, type TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { TopicTaskNumberButton } from './TopicTaskNumberButton'

interface Props {
  numbers: string[]
  files: readonly TopicHomeworkAttemptFileRow[]
  selected: string
  condition: ReactNode
  feedback: ReactNode
  readOnly: boolean
  disabled: boolean
  onSelect: (number: string) => void
  onPick: (number: string, files: File[]) => Promise<void>
  onDelete: (file: TopicHomeworkAttemptFileRow) => Promise<void>
}

export function HomeworkTaskPhotos({ numbers, files, selected, condition, feedback, readOnly, disabled, onSelect, onPick, onDelete }: Props) {
  const attached = new Set(files.map(file => file.photo_task_number))
  const completed = numbers.filter(number => attached.has(number)).length
  const currentFiles = files.filter(file => file.photo_task_number === selected)
  const currentIndex = numbers.indexOf(selected)

  return (
    <section className="space-y-3" aria-label="Задачи с проверкой по фото">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-graphite-900">Задачи с проверкой по фото</h3>
        <span className="text-[13px] text-graphite-500 tabular-nums" role="status">{completed} из {numbers.length} номеров</span>
      </div>
      <progress
        className="block h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-graphite-200 [&::-webkit-progress-value]:bg-verdict-ok [&::-moz-progress-bar]:bg-verdict-ok"
        aria-label="Номера с приложенным фото"
        value={completed}
        max={numbers.length}
      />
      <nav aria-label="Номера заданий">
        <ol className="flex flex-wrap gap-2">
          {numbers.map(number => {
            const hasPhoto = attached.has(number)
            return (
              <li key={number}>
                <TopicTaskNumberButton
                  active={number === selected}
                  aria-label={'Задание №' + number + (hasPhoto ? ', фото приложено' : '')}
                  onClick={() => onSelect(number)}
                  className={cn(
                    'min-h-10 min-w-10 px-2 motion-safe:active:scale-[0.96]',
                    hasPhoto ? 'border-verdict-ok bg-verdict-ok text-white' : 'border-graphite-200 bg-graphite-50 text-graphite-700 hover:border-primary-300 hover:bg-primary-50',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {number}
                    {hasPhoto && <Check size={14} aria-hidden />}
                  </span>
                </TopicTaskNumberButton>
              </li>
            )
          })}
        </ol>
      </nav>

      <article aria-label={'Задание №' + selected} className="space-y-3 rounded-xl border-[1.5px] border-graphite-200 p-3 sm:p-4">
        <h4 className="text-[13px] font-extrabold text-primary-700">№ {selected}</h4>
        {condition}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {[true, false].map(camera => {
              const text = camera ? 'Сфотографировать решение' : 'Прикрепить фото'
              return (
                <label key={String(camera)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-primary-200 px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-within:ring-2 focus-within:ring-primary-500 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
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
                      if (picked.length) void onPick(selected, picked)
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
      </article>

      {numbers.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={currentIndex === 0} onClick={() => onSelect(numbers[currentIndex - 1])}>
            <ChevronLeft size={15} aria-hidden />Назад
          </Button>
          <span className="text-[13px] text-graphite-500 tabular-nums">{currentIndex + 1} из {numbers.length}</span>
          <Button type="button" size="sm" variant="secondary" disabled={currentIndex === numbers.length - 1} onClick={() => onSelect(numbers[currentIndex + 1])}>
            Далее<ChevronRight size={15} aria-hidden />
          </Button>
        </div>
      )}
      {!readOnly && <p className="text-[13px] text-graphite-500">Фото сохраняются в черновике до сдачи работы.</p>}
    </section>
  )
}
