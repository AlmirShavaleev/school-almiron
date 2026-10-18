import { useNavigate } from 'react-router-dom'
import {
  BookOpen, ClipboardCheck, CreditCard, Gauge, GraduationCap, House, Images, Layers, LibraryBig, LifeBuoy,
  LogOut, Send, Settings, Shield, Star, Timer, Users, Wand2,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSidebarBadges } from '@/hooks/useSidebarBadges'
import type { Item, MoreItem } from '@/hooks/useStudentNav'
import type { UserRole } from '@/types'

/**
 * Меню учителя и админа в стиле нового ЛК (письмо ЛК_учитель_и_админ_редизайн.md,
 * 17.10): колонка — главные пункты, остальное — «Ещё». Состав — таблица в
 * отчёте `оркестратору/ЛК_учитель_админ_отчёт.md` (кто чем пользуется, по
 * perf_events за 30 дней).
 *
 *  · колонка учителя: Главная · Проверка ДЗ · Курсы (программа) · Ученики · Банк задач;
 *    у админа/владельца сверху ещё «Админ» (панель — второй по частоте экран);
 *  · «Тесты» (/variants) и «Банк тестов» (/tests) убраны совсем (владелец 17.10):
 *    маршруты ведут на главную кабинета, код не удалён;
 *  · «Уведомления» — колокольчиком в шапке, не пунктом.
 * Роль — роль представления (`effectiveRole`), как у прежнего бокового меню:
 * у владельца в режиме учителя админских пунктов нет.
 */
type R = UserRole
const STAFF: R[] = ['teacher', 'curator', 'admin', 'owner']
const ADMIN: R[] = ['admin', 'owner']

interface Def extends Item { roles: R[] }
interface MoreDef extends MoreItem { roles: R[] }

const MAIN: Def[] = [
  { key: 'home', label: 'Главная', to: '/dashboard', icon: <House size={22} aria-hidden />, match: /^\/dashboard\/?$/, roles: STAFF },
  { key: 'admin', label: 'Админ', to: '/admin', icon: <Shield size={22} aria-hidden />, match: /^\/admin\/?$/, roles: ADMIN },
  { key: 'review', label: 'Проверка', to: '/homework-queue', icon: <ClipboardCheck size={22} aria-hidden />, match: /^\/(homework-queue|homeworks\/[^/]+\/review)/, roles: STAFF },
  { key: 'courses', label: 'Курсы', to: '/course-program', icon: <BookOpen size={22} aria-hidden />, match: /^\/course-program/, roles: STAFF },
  { key: 'students', label: 'Ученики', to: '/students', icon: <Users size={22} aria-hidden />, match: /^\/students/, roles: STAFF },
  { key: 'bank', label: 'Банк', to: '/catalog', icon: <LibraryBig size={22} aria-hidden />, match: /^\/catalog(?!\/assets)/, roles: STAFF },
]

const MORE: MoreDef[] = [
  { key: 'teacher', label: 'Кабинет учителя', to: '/teacher', icon: <GraduationCap size={18} aria-hidden />, roles: ['teacher'], section: 'Учёба' },
  { key: 'ratings', label: 'Оценки уроков', to: '/topic-ratings', icon: <Star size={18} aria-hidden />, roles: STAFF, section: 'Учёба' },
  { key: 'quality', label: 'Качество уроков', to: '/topic-quality', icon: <ClipboardCheck size={18} aria-hidden />, roles: STAFF },
  { key: 'mocks', label: 'Пробники', to: '/mock-exams', icon: <Timer size={18} aria-hidden />, roles: ['teacher', 'admin', 'owner'] },
  { key: 'collections', label: 'Мои подборки', to: '/collections', icon: <Layers size={18} aria-hidden />, roles: ['teacher', 'admin', 'owner'] },
  { key: 'generator', label: 'Конструктор вариантов', to: '/student/variants/generate', icon: <Wand2 size={18} aria-hidden />, roles: STAFF },
  { key: 'support', label: 'Обращения', to: '/admin/support', icon: <LifeBuoy size={18} aria-hidden />, roles: ADMIN, section: 'Админ' },
  { key: 'telegram', label: 'Журнал Telegram', to: '/admin/telegram', icon: <Send size={18} aria-hidden />, roles: ADMIN },
  { key: 'perf', label: 'Скорость', to: '/admin/perf', icon: <Gauge size={18} aria-hidden />, roles: ADMIN },
  { key: 'subscriptions', label: 'Подписка', to: '/admin/subscriptions', icon: <CreditCard size={18} aria-hidden />, roles: ADMIN },
  { key: 'assets', label: 'Картинки каталога', to: '/catalog/assets', icon: <Images size={18} aria-hidden />, roles: ADMIN },
  { key: 'settings', label: 'Настройки', to: '/settings', icon: <Settings size={18} aria-hidden />, roles: STAFF, section: 'Аккаунт' },
]

/** Адреса «Ещё» — подсветить кнопку «Ещё», когда стоишь на одном из них. */
export const STAFF_MORE_PATHS = /^\/(teacher|topic-ratings|topic-quality|mock-exams|collections|student\/variants|admin\/|catalog\/assets|settings|notifications)/

export function staffNavFor(role: R): { main: Item[]; more: MoreItem[] } {
  return {
    main: MAIN.filter(i => i.roles.includes(role)),
    more: MORE.filter(i => i.roles.includes(role)),
  }
}

export function useStaffNav(role: R) {
  const badges = useSidebarBadges()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { main, more } = staffNavFor(role)
  return {
    main: main.map(i => (i.key === 'review' ? { ...i, badge: badges['/homework-queue'] ?? null } : i)),
    more: [
      ...more,
      { key: 'logout', label: 'Выйти', icon: <LogOut size={18} aria-hidden />, onClick: () => { void signOut().then(() => navigate('/login')) } },
    ] as MoreItem[],
  }
}
