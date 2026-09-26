import { useEffect, useState } from 'react'
import { ChevronRight, ClipboardCheck, Lock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { clockOffset, lessonStatus, lessonStatusLabel, type MockLessonListRow, type MockLessonStatus } from '@/lib/mockExamLesson'

/**
 * §221. Пробник в программе курса — строка (вид «список») или карточка (вид
 * «карточки») среди тем раздела. Подпись состояния — по часам базы
 * (`server_now` из `my_mock_exams`), не устройства; открывать до начала всё
 * равно нечего — страница пробника сама скажет «откроется в 10:00».
 */
const TONE: Record<MockLessonStatus, string> = {
  upcoming: 'bg-slate-100 text-graphite-600',
  open: 'bg-primary-100 text-primary-800',
  submitted: 'bg-emerald-50 text-emerald-800',
  time_up: 'bg-amber-50 text-amber-900',
  checking: 'bg-slate-100 text-graphite-700',
  missed: 'bg-red-50 text-red-800',
  result: 'bg-emerald-100 text-emerald-900',
}

export function MockExamProgramRow({ exam, variant, onOpen }: {
  exam: MockLessonListRow
  variant: 'row' | 'card'
  onOpen: () => void
}) {
  const now = useTicker(exam.server_now)
  const st = lessonStatus(exam, now)
  const label = lessonStatusLabel(exam, now)
  const locked = st === 'upcoming'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      data-testid="mock-program-row"
      data-status={st}
      className={cn(
        'cursor-pointer rounded-xl border border-primary-200 bg-primary-50/40 px-4 py-3 transition-colors hover:border-primary-300 hover:bg-primary-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        variant === 'row' ? 'flex items-center gap-3' : 'flex flex-col gap-2 sm:col-span-2 lg:col-span-3',
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', locked ? 'bg-slate-100 text-graphite-400' : 'bg-primary-600 text-white')}>
          {locked ? <Lock size={14} /> : <ClipboardCheck size={15} />}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-primary-700">Пробник</p>
          <p className="text-sm font-semibold leading-snug text-graphite-900">{exam.title}</p>
        </div>
      </div>
      <div className={cn('flex items-center gap-2', variant === 'row' && 'ml-auto')}>
        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE[st])} data-testid="mock-program-status">{label}</span>
        <ChevronRight size={15} className="text-graphite-300" aria-hidden />
      </div>
    </div>
  )
}

/** «Сейчас» по часам базы, раз в 30 секунд — строке хватает минут. */
function useTicker(serverNow: string): number {
  const [offset] = useState(() => clockOffset(serverNow, Date.now()))
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 30_000)
    return () => clearInterval(id)
  }, [offset])
  return now
}
