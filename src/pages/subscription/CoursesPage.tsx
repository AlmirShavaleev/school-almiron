/**
 * §290-B. «Курсы» (`/courses`, ученик) — витрина по карточке на курс вместо
 * списка тарифов `/subscribe`. Карточки и цены — из `courses_showcase()`:
 * «500 ₽/мес или 4 800 ₽/год (−20 %)», «−N %» считает база из тарифов.
 * Подписка — на курс (у математики будут две отдельные). Курса ещё нет —
 * карточка «Скоро» с «Сообщить о запуске».
 *
 * Оформление — прежнее (`/subscribe/checkout/:tariffId`): email чека,
 * согласия, промокод, ЮKassa; пробный — там же главной кнопкой.
 * После анкеты (`?from=start&subject=…`) курс выбранного предмета — первым.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { useMySubscriptions } from '@/hooks/useSubscription'
import { useLaunchNotice, useShowcase } from '@/hooks/useStudentPath'
import { cardAction, tariffFor, type ShowcaseCard } from '@/lib/studentPath'
import { daysLabel, formatDateMsk, formatRub } from '@/lib/subscription/view'

type Period = 1 | 12

function CourseCard({ card, period, recommended, groupId }: {
  card: ShowcaseCard
  period: Period
  recommended: boolean
  groupId: string | null
}) {
  const notify = useLaunchNotice()
  const action = cardAction(card)
  // выбранного периода у курса нет — берём тот, что есть
  const tariff = tariffFor(card, period) ?? card.tariffs[0] ?? null
  const price = tariff ? tariff.price_rub : null

  return (
    <article
      className={cn('platform-surface flex flex-col rounded-card p-5 sm:p-6', recommended && 'ring-2 ring-primary-500')}
      data-testid="course-card"
      data-slug={card.slug}
      data-status={card.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[20px] font-semibold text-graphite-900">{card.title}</h2>
        {recommended && <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700">Для вас</span>}
        {card.status === 'soon' && <span className="rounded-full bg-graphite-100 px-2.5 py-0.5 text-xs font-semibold text-graphite-700">Скоро</span>}
      </div>
      {card.subtitle && card.status === 'live' && <p className="mt-1 text-[15px] text-graphite-700">{card.subtitle}</p>}

      {card.status === 'live' && price != null && (
        <p className="mt-4 text-[28px] font-semibold text-graphite-900" data-testid="course-card-price">
          {formatRub(price)}{' '}
          <span className="text-[15px] font-normal text-graphite-500">{tariff?.period_months === 12 ? 'в год' : 'в месяц'}</span>
        </p>
      )}
      {card.status === 'live' && card.month_price != null && card.year_price != null && (
        <p className="text-[13px] text-graphite-500" data-testid="course-card-both">
          {formatRub(card.month_price)}/мес или {formatRub(card.year_price)}/год
          {card.year_discount_pct ? ` (−${card.year_discount_pct} %)` : ''}
        </p>
      )}

      {card.includes.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-[15px] text-graphite-700">
          {card.includes.map((x) => (
            <li key={x} className="flex items-start gap-2"><Check size={16} className="mt-1 shrink-0 text-verdict-ok" />{x}</li>
          ))}
        </ul>
      )}
      {card.status === 'live' && card.trial_available && card.trial_days > 0 && (
        <p className="mt-3 text-[15px] text-graphite-700">
          Первые {daysLabel(card.trial_days)} — бесплатно и без карты: первые два урока каждого раздела и банк задач.
        </p>
      )}
      {action === 'open' && card.my_access_until && (
        <p className="mt-3 text-[15px] text-verdict-ok-ink">Курс открыт до {formatDateMsk(card.my_access_until)}</p>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap">
        {action === 'notify' && (
          card.notify_requested
            ? <p className="text-[15px] text-graphite-700" data-testid="course-card-notified">✓ Сообщим, когда курс откроется</p>
            : <Button variant="secondary" loading={notify.isPending} onClick={() => notify.mutate(card.id)} data-testid="course-card-notify">
                Сообщить о запуске
              </Button>
        )}
        {action === 'open' && (
          <>
            {groupId && <Link to={`/my-course/${groupId}`}><Button data-testid="course-card-open">Открыть курс</Button></Link>}
            {tariff && card.my_status === 'trial' && (
              <Link to={`/subscribe/checkout/${tariff.id}`}><Button variant="secondary" data-testid="course-card-buy">Оформить подписку</Button></Link>
            )}
          </>
        )}
        {action === 'trial' && tariff && (
          <>
            <Link to={`/subscribe/checkout/${tariff.id}`}>
              <Button data-testid="course-card-trial">Попробовать {daysLabel(card.trial_days)} бесплатно</Button>
            </Link>
            <Link to={`/subscribe/checkout/${tariff.id}`}>
              <Button variant="secondary" data-testid="course-card-buy">Оформить сразу</Button>
            </Link>
          </>
        )}
        {action === 'buy' && tariff && (
          <Link to={`/subscribe/checkout/${tariff.id}`}><Button data-testid="course-card-buy">Оформить</Button></Link>
        )}
      </div>
      {notify.error && <p className="mt-2 text-[13px] text-verdict-bad-ink">✕ Не получилось. Попробуйте ещё раз.</p>}
    </article>
  )
}

export function CoursesPage() {
  const [params] = useSearchParams()
  // после анкеты или результата диагностики (§289) — тот же порядок и «Для вас»
  const fromStart = params.get('from') === 'start' || params.get('from') === 'diagnostic'
  const subject = params.get('subject')
  const { data, isLoading, error } = useShowcase()
  const mine = useMySubscriptions()
  const [period, setPeriod] = useState<Period>(1)

  const cards = useMemo(() => {
    const list = [...(data ?? [])]
    // курс предмета из анкеты — первым (сортировка устойчивая)
    if (subject) list.sort((a, b) => Number(b.subject === subject && b.status === 'live') - Number(a.subject === subject && a.status === 'live'))
    return list
  }, [data, subject])
  const hasYear = cards.some((c) => c.status === 'live' && c.year_price != null)
  const maxDiscount = Math.max(0, ...cards.map((c) => c.year_discount_pct ?? 0))
  const groupOf = (courseId: string | null) =>
    (mine.data ?? []).find((s) => s.course_id === courseId)?.group_id ?? null

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6" data-testid="courses-page">
      <h1 className="text-[28px] font-semibold text-graphite-900">Курсы</h1>
      <p className="mt-1 text-[17px] text-graphite-700">
        {fromStart ? 'Начните с бесплатного пробного периода — карта не нужна.' : 'Подписка — на каждый курс отдельно. Прогресс сохраняется, даже если сделать перерыв.'}
      </p>

      {hasYear && (
        <div className="mt-5 inline-flex rounded-full border-[1.5px] border-graphite-300 bg-white p-1" role="group" aria-label="Период оплаты">
          {([1, 12] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={cn('min-h-10 rounded-full px-4 text-[15px] font-semibold', period === p ? 'bg-primary-600 text-white' : 'text-graphite-700')}
              data-testid={`courses-period-${p}`}
            >
              {p === 1 ? 'Месяц' : `Год${maxDiscount ? ` −${maxDiscount} %` : ''}`}
            </button>
          ))}
        </div>
      )}

      {isLoading && <p className="mt-6 text-graphite-500">Загружаем курсы…</p>}
      {error && <p className="mt-6 text-verdict-bad-ink">Не удалось загрузить курсы. Обновите страницу.</p>}
      {!isLoading && !error && cards.length === 0 && (
        <div className="platform-surface mt-6 rounded-card p-6" data-testid="courses-unavailable">
          <p className="text-[17px] text-graphite-900">Оформление подписки пока недоступно.</p>
          <p className="mt-1 text-[15px] text-graphite-500">Если вам дали ссылку или код курса — вступите по ним.</p>
          <Link to="/join" className="mt-4 inline-block text-primary-600 underline">Вступить по коду</Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {cards.map((c, i) => (
          <CourseCard
            key={c.id}
            card={c}
            period={period}
            recommended={fromStart && !!subject && i === 0 && c.subject === subject && c.status === 'live'}
            groupId={groupOf(c.course_id)}
          />
        ))}
      </div>
    </div>
  )
}
