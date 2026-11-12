import { Link, useLocation } from 'react-router-dom'
import { MySubscriptionPage } from '@/pages/subscription/MySubscriptionPage'
import { CoursesPage } from '@/pages/subscription/CoursesPage'

/** Витрина и оплата — отдельные адреса и вкладки. Зачисленные курсы — /my-course. */
export function SubscriptionHubPage({ tab = 'payments' }: { tab?: 'courses' | 'payments' }) {
  const { search } = useLocation()
  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-6 pb-10 pt-2" data-testid="subscription-hub">
      <div>
        <span className="stu-kicker">Аккаунт</span>
        <h1 className="stu-h2">{tab === 'courses' ? 'Витрина курсов' : 'Оплата'}</h1>
        <p className="stu-muted mt-2">{tab === 'courses' ? 'Другие курсы, на которые можно записаться. Ваши занятия — в разделе «Мои курсы».' : 'Ваши подписки, продление и история платежей.'}</p>
      </div>
      <nav aria-label="Курсы и оплата" className="flex flex-wrap gap-3">
        <Link to={`/courses${search}`} aria-current={tab === 'courses' ? 'page' : undefined} className={tab === 'courses' ? 'stu-btn stu-btn-p' : 'stu-btn stu-btn-o'}>Витрина курсов</Link>
        <Link to={`/my-subscription${search}`} aria-current={tab === 'payments' ? 'page' : undefined} className={tab === 'payments' ? 'stu-btn stu-btn-p' : 'stu-btn stu-btn-o'}>Оплата</Link>
        <Link to="/my-course" className="stu-link self-center">Мои курсы →</Link>
      </nav>
      {tab === 'payments' ? <MySubscriptionPage embedded /> : <CoursesPage embedded />}
    </div>
  )
}
