import { MySubscriptionPage } from '@/pages/subscription/MySubscriptionPage'
import { CoursesPage } from '@/pages/subscription/CoursesPage'

/**
 * «Подписка и курсы» (`/subscription`, ученик) — один экран вместо «Курсов» и
 * «Моей подписки» (меню ученика, письмо ЛК_стиль_меню_ученика.md, 16.10):
 * сверху мои подписки, ниже другие курсы. Старые адреса `/courses` и
 * `/my-subscription` — редирект сюда с сохранением параметров (`?from=start`,
 * `?started=trial` и т. п.).
 */
export function SubscriptionHubPage() {
  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-8 pb-10 pt-2" data-testid="subscription-hub">
      <div>
        <span className="stu-kicker">Аккаунт</span>
        <h1 className="stu-h2">Подписка и курсы</h1>
      </div>
      <MySubscriptionPage embedded />
      <CoursesPage embedded />
    </div>
  )
}
