import { Link } from 'react-router-dom'
import { ChevronRight, Clock, Timer } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useServerNow } from '@/hooks/useServerNow'
import { formatSpan } from '@/lib/mockExamLive'
import {
  mockAlert, mockTitlePhrase, mskDayLong, mskTime, type MockLessonListRow,
} from '@/lib/mockExamLesson'

/**
 * §224.2. Строка «Идёт пробник «№1» · осталось 7 мин · Начать» — сверху
 * везде, куда ученик попадает в курсе: страница курса в любом состоянии (и
 * при открытом разделе), страница темы, карточка курса в «Мои курсы»,
 * кабинет. Жалоба владельца 26.09: ученик зашёл в курс с одним разделом,
 * открыл раздел, потом тему — и пробник не встретил нигде, потому что
 * раздел «Пробники» (§224) стоял только на главной курса.
 *
 * Идёт — громко, одна главная кнопка. Ближайший (< суток) — тихой строкой с
 * отсчётом. Остальное — только в разделе «Пробники». Данные — существующий
 * `my_mock_exams`, время — по часам базы.
 *
 * `now` — снаружи, если на экране рядом раздел «Пробники»: обоим нужно одно и
 * то же «сейчас», иначе на границе окна главная кнопка оказалась бы в двух
 * местах или ни в одном.
 */
export function MockExamAlert({ exams, groupId, context, variant = 'banner', now: outerNow, className }: {
  exams: MockLessonListRow[]
  groupId: string
  /** Подпись курса — там, где курсов несколько (кабинет). */
  context?: string
  /** `strip` — полоса внизу карточки курса, без своей рамки. */
  variant?: 'banner' | 'strip'
  now?: number
  className?: string
}) {
  const ownNow = useServerNow(exams[0]?.server_now ?? null)
  const now = outerNow ?? ownNow
  const alert = mockAlert(exams, now)
  if (!alert) return null
  const { exam, kind, leftMs } = alert
  const to = `/my-course/${groupId}/mock/${exam.id}`
  const phrase = mockTitlePhrase(exam.title)

  if (kind === 'open') {
    return (
      <div
        role="status"
        data-testid="mock-alert"
        data-kind="open"
        className={cn(
          'flex flex-col gap-3 bg-primary-600 px-4 py-3 text-white sm:flex-row sm:items-center',
          variant === 'banner' ? 'rounded-2xl shadow-sm' : '',
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15" aria-hidden>
            <Timer size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug">
              Идёт {phrase}
            </p>
            <p className="mt-0.5 text-sm text-white/85" data-testid="mock-alert-line">
              осталось {formatSpan(leftMs)} · до {mskTime(exam.ends_at)}{context ? ` · ${context}` : ''}
            </p>
          </div>
        </div>
        <Link
          to={to}
          data-testid="mock-alert-open"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white px-5 text-sm font-semibold text-primary-700 shadow-sm transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-600 sm:w-auto"
        >
          {exam.has_work ? 'Продолжить' : 'Начать'}<ChevronRight size={16} aria-hidden />
        </Link>
      </div>
    )
  }

  return (
    <div
      data-testid="mock-alert"
      data-kind="soon"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-sm text-graphite-700',
        variant === 'banner' ? 'rounded-xl border border-slate-200 bg-white' : 'border-t border-slate-100 bg-slate-50',
        className,
      )}
    >
      <Clock size={15} className="shrink-0 text-primary-600" aria-hidden />
      <span className="min-w-0" data-testid="mock-alert-line">
        <span className="font-medium text-graphite-900">{phrase[0].toUpperCase() + phrase.slice(1)}</span>
        {' — '}{mskDayLong(exam.starts_at)} в {mskTime(exam.starts_at)} · через {formatSpan(leftMs)}
        {context ? ` · ${context}` : ''}
      </span>
      <Link to={to} data-testid="mock-alert-open"
        className="ml-auto inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
        Открыть<ChevronRight size={15} aria-hidden />
      </Link>
    </div>
  )
}
