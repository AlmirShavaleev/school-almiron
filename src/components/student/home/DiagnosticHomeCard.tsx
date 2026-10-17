/**
 * §289. Маленькая карточка «Пройти диагностику» на главной ученика «с улицы»:
 * анкета пройдена, диагностика не начата или отложена («Пройти позже»).
 * Школьнику не показывается — у него нет анкеты (onboarding.completed = false).
 */
import { Link } from 'react-router-dom'
import type { OnboardingState } from '@/lib/studentPath'
import { showDiagnosticCard } from '@/lib/diagnostic'
import { Sticker } from '@/components/student/skin/Sticker'

/** Стиль лендинга (письмо 14.10): карточка с лупой и синей кромкой. */
export function DiagnosticHomeCard({ onboarding }: { onboarding: OnboardingState | null | undefined }) {
  if (!showDiagnosticCard(onboarding)) return null
  return (
    <Link
      to="/diagnostic"
      className="stu-card stu-note is-blue stu-focus transition-transform hover:-translate-y-0.5"
      data-testid="diagnostic-home-card"
    >
      <Sticker name="search" size={52} />
      <span className="stu-note-txt">
        <b className="block text-[16px] font-extrabold">Пройдите диагностику</b>
        <span className="stu-muted">20 минут — и узнаете прогноз балла и с чего начать</span>
      </span>
      <span className="stu-btn stu-btn-p">Начать →</span>
    </Link>
  )
}
