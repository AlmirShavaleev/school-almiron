import { useEffect, useMemo, useState } from 'react'
import { fetchMyScoreForecast, forecastHint, forecastNote, type StoredForecast } from '@/lib/scoreForecast'
import { CalendarCheck, Loader2, Target } from 'lucide-react'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { WeeklyGoalsEditor } from '@/components/goals/WeeklyGoalsEditor'
import {
  EXAM_PRESETS, SUBJECT_ACC, SUBJECT_LABEL,
  NO_GOALS, WEEKLY_KINDS, fetchMyExamGoals, fetchMyWeeklyGoals, setMyExamGoal, setMyWeeklyGoals, weeklyGoalTitle, weeklyProgressLabel,
  type ExamGoal, type GoalNumbers, type GoalSubject, type MyWeekly,
} from '@/lib/studentGoals'

/**
 * «Настройки → Учебные цели» (письмо ЛК_стиль_настройки_ученика.md, 16.10;
 * два уровня — решение владельца 16.10, заменяет вариант «цель-тема»).
 *
 *  · Цель на экзамен по каждому предмету своих курсов ЕГЭ: 60+ / 70+ / 80+ /
 *    90+ / свой балл (`set_my_exam_goal`).
 *  · Цели недели — ставит сам ученик (правка письма 16.10 17:45): 1–3
 *    стандартные цели кнопками; изменения — со следующего понедельника.
 *
 * Прежние поля «Экзамен / Предмет / Целевой балл» (students.target_*) отсюда
 * убраны: цель на экзамен теперь одна — `student_exam_goals`.
 */
const btn = (on: boolean) => on ? 'stu-pick is-on' : 'stu-pick'
const dayMonth = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

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
  const [weekly, setWeekly] = useState<MyWeekly | null>(null)
  const [draft, setDraft] = useState<GoalNumbers | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState<Partial<Record<GoalSubject, string>>>({})

  // Прогноз балла — хранимый (считается ночью, письмо 16.10); рядом с целью мелко.
  const [forecast, setForecast] = useState<StoredForecast[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMyExamGoals(profileId).then(g => { if (!cancelled) setExam(g) })
    fetchMyScoreForecast().then(f => { if (!cancelled) setForecast(f) })
    fetchMyWeeklyGoals().then(r => {
      if (cancelled) return
      const w = r.data ?? { current: null, next: null, goals: [] }
      setWeekly(w)
      setDraft(w.next?.nums ?? w.current ?? NO_GOALS)
    })
    return () => { cancelled = true }
  }, [profileId])

  async function saveWeekly() {
    if (!draft) return
    setBusy(true)
    const res = await setMyWeeklyGoals(draft)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setError(null)
    const r = await fetchMyWeeklyGoals()
    if (r.data) setWeekly(r.data)
    const thisWeek = r.data && !r.data.next
    setSavedMsg(thisWeek ? 'Сохранено — действуют с этой недели' : `Сохранено — новые цели с понедельника ${res.validFrom ? dayMonth(res.validFrom) : ''}`.trim())
  }

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

      <section className="stu-card stu-set" data-testid="student-weekly-goals">
        <h2 className="stu-set-h"><CalendarCheck size={18} aria-hidden />Цели недели</h2>
        <p className="stu-muted text-[13.5px]">
          Выбери 1–3 цели и число. Повторяются каждую неделю (пн–вс), пока не поменяешь; изменения — со следующего понедельника.
          Цели видит твой преподаватель.
        </p>
        {weekly == null || draft == null ? (
          <p className="stu-muted flex items-center gap-2 text-[14px]"><Loader2 size={14} className="animate-spin" />Загрузка…</p>
        ) : (
          <>
            {weekly.goals.length > 0 && (
              <div className="stu-set-rows" data-testid="student-weekly-progress">
                {weekly.goals.map(g => (
                  <div key={g.kind} className="stu-set-row" data-testid="student-weekly-goal">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-semibold">{weeklyGoalTitle(g.kind, g.target)}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="stu-step-t flex-1"><i className="d" style={{ width: `${Math.min(100, (g.progress / g.target) * 100)}%` }} /></span>
                        <span className={g.done ? 'stu-tag t-green' : 'stu-muted text-[13px] font-semibold'}>{g.done ? 'выполнено' : weeklyProgressLabel(g)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="stu-goal-form" data-testid="student-weekly-editor">
              <WeeklyGoalsEditor value={draft} onChange={v => { setDraft(v); setSavedMsg(null) }} disabled={busy} />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="stu-btn stu-btn-p stu-btn-sm"
                  disabled={busy || WEEKLY_KINDS.every(k => draft[k] === (weekly.next?.nums ?? weekly.current ?? NO_GOALS)[k])}
                  onClick={() => void saveWeekly()}
                  data-testid="student-weekly-save"
                >
                  Сохранить цели
                </button>
                {(savedMsg || weekly.next) && (
                  <span className="stu-muted text-[13px]" data-testid="student-weekly-next">
                    {savedMsg ?? `Новые цели — с понедельника ${dayMonth(weekly.next!.validFrom)}`}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </section>
      {error && <p className="text-[13px] font-semibold text-[var(--redInk)]" role="alert">{error}</p>}
    </div>
  )
}
