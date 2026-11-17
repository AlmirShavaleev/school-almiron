import { useEffect, useMemo, useState } from 'react'
import { fetchMyScoreForecast, forecastHint, forecastNote, type StoredForecast } from '@/lib/scoreForecast'
import { Loader2, Target } from 'lucide-react'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import {
  EXAM_PRESETS, SUBJECT_ACC, SUBJECT_LABEL,
  fetchMyExamGoals, setMyExamGoal,
  type ExamGoal, type GoalSubject,
} from '@/lib/studentGoals'

/**
 * «Настройки → Учебные цели» (письмо ЛК_стиль_настройки_ученика.md, 16.10;
 * цель на экзамен).
 *
 *  · Цель на экзамен по каждому предмету своих курсов ЕГЭ: 60+ / 70+ / 80+ /
 *    90+ / свой балл (`set_my_exam_goal`).
 *
 * Прежние поля «Экзамен / Предмет / Целевой балл» (students.target_*) отсюда
 * убраны: цель на экзамен теперь одна — `student_exam_goals`.
 */
const btn = (on: boolean) => on ? 'stu-pick is-on' : 'stu-pick'

export function StudentGoalsTab({ profileId }: { profileId: string }) {
  const dash = useStudentDashboard(profileId)
  const subjects = useMemo(() => {
    const s = new Set<GoalSubject>()
    for (const c of dash.courses ?? []) {
      if ((c.subject === 'math' || c.subject === 'physics') && (c.examType ?? 'ege') === 'ege') s.add(c.subject)
    }
    return [...s]
  }, [dash.courses])

  const [exam, setExam] = useState<ExamGoal[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState<Partial<Record<GoalSubject, string>>>({})

  // Прогноз балла — хранимый (считается ночью, письмо 16.10); рядом с целью мелко.
  const [forecast, setForecast] = useState<StoredForecast[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMyExamGoals(profileId).then(g => { if (!cancelled) setExam(g) })
    fetchMyScoreForecast().then(f => { if (!cancelled) setForecast(f) })
    return () => { cancelled = true }
  }, [profileId])

  async function pickExam(subject: GoalSubject, goal: number | null) {
    if (goal != null && (goal < 1 || goal > 100)) { setError('Балл — от 1 до 100'); return }
    setBusy(true)
    const res = await setMyExamGoal(subject, goal)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setError(null)
    setExam(prev => [...(prev ?? []).filter(g => g.subject !== subject), ...(goal != null ? [{ subject, goal }] : [])])
  }

  return (
    <div className="space-y-4" data-testid="student-goals-settings">
      <section className="stu-card stu-set" data-testid="student-exam-goals">
        <h2 className="stu-set-h"><Target size={18} aria-hidden />Цель на экзамен</h2>
        <p className="stu-muted text-[13.5px]">Какой результат хочешь на ЕГЭ. От цели считается путь на главной и её видит преподаватель.</p>
        {exam == null || dash.loading ? (
          <p className="stu-muted flex items-center gap-2 text-[14px]"><Loader2 size={14} className="animate-spin" />Загрузка…</p>
        ) : subjects.length === 0 ? (
          <p className="stu-muted text-[14px]">Цель ставится по предмету курса ЕГЭ — когда запишешься на курс, она появится здесь.</p>
        ) : subjects.map(sub => {
          const cur = exam.find(g => g.subject === sub)?.goal ?? null
          const preset = cur != null && (EXAM_PRESETS as readonly number[]).includes(cur)
          return (
            <div key={sub} className="stu-set-row flex-wrap" data-testid={`student-exam-goal-${sub}`}>
              <div className="min-w-0 text-[14.5px] font-semibold">
                Сдать {SUBJECT_ACC[sub]}{cur != null ? <> на <b>{cur}+</b></> : ''}
                {forecastNote(forecast, sub) && (
                  <span className="stu-muted ml-2 text-[13px] font-semibold" title={forecastHint(forecast, sub)} data-testid={`student-forecast-${sub}`}>
                    · {forecastNote(forecast, sub)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Цель: ${SUBJECT_LABEL[sub]}`}>
                {EXAM_PRESETS.map(p => (
                  <button key={p} type="button" className={btn(cur === p)} aria-pressed={cur === p} disabled={busy} onClick={() => void pickExam(sub, p)}>{p}+</button>
                ))}
                <input
                  className="stu-input w-20"
                  inputMode="numeric"
                  placeholder="свой"
                  aria-label="Свой балл"
                  value={custom[sub] ?? (cur != null && !preset ? String(cur) : '')}
                  onChange={e => setCustom(c => ({ ...c, [sub]: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                  onKeyDown={e => { if (e.key === 'Enter' && custom[sub]) void pickExam(sub, Number(custom[sub])) }}
                  onBlur={() => { if (custom[sub] && Number(custom[sub]) !== cur) void pickExam(sub, Number(custom[sub])) }}
                />
                {cur != null && <button type="button" className="stu-sub-quiet" disabled={busy} onClick={() => void pickExam(sub, null)}>убрать</button>}
              </div>
            </div>
          )
        })}
      </section>

      {error && <p className="text-[13px] font-semibold text-[var(--redInk)]" role="alert">{error}</p>}
    </div>
  )
}
