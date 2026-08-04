import { Shield, GraduationCap, ArrowRight } from 'lucide-react'
import { useStaffMode, type StaffMode } from '@/store/staffModeStore'

/**
 * Экран выбора режима сразу после входа. Видят только admin/owner — те, у кого
 * есть вторая сущность (строка в `teachers`, §73). Спрашивается при каждом
 * входе, но не при каждой перезагрузке: отметку держит sessionStorage, см.
 * `staffModeStore`.
 *
 * Это НЕ замена переключателю в шапке: тот остаётся для смены режима по ходу
 * работы. И это по-прежнему чистое представление — права админские в обоих
 * случаях, RLS и `RoleGuard` видят настоящую роль.
 */

const OPTIONS: Array<{
  mode:  StaffMode
  title: string
  hint:  string
  icon:  React.ReactNode
}> = [
  {
    mode:  'admin',
    title: 'Войти как администратор',
    hint:  'Панель школы: люди, курсы, команда, журнал отправок',
    icon:  <Shield size={22} />,
  },
  {
    mode:  'teacher',
    title: 'Войти как учитель',
    hint:  'Кабинет преподавателя: свои курсы, ученики и проверка работ',
    icon:  <GraduationCap size={22} />,
  },
]

export function StaffModeGate() {
  const { chooseMode } = useStaffMode()

  return (
    <div
      data-testid="staff-mode-gate"
      className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-primary-50/30 px-4 py-10"
    >
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-graphite-950">
            Как заходим?
          </h1>
          <p className="text-sm text-slate-500">
            Режим меняет только вид кабинета — права остаются администраторскими.
            Переключить можно в любой момент в шапке.
          </p>
        </div>

        <div className="space-y-3">
          {OPTIONS.map(option => (
            <button
              key={option.mode}
              type="button"
              onClick={() => chooseMode(option.mode)}
              data-testid={`staff-mode-gate-${option.mode}`}
              className="group w-full flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-950 text-white">
                {option.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-graphite-950">{option.title}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{option.hint}</span>
              </span>
              <ArrowRight
                size={18}
                className="shrink-0 text-slate-300 transition-colors group-hover:text-primary-600"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
