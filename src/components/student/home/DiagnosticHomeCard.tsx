/**
 * §289. Маленькая карточка «Пройти диагностику» на главной ученика «с улицы»:
 * анкета пройдена, диагностика не начата или отложена («Пройти позже»).
 * Школьнику не показывается — у него нет анкеты (onboarding.completed = false).
 */
import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import type { OnboardingState } from '@/lib/studentPath'
import { showDiagnosticCard } from '@/lib/diagnostic'

export function DiagnosticHomeCard({ onboarding }: { onboarding: OnboardingState | null | undefined }) {
  if (!showDiagnosticCard(onboarding)) return null
  return (
    <Link
      to="/diagnostic"
      className="platform-surface flex items-center gap-3 rounded-card px-4 py-3 hover:shadow-md"
      data-testid="diagnostic-home-card"
    >
      <ListChecks size={22} className="shrink-0 text-primary-600" aria-hidden />
      <span className="min-w-0 flex-1 text-[15px] text-graphite-900">
        <span className="font-semibold">Пройдите диагностику</span>
        <span className="text-graphite-500"> — 20 минут, и узнаете прогноз балла и с чего начать</span>
      </span>
    </Link>
  )
}
