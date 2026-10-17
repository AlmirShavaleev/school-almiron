/**
 * §290-B. «Курсы» (`/courses`, ученик) — витрина по карточке на курс вместо
 * списка тарифов `/subscribe`. Карточки и цены — из `courses_showcase()`.
 * Подписка — на курс (у математики будут две отдельные). Курса ещё нет —
 * карточка «Скоро» с «Сообщить о запуске».
 *
 * В стиле ЛК без дублей (письмо ЛК_стиль_курсы_и_моя_подписка_без_дублей.md,
 * 16.10): цена — одной строкой по выбранному периоду (строки «… /мес или …
 * /год» нет — это и так видно переключателем); у курса с подпиской цены и
 * «что входит» нет — пилюля «Подписка активна», срок и «Открыть курс»;
 * «Скоро» — по высоте содержимого.
 *
 * Оформление — прежнее (`/subscribe/checkout/:tariffId`): email чека,
 * согласия, промокод, ЮKassa; пробный — там же главной кнопкой.
 * После анкеты (`?from=start&subject=…`) курс выбранного предмета — первым.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Sticker } from '@/components/student/skin/Sticker'
import type { StickerName } from '@/components/student/skin/skin'
import { useMySubscriptions } from '@/hooks/useSubscription'
import { useLaunchNotice, useShowcase } from '@/hooks/useStudentPath'
import { cardAction, tariffFor, type ShowcaseCard } from '@/lib/studentPath'
import { daysLabel, formatRub } from '@/lib/subscription/view'
import { dayMonthMsk, isSubscribed, yearSaving } from '@/lib/subscription/cardView'

type Period = 1 | 12

function sticker(card: ShowcaseCard): StickerName {
  if (card.status === 'soon') return 'bell'
  return card.subject === 'math' ? 'calendar' : card.subject === 'physics' ? 'rocket' : 'book'
}

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
  const subscribed = isSubscribed(card)
  const saving = tariff?.period_months === 12 ? yearSaving(card) : null

  return (
    <article
      className={recommended ? 'stu-card stu-cc is-rec' : 'stu-card stu-cc'}
      data-testid="course-card"
      data-slug={card.slug}
      data-status={card.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {recommended && <span className="stu-tag t-blue">Для вас</span>}
            {card.status === 'soon' && <span className="stu-tag t-grey" data-testid="course-card-soon">Скоро</span>}
            {subscribed && <span className="stu-tag t-green" data-testid="course-card-active">Подписка активна</span>}
            {card.my_status === 'trial' && card.has_access && <span className="stu-tag t-or">Пробный период</span>}
          </div>
          <h2 className="stu-h3 mt-2 break-words">{card.title}</h2>
          {card.status === 'live' && card.subtitle && <p className="stu-muted mt-1 text-[14.5px]">{card.subtitle}</p>}
        </div>
        <Sticker name={sticker(card)} size={56} />
      </div>

      {subscribed ? (
        <>
          {card.my_access_until && (
            <p className="text-[15px] font-semibold" data-testid="course-card-until">открыт до {dayMonthMsk(card.my_access_until)}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {groupId && <Link to={`/my-course/${groupId}`} className="stu-btn stu-btn-p" data-testid="course-card-open">Открыть курс</Link>}
            <Link to="/my-subscription" className="stu-link" data-testid="course-card-manage">Управлять подпиской →</Link>
          </div>
        </>
      ) : card.status === 'live' ? (
        <>
          {price != null && (
            <p data-testid="course-card-price">
              <b className="text-[28px] font-extrabold tracking-tight">{formatRub(price)}</b>{' '}
              <span className="stu-muted text-[15px]">{tariff?.period_months === 12 ? 'в год' : 'в месяц'}</span>
              {saving != null && <span className="stu-tag t-green ml-2 align-middle" data-testid="course-card-saving">экономия {formatRub(saving)}</span>}
            </p>
          )}
          {card.includes.length > 0 && (
            <ul className="space-y-1.5 text-[14.5px]">
              {card.includes.map((x) => (
                <li key={x} className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[var(--greenInk)]" aria-hidden />{x}</li>
              ))}
            </ul>
          )}
          {card.trial_available && card.trial_days > 0 && (
            <p className="stu-muted text-[14px]">
              Первые {daysLabel(card.trial_days)} — бесплатно и без карты: первые два урока каждого раздела и банк задач.
            </p>
          )}
          {action === 'open' && card.my_access_until && (
            <p className="text-[14.5px] font-semibold">Пробный период до {dayMonthMsk(card.my_access_until)}</p>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {action === 'open' && (
              <>
                {groupId && <Link to={`/my-course/${groupId}`} className="stu-btn stu-btn-p" data-testid="course-card-open">Открыть курс</Link>}
                {tariff && <Link to={`/subscribe/checkout/${tariff.id}`} className="stu-btn stu-btn-o" data-testid="course-card-buy">Оформить подписку</Link>}
              </>
            )}
            {action === 'trial' && tariff && (
              <>
                <Link to={`/subscribe/checkout/${tariff.id}`} className="stu-btn stu-btn-p" data-testid="course-card-trial">
                  Попробовать {daysLabel(card.trial_days)} бесплатно
                </Link>
                <Link to={`/subscribe/checkout/${tariff.id}`} className="stu-btn stu-btn-g" data-testid="course-card-buy">Оформить сразу</Link>
              </>
            )}
            {action === 'buy' && tariff && (
              <Link to={`/subscribe/checkout/${tariff.id}`} className="stu-btn stu-btn-p" data-testid="course-card-buy">Оформить</Link>
            )}
          </div>
        </>
      ) : (
        <>
          {/* «Скоро» — одна строка описания, без пустого места. */}
          {(card.subtitle || card.description) && <p className="stu-muted truncate text-[14.5px]">{card.subtitle || card.description}</p>}
          {card.notify_requested
            ? <p className="text-[14.5px] font-semibold text-[var(--greenInk)]" data-testid="course-card-notified">✓ Сообщим, когда курс откроется</p>
            : (
              <button
                type="button"
                className="stu-btn stu-btn-g self-start"
                disabled={notify.isPending}
                onClick={() => notify.mutate(card.id)}
                data-testid="course-card-notify"
              >
                Сообщить о запуске
              </button>
            )}
        </>
      )}
      {notify.error && <p className="text-[13px] text-[var(--redInk)]">✕ Не получилось. Попробуйте ещё раз.</p>}
    </article>
  )
}

/**
 * embedded — «Другие курсы» на экране «Подписка и курсы» (меню ученика, письмо
 * 16.10): курсы с подпиской там уже выше, в «Моих подписках» — здесь их нет.
 */
export function CoursesPage({ embedded = false }: { embedded?: boolean } = {}) {
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
    return embedded ? list.filter((c) => !isSubscribed(c)) : list
  }, [data, subject, embedded])
  const hasSubscribed = (data ?? []).some(isSubscribed)
  // переключатель нужен, только если есть что выбирать: курс без подписки с годовым тарифом
  const hasYear = cards.some((c) => c.status === 'live' && c.year_price != null && !isSubscribed(c))
  const maxDiscount = Math.max(0, ...cards.map((c) => c.year_discount_pct ?? 0))
  const groupOf = (courseId: string | null) =>
    (mine.data ?? []).find((s) => s.course_id === courseId)?.group_id ?? null

  return (
    <div className={embedded ? 'flex flex-col gap-6' : 'mx-auto flex max-w-[1140px] flex-col gap-6 pb-10 pt-2'} data-testid="courses-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {embedded ? (
            <h2 className="stu-h3">{hasSubscribed ? 'Другие курсы' : 'Курсы'}</h2>
          ) : (<>
            <span className="stu-kicker">Подписка</span>
            <h1 className="stu-h2">Курсы</h1>
          </>)}
          <p className="stu-muted mt-1 text-[14.5px]">
            {fromStart ? 'Начните с бесплатного пробного периода — карта не нужна.' : 'Подписка — на каждый курс отдельно. Прогресс сохраняется, даже если сделать перерыв.'}
          </p>
        </div>
        {hasYear && (
          <div className="stu-toggle" role="group" aria-label="Период оплаты">
            {([1, 12] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={period === p ? 'is-on' : undefined}
                data-testid={`courses-period-${p}`}
              >
                {p === 1 ? 'Месяц' : `Год${maxDiscount ? ` −${maxDiscount} %` : ''}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && <p className="stu-muted">Загружаем курсы…</p>}
      {error && <p className="text-[var(--redInk)]">Не удалось загрузить курсы. Обновите страницу.</p>}
      {!isLoading && !error && cards.length === 0 && (
        <div className="stu-card flex flex-col gap-2 p-6" data-testid="courses-unavailable">
          <p className="text-[17px] font-bold">Оформление подписки пока недоступно.</p>
          <p className="stu-muted text-[14.5px]">Если вам дали ссылку или код курса — вступите по ним.</p>
          <Link to="/join" className="stu-link">Вступить по коду</Link>
        </div>
      )}

      <div className="stu-mc-grid">
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
