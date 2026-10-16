import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ClipboardCheck, House, LibraryBig, LogOut, Settings, ShoppingBag, Star, Timer } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { useHomeworkToDoCount } from '@/hooks/useMyTopicHomework'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { useMyCuratorships } from '@/hooks/useMyCuratorships'
import { subscriptionTag } from '@/lib/studentNav'

/**
 * Пункты меню ученика, вариант В (письмо ЛК_стиль_меню_ученика.md, 16.10):
 * 5 главных (Главная · Курсы · ДЗ · Банк · Пробники) и «Ещё» (Подписка и курсы
 * с меткой «до 18 нояб», Настройки, разделы куратора, Выйти).
 */
export interface Item { key: string; label: string; to: string; icon: ReactNode; match: RegExp; badge?: number | null }

export interface MoreItem { key: string; label: string; icon: ReactNode; to?: string; tag?: string | null; onClick?: () => void }

export function useStudentNav() {
  const todo = useHomeworkToDoCount()
  const subs = useSubscriptionsEnabled()
  const profileId = useAuthStore(s => s.profile?.id ?? null)
  const path = useStudentPathHome(profileId, subs.enabled)
  const curator = useMyCuratorships()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const main: Item[] = [
    { key: 'home', label: 'Главная', to: '/student', icon: <House size={22} aria-hidden />, match: /^\/student\/?$/ },
    { key: 'courses', label: 'Курсы', to: '/my-course', icon: <BookOpen size={22} aria-hidden />, match: /^\/my-course/ },
    { key: 'hw', label: 'ДЗ', to: '/my-homework', icon: <ClipboardCheck size={22} aria-hidden />, match: /^\/my-homework/, badge: todo },
    { key: 'bank', label: 'Банк', to: '/catalog', icon: <LibraryBig size={22} aria-hidden />, match: /^\/catalog/ },
    { key: 'mocks', label: 'Пробники', to: '/my-mock-exams', icon: <Timer size={22} aria-hidden />, match: /^\/my-mock-exams/ },
  ]

  const more: MoreItem[] = useMemo(() => [
    ...(subs.enabled ? [{
      key: 'subscription', label: 'Подписка и курсы', icon: <ShoppingBag size={18} aria-hidden />, to: '/subscription',
      tag: subscriptionTag(path.data?.subscriptions ?? []),
    }] : []),
    { key: 'settings', label: 'Настройки', icon: <Settings size={18} aria-hidden />, to: '/settings' },
    // Ученик-куратор (§курирую): его разделы — здесь, чтобы не потерять доступ.
    ...(curator.isCurator ? [
      { key: 'cur-queue', label: 'Курирую: проверка ДЗ', icon: <ClipboardCheck size={18} aria-hidden />, to: '/homework-queue' },
      { key: 'cur-program', label: 'Курирую: программа курса', icon: <BookOpen size={18} aria-hidden />, to: '/course-program' },
      { key: 'cur-ratings', label: 'Курирую: оценки уроков', icon: <Star size={18} aria-hidden />, to: '/topic-ratings' },
    ] : []),
    {
      key: 'logout', label: 'Выйти', icon: <LogOut size={18} aria-hidden />,
      onClick: () => { void signOut().then(() => navigate('/login')) },
    },
  ], [subs.enabled, path.data, curator.isCurator, signOut, navigate])

  return { main, more }
}

