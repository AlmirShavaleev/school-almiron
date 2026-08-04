import { useLocation, useNavigate } from 'react-router-dom'
import { Shield, GraduationCap } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useStaffMode, type StaffMode } from '@/store/staffModeStore'

/**
 * Переключатель «Администратор ⇄ Учитель» в шапке. Виден только admin/owner —
 * тем, у кого есть вторая сущность (строка в `teachers`).
 *
 * Меняет ТОЛЬКО представление: ярлык роли, набор пунктов меню и стартовый
 * дашборд. Права не трогаются никогда — подробности в `staffModeStore`.
 */

/**
 * Уводим на дашборд нового режима, только если человек СЕЙЧАС стоит на
 * дашборде. Иначе переключение посреди каталога или проверки ДЗ выбрасывало
 * бы со страницы, на которой работаешь.
 */
const DASHBOARD_ROUTES = ['/dashboard', '/admin', '/teacher', '/curator']

const OPTIONS: Array<{ mode: StaffMode; label: string; icon: React.ReactNode }> = [
  { mode: 'admin',   label: 'Администратор', icon: <Shield size={14} /> },
  { mode: 'teacher', label: 'Учитель',       icon: <GraduationCap size={14} /> },
]

export function StaffModeSwitch() {
  const { mode, setMode, canSwitch } = useStaffMode()
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
            title={`Режим: ${option.label}`}
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
    </div>
  )
}
