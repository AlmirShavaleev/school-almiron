/**
 * §292. Плашка «предмет откроется с подпиской» — вместо пустого списка задач и
 * вместо красной ошибки CATALOG_LOCKED. Кнопка — только если есть куда вести
 * (CATALOG_SUBSCRIBE_HREF), иначе — «К каталогу».
 */
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { CATALOG_SUBSCRIBE_HREF } from '@/lib/catalogLock'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'

export function CatalogLockedNotice({ whole = false }: { whole?: boolean }) {
  // Без флага подписки — про курс, а не про подписку (выкатка в main, 16.10).
  const { enabled: subs } = useSubscriptionsEnabled()
  return (
    <div role="status" data-testid="catalog-locked" className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-center">
      <Lock className="h-7 w-7 shrink-0 text-gray-400" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-[17px] font-semibold text-gray-900">
          {!subs
            ? (whole ? 'Банк задач откроется вместе с курсом' : 'Этот предмет откроется вместе с курсом')
            : whole ? 'Банк задач откроется с подпиской' : 'Этот предмет откроется с подпиской'}
        </p>
        <p className="mt-1 text-[15px] text-gray-600">
          {!subs
            ? 'Задачи станут доступны, когда преподаватель добавит тебя в группу курса этого предмета.'
            : whole
              ? 'Начните пробный период или оформите подписку на курс — задачи и прогресс по ним станут доступны.'
              : 'Задачи по нему доступны по подписке или в пробный период курса этого предмета.'}
        </p>
      </div>
      {CATALOG_SUBSCRIBE_HREF && subs ? (
        <Link to={CATALOG_SUBSCRIBE_HREF} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary-600 px-5 text-sm font-bold text-white hover:bg-primary-700" data-testid="catalog-locked-subscribe">
          Открыть подписку
        </Link>
      ) : !whole ? (
        <Link to="/catalog" className="inline-flex min-h-11 items-center justify-center rounded-full border border-gray-300 px-5 text-sm font-semibold text-gray-800 hover:border-primary-400" data-testid="catalog-locked-back">
          К каталогу
        </Link>
      ) : null}
    </div>
  )
}
