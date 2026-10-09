/**
 * §282. Курс закрыт подпиской — сказать прямо, а не показывать пустую
 * программу (пустота из-за RLS выглядела бы как «нет данных»).
 *
 * Показывается, только если курс платный и доступа нет (`my_course_access`).
 * Кнопка «Продлить» — только при включённом флаге: без него оформить нельзя.
 */
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCourseAccess, useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { formatDateMsk } from '@/lib/subscription/view'

export function SubscriptionLockBanner({ courseId }: { courseId: string | null | undefined }) {
  const { data } = useCourseAccess(courseId)
  const { enabled } = useSubscriptionsEnabled()
  if (!data || !data.paid || data.has_access) return null

  const ended = formatDateMsk(data.access_until)
  return (
    <div className="platform-surface mb-4 flex flex-col gap-3 rounded-card p-5 sm:flex-row sm:items-center" data-testid="subscription-lock" role="status">
      <Lock className="shrink-0 text-graphite-500" size={28} aria-hidden />
      <div className="flex-1">
        <p className="text-[17px] font-semibold text-graphite-900">
          {data.status ? 'Подписка закончилась — курс закрыт' : 'Курс доступен по подписке'}
        </p>
        <p className="text-[15px] text-graphite-700">
          {data.status
            ? `${ended ? `Доступ закрылся ${ended}. ` : ''}Прогресс и работы сохранены — продлите подписку, и всё вернётся.`
            : 'Оформите подписку, чтобы открыть материалы и задания.'}
        </p>
      </div>
      {enabled && (
        <Link to={data.tariff_id ? `/subscribe/checkout/${data.tariff_id}` : '/subscribe'}>
          <Button data-testid="subscription-lock-renew">{data.status ? 'Продлить подписку' : 'Оформить'}</Button>
        </Link>
      )}
    </div>
  )
}
