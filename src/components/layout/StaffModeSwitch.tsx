import { useLocation, useNavigate } from 'react-router-dom'
import { Shield, GraduationCap, Eye, Smartphone } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useMobilePreview, useStaffMode, type StaffMode } from '@/store/staffModeStore'

/**
 * Переключатель «Администратор ⇄ Учитель ⇄ Ученик» в шапке. Виден только
 * admin/owner — тем, у кого есть вторая сущность (строка в `teachers`).
 *
 * Меняет ТОЛЬКО представление: ярлык роли, набор пунктов меню и стартовый
 * дашборд. Права не трогаются никогда — подробности в `staffModeStore`.
 * «Ученик» (§178) — предпросмотр ученических экранов без записи; жёлтую
 * полосу с «Вернуться» рисует `StudentPreviewBanner`.
 *
 * Справа, через разделитель, — «Телефон» (§181). Визуально в той же группе
 * («такая же плашечка»), но это переключатель ПОВЕРХ режимов, а не четвёртый
 * режим: нажатие не меняет `mode`, а показывает текущий экран во вложенном
 * окне 390×844 (`MobilePreviewFrame`). На узких экранах (`md:hidden` шапки)
 * кнопки нет — на телефоне мобильный вид бессмыслен; внутри самого «телефона»
 * её тоже нет (`useMobilePreview().available`), иначе iframe в iframe.
 */

/**
 * Уводим на дашборд нового режима, только если человек СЕЙЧАС стоит на
 * дашборде. Иначе переключение посреди каталога или проверки ДЗ выбрасывало
 * бы со страницы, на которой работаешь.
 */
const DASHBOARD_ROUTES = ['/dashboard', '/admin', '/teacher', '/my-course']

const OPTIONS: Array<{ mode: StaffMode; label: string; icon: React.ReactNode }> = [
  { mode: 'admin',   label: 'Администратор', icon: <Shield size={14} /> },
  { mode: 'teacher', label: 'Учитель',       icon: <GraduationCap size={14} /> },
  { mode: 'student', label: 'Ученик',        icon: <Eye size={14} /> },
]

export function StaffModeSwitch() {
  const { mode, setMode, canSwitch } = useStaffMode()
  const mobile = useMobilePreview()
  const navigate = useNavigate()
  const location = useLocation()

  if (!canSwitch) return null

  function handleSelect(next: StaffMode) {
    if (next === mode) return
    setMode(next)
    if (DASHBOARD_ROUTES.includes(location.pathname)) {
      navigate('/dashboard', { replace: true })
    }
  }

  return (
    <div
      role="group"
      aria-label="Режим представления"
      data-testid="staff-mode-switch"
      className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 shrink-0"
    >
      {OPTIONS.map(option => {
        const active = option.mode === mode
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => handleSelect(option.mode)}
            aria-pressed={active}
            title={option.mode === 'student' ? 'Предпросмотр глазами ученика' : `Режим: ${option.label}`}
            data-testid={`staff-mode-${option.mode}`}
            className={cn(
              'flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-[7px] text-xs font-semibold transition-colors',
              active
                ? 'bg-white text-graphite-950 shadow-sm'
                : 'text-slate-500 hover:text-graphite-900'
            )}
          >
            {option.icon}
            <span className="hidden md:inline">{option.label}</span>
          </button>
        )
      })}
      {mobile.available && (
        <>
          <span aria-hidden className="mx-0.5 hidden h-4 w-px bg-slate-300 md:block" />
          <button
            type="button"
            onClick={() => mobile.setEnabled(!mobile.enabled)}
            aria-pressed={mobile.enabled}
            aria-label="Мобильный вид"
            title="Мобильный вид"
            data-testid="staff-mode-mobile"
            className={cn(
              'hidden md:flex items-center px-2 py-1.5 rounded-[7px] transition-colors',
              mobile.enabled
                ? 'bg-white text-graphite-950 shadow-sm'
                : 'text-slate-500 hover:text-graphite-900'
            )}
          >
            <Smartphone size={14} />
          </button>
        </>
      )}
    </div>
  )
}
