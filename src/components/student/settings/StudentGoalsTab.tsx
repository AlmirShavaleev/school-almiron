import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Loader2, Pencil, Target, Trash2 } from 'lucide-react'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import {
  EXAM_PRESETS, KIND_LABEL, SUBJECT_ACC, SUBJECT_LABEL,
  deleteRegularGoal, fetchGoalTopics, fetchMyExamGoals, fetchMyRegularGoals, goalProgressLabel, goalTitle,
  saveRegularGoal, setMyExamGoal,
  type ExamGoal, type GoalDraft, type GoalKind, type GoalSubject, type RegularGoal,
} from '@/lib/studentGoals'

/**
 * «Настройки → Учебные цели» (письмо ЛК_стиль_настройки_ученика.md, 16.10;
 * два уровня — решение владельца 16.10, заменяет вариант «цель-тема»).
 *
 *  · Цель на экзамен по каждому предмету своих курсов ЕГЭ: 60+ / 70+ / 80+ /
 *    90+ / свой балл (`set_my_exam_goal`).
 *  · Цели недели — повторяются каждую неделю, пока не поменяешь: по номерам
 *    ЕГЭ, темы курса (1–3), задачи в тренировке, дни занятий.
 *
 * Прежние поля «Экзамен / Предмет / Целевой балл» (students.target_*) отсюда
 * убраны: цель на экзамен теперь одна — `student_exam_goals`.
 */
const EMPTY: GoalDraft = { id: null, kind: 'numbers', subject: null, numbers: [], topicIds: [], target: 10 }
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
  const [goals, setGoals] = useState<RegularGoal[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState<Partial<Record<GoalSubject, string>>>({})
  const [topics, setTopics] = useState<Array<{ id: string; title: string; moduleTitle: string }> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMyExamGoals(profileId).then(g => { if (!cancelled) setExam(g) })
    fetchMyRegularGoals().then(r => { if (!cancelled) { setGoals(r.goals); setLoadError(r.error) } })
    return () => { cancelled = true }
  }, [profileId])

  useEffect(() => {
    if (draft?.kind !== 'topics' || topics) return
    let cancelled = false
    fetchGoalTopics().then(t => { if (!cancelled) setTopics(t) })
    return () => { cancelled = true }
  }, [draft?.kind, topics])

  async function pickExam(subject: GoalSubject, goal: number | null) {
    if (goal != null && (goal < 1 || goal > 100)) { setError('Балл — от 1 до 100'); return }
    setBusy(true)
    const res = await setMyExamGoal(subject, goal)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setError(null)
    setExam(prev => [...(prev ?? []).filter(g => g.subject !== subject), ...(goal != null ? [{ subject, goal }] : [])])
  }

  async function reload() {
    const r = await fetchMyRegularGoals()
    setGoals(r.goals); setLoadError(r.error)
  }

  async function saveDraft() {
    if (!draft) return
    setBusy(true)
    const res = await saveRegularGoal(draft)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setError(null); setDraft(null); void reload()
  }

  async function remove(id: string) {
    setBusy(true)
    const res = await deleteRegularGoal(id)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setGoals(prev => (prev ?? []).filter(g => g.id !== id))
  }

  const canSave = !!draft && (
    draft.kind === 'numbers' ? !!draft.subject && draft.numbers.length > 0 && draft.target > 0
    : draft.kind === 'topics' ? draft.topicIds.length > 0
    : draft.kind === 'days' ? draft.target >= 1 && draft.target <= 7
    : draft.target > 0
  )

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
        <p className="stu-muted text-[13.5px]">Повторяются каждую неделю, пока не поменяешь. Прогресс — с понедельника.</p>
        {goals == null ? (
          <p className="stu-muted flex items-center gap-2 text-[14px]"><Loader2 size={14} className="animate-spin" />Загрузка…</p>
        ) : loadError ? (
          <p className="text-[14px] text-[var(--redInk)]" data-testid="student-goals-error">{loadError}</p>
        ) : (
          <div className="stu-set-rows">
            {goals.length === 0 && <p className="stu-muted py-2 text-[14px]">Целей пока нет — добавь первую.</p>}
            {goals.map(g => (
              <div key={g.id} className="stu-set-row" data-testid="student-weekly-goal">
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold">{goalTitle(g)}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="stu-step-t flex-1"><i className="d" style={{ width: `${Math.min(100, (g.progress / g.target) * 100)}%` }} /></span>
                    <span className={g.done ? 'stu-tag t-green' : 'stu-muted text-[13px] font-semibold'}>{g.done ? 'выполнено' : goalProgressLabel(g)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="stu-icon-btn" aria-label="Изменить цель" disabled={busy}
                    onClick={() => setDraft({ id: g.id, kind: g.kind, subject: g.subject, numbers: g.numbers, topicIds: g.topicIds, target: g.target })}><Pencil size={15} /></button>
                  <button type="button" className="stu-icon-btn" aria-label="Удалить цель" disabled={busy} onClick={() => void remove(g.id)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {draft ? (
          <div className="stu-goal-form" data-testid="student-goal-form">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Тип цели">
              {(Object.keys(KIND_LABEL) as GoalKind[]).map(k => (
                <button key={k} type="button" className={btn(draft.kind === k)} aria-pressed={draft.kind === k}
                  onClick={() => setDraft({ ...EMPTY, id: draft.id, kind: k, subject: draft.subject ?? subjects[0] ?? null, target: k === 'days' ? 4 : k === 'tasks' ? 30 : 10 })}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>

            {(draft.kind === 'numbers' || draft.kind === 'tasks') && subjects.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="stu-muted text-[13.5px]">Предмет</span>
                {draft.kind === 'tasks' && <button type="button" className={btn(draft.subject == null)} onClick={() => setDraft({ ...draft, subject: null })}>любой</button>}
                {subjects.map(s => (
                  <button key={s} type="button" className={btn(draft.subject === s)} aria-pressed={draft.subject === s} onClick={() => setDraft({ ...draft, subject: s })}>{SUBJECT_LABEL[s]}</button>
                ))}
              </div>
            )}

            {draft.kind === 'numbers' && (
              <div>
                <p className="stu-muted mb-1 text-[13.5px]">Номера заданий (до 5)</p>
                <div className="stu-num-grid" role="group" aria-label="Номера заданий">
                  {Array.from({ length: 27 }, (_, i) => i + 1).map(n => {
                    const on = draft.numbers.includes(n)
                    return (
                      <button key={n} type="button" className={btn(on)} aria-pressed={on}
                        disabled={!on && draft.numbers.length >= 5}
                        onClick={() => setDraft({ ...draft, numbers: on ? draft.numbers.filter(x => x !== n) : [...draft.numbers, n].sort((a, b) => a - b) })}>{n}</button>
                    )
                  })}
                </div>
              </div>
            )}

            {draft.kind === 'topics' && (
              <div>
                <p className="stu-muted mb-1 text-[13.5px]">Темы курса (1–3) — из открытых сейчас уроков</p>
                {topics == null ? <p className="stu-muted text-[14px]">Загрузка тем…</p>
                  : topics.length === 0 ? <p className="stu-muted text-[14px]">Открытых уроков пока нет.</p>
                  : (
                    <div className="stu-topic-pick" role="group" aria-label="Темы">
                      {topics.map(t => {
                        const on = draft.topicIds.includes(t.id)
                        return (
                          <button key={t.id} type="button" className={btn(on)} aria-pressed={on} disabled={!on && draft.topicIds.length >= 3}
                            onClick={() => setDraft({ ...draft, topicIds: on ? draft.topicIds.filter(x => x !== t.id) : [...draft.topicIds, t.id] })}>
                            <span className="block text-left">{t.title}<span className="stu-muted block text-[12px] font-medium">{t.moduleTitle}</span></span>
                          </button>
                        )
                      })}
                    </div>
                  )}
              </div>
            )}

            {draft.kind === 'days' && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Дней в неделю">
                <span className="stu-muted text-[13.5px]">Дней в неделю</span>
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <button key={n} type="button" className={btn(draft.target === n)} aria-pressed={draft.target === n} onClick={() => setDraft({ ...draft, target: n })}>{n}</button>
                ))}
              </div>
            )}

            {(draft.kind === 'numbers' || draft.kind === 'tasks') && (
              <label className="flex items-center gap-2 text-[14px]">
                <span className="stu-muted">Сколько задач за неделю</span>
                <input className="stu-input w-20" inputMode="numeric" value={draft.target || ''} aria-label="Сколько задач"
                  onChange={e => setDraft({ ...draft, target: Math.min(500, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="stu-btn stu-btn-p stu-btn-sm" disabled={!canSave || busy} onClick={() => void saveDraft()} data-testid="student-goal-save">
                {draft.id ? 'Сохранить' : 'Добавить цель'}
              </button>
              <button type="button" className="stu-sub-quiet" onClick={() => setDraft(null)}>Отмена</button>
            </div>
          </div>
        ) : (
          goals != null && !loadError && goals.length < 6 && (
            <button type="button" className="stu-btn stu-btn-g stu-btn-sm self-start" onClick={() => setDraft({ ...EMPTY, subject: subjects[0] ?? null })} data-testid="student-goal-add">
              + Добавить цель недели
            </button>
          )
        )}
      </section>

      {error && <p className="text-[13px] font-semibold text-[var(--redInk)]" role="alert">{error}</p>}
    </div>
  )
}
