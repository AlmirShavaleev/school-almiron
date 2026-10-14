/**
 * §290-B. Главная ученика по подписке: «Продолжить урок» и плашка срока.
 *
 * Обычный пробный (демо) — «До конца пробного — N дня. Оформить»; промо-дни
 * (курс открыт целиком) — «Курс открыт до …. Оформить»; оплаченная подписка —
 * без плашки. Урок «продолжить» — первый открытый непройденный урок курса
 * «по прохождению» (база, student_path_home). Всё остальное на главной — как было.
 */
import { Link } from 'react-router-dom'
import { PlayCircle } from 'lucide-react'
import { Sticker } from '@/components/student/skin/Sticker'
import { pathBanners, type PathSubscription } from '@/lib/studentPath'

export function SubscriptionPathCard({ subscriptions, now, showContinue = true }: {
  subscriptions: PathSubscription[]
  now?: Date
  /** Главная с собственной карточкой «Продолжить урок» — здесь её не дублируем. */
  showContinue?: boolean
}) {
  const banners = pathBanners(subscriptions, now)
  const next = showContinue ? subscriptions.filter((s) => s.has_access && s.continue && s.group_id) : []
  if (banners.length === 0 && next.length === 0) return null

  return (
    <div className="grid gap-3" data-testid="subscription-path">
      {banners.map((b) => {
        const sub = subscriptions.find((s) => s.course_id === b.courseId)
        return (
          <div
            key={`b-${b.courseId}`}
            className="stu-card stu-note is-or"
            role="status"
            data-testid="subscription-path-banner"
            data-kind={b.kind}
          >
            <Sticker name="clock" size={52} />
            <p className="stu-note-txt">
              <b className="font-extrabold">{b.text}.</b>{' '}
              <span className="stu-muted">{b.courseTitle}</span>
            </p>
            <Link to={sub ? `/subscribe/checkout/${sub.tariff_id}` : '/courses'} className="stu-btn stu-btn-o" data-testid="subscription-path-buy">
              Оформить
            </Link>
          </div>
        )
      })}
      {next.map((s) => (
        <Link
          key={`c-${s.course_id}`}
          to={`/my-course/${s.group_id}/topic/${s.continue!.topic_id}`}
          className="platform-surface flex items-center gap-3 rounded-card p-4 hover:shadow-md"
          data-testid="subscription-path-continue"
        >
          <PlayCircle size={32} className="shrink-0 text-primary-600" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium uppercase tracking-[.03em] text-graphite-500">Продолжить урок</span>
            <span className="block truncate text-[17px] font-semibold text-graphite-900">{s.continue!.title}</span>
            <span className="block truncate text-[13px] text-graphite-500">
              {s.course_title}{s.continue!.module_title ? ` · ${s.continue!.module_title}` : ''}
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}
