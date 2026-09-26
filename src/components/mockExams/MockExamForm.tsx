import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Check, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { useAuthStore } from '@/store/authStore'
import { useMockExamTemplates } from '@/hooks/useMockExamTemplates'
import { useMockExamGroups } from '@/hooks/useMockExamGroups'
import { useMockExamSetup } from '@/hooks/useMockExamSetup'
import { createMockExams } from '@/lib/mockExamCreate'
import { MOCK_EXAMS_BUCKET, parseKeyPaste, startNoticeWarning } from '@/lib/mockExamLesson'
import { fileNameFromStoragePath } from '@/lib/storage'
import { plural } from '@/lib/plural'
import {
  DURATION_PRESETS, assignProblems, durationLabel, mskMoment, mskParts, readiness, studentTimeline,
} from '@/lib/mockExamV3'
import { cn } from '@/utils/cn'

/**
 * §228. Форма «Новый пробник» — одна вместо прежних `CreateMockExamModal`
 * (§218) и `MockExamSetupPage` (§221): название, шаблон, группы, дата, начало
 * по Москве, длительность, условие и решение, ключ первой части. Справа —
 * «Как увидят ученики»: таймлайн по тем же правилам, что у триггера
 * напоминаний §224, и чек-лист готовности; главная кнопка «Назначить
 * пробник», тихая «Сохранить черновиком» (черновик = без времени начала,
 * ученикам не виден).
 *
 * Та же форма — вкладка «Настройка» существующего пробника (`examId`): группа
 * одна, сменить её можно, пока у пробника нет работ и баллов (защита — в
 * базе, §228), файлы грузятся сразу, ключ сохраняется вместе с формой.
 */

type Mode = { kind: 'create'; defaultGroupId?: string | null } | { kind: 'edit'; examId: string; onSaved?: () => void }

export function MockExamForm(props: { mode: Mode }) {
  if (props.mode.kind === 'edit') return <EditForm examId={props.mode.examId} onSaved={props.mode.onSaved} />
  return <CreateForm defaultGroupId={props.mode.defaultGroupId ?? null} />
}

/* ─────────────────────────────── Создание ─────────────────────────────── */

function CreateForm({ defaultGroupId }: { defaultGroupId: string | null }) {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const { templates, loading: tplLoading } = useMockExamTemplates(true)
  const { groups, loading: grLoading } = useMockExamGroups()
  const [picked, setPicked] = useState<string[]>(defaultGroupId ? [defaultGroupId] : [])
  const [condition, setCondition] = useState<File | null>(null)
  const [solution, setSolution] = useState<File | null>(null)
  const f = useFormState({ title: '', templateId: '', date: '', time: '10:00', duration: DURATION_PRESETS[0], key: null })
  const [busy, setBusy] = useState<'assign' | 'draft' | null>(null)
  const [status, setStatus] = useState<{ kind: 'error' | 'warn' | 'ok'; text: string } | null>(null)

  // Шаблон один на школу чаще всего — подставляем первый, как только список пришёл.
  useEffect(() => {
    if (!f.templateId && templates.length > 0) f.setTemplateId(templates[0].id)
  }, [templates, f])

  const template = templates.find(t => t.id === f.templateId) ?? null
  const chosen = groups.filter(g => picked.includes(g.id))

  async function submit(draft: boolean) {
    setStatus(null)
    const problems = assignProblems({ title: f.title, templateId: f.templateId, groups: chosen.length, startsIso: f.startsIso, draft, durationOk: f.durationOk })
    if (problems.length) { setStatus({ kind: 'error', text: problems.join('. ') + '.' }); return }
    if (!template || !profile) return
    setBusy(draft ? 'draft' : 'assign')
    const res = await createMockExams({
      title: f.title, template, groups: chosen.map(g => ({ id: g.id, name: g.name })),
      startsAt: draft ? null : f.startsIso,
      plannedAt: f.plannedIso,
      durationMinutes: f.duration,
      condition, solution, key: f.keyValues(template.part1_last), profileId: profile.id,
    })
    setBusy(null)
    if (res.error) { setStatus({ kind: 'error', text: `Не создано: ${res.error}` }); return }
    const warning = draft ? null : startNoticeWarning(f.startsIso, f.nowMs)
    navigate(`/mock-exams/${res.created[0].id}`, {
      state: { created: res.created, problems: res.problems, warning, draft },
    })
  }

  if (tplLoading || grLoading) return <Loading />

  return (
    <FormLayout
      testid="mock-form-create"
      fields={(
        <>
          <TitleTemplate f={f} templates={templates} templateLocked={false} />
          <Field label="Группа" as="div">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Группы" data-testid="mock-form-groups">
              {groups.length === 0 && <span className="text-sm text-graphite-500">Групп нет — пробник проводится у группы курса.</span>}
              {groups.map(g => (
                <Chip key={g.id} pressed={picked.includes(g.id)} testid="mock-form-group-chip"
                  onClick={() => setPicked(p => (p.includes(g.id) ? p.filter(x => x !== g.id) : [...p, g.id]))}>
                  {picked.includes(g.id) && <Check size={13} aria-hidden />}{g.name}
                  {g.count != null && <span className="font-medium text-graphite-400">{g.count}</span>}
                </Chip>
              ))}
            </div>
            <Hint>
              Пробник появится у группы в меню «Пробники» и в разделе «Пробники» её курса. Отметили несколько групп — у
              каждой будет свой пробник с общими файлами и ключом. Группу можно сменить, пока нет баллов.
            </Hint>
          </Field>
          <WhenFields f={f} warning={startNoticeWarning(f.startsIso, f.nowMs)} />
          <Field label="Файлы" as="div">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <LocalDrop label="Условие" hint="ученик видит с начала пробника" file={condition} onPick={setCondition} kind="condition" />
              <LocalDrop label="Решение" hint="ученик видит после проверки; можно позже" file={solution} onPick={setSolution} kind="solution" />
            </div>
          </Field>
          <KeyField f={f} n={template?.part1_last ?? 0} />
        </>
      )}
      aside={(
        <SummaryCard
          groupNames={chosen.map(g => g.name)}
          f={f}
          ready={readiness({
            groups: chosen.length, startsIso: f.startsIso, hasCondition: !!condition, hasSolution: !!solution,
            keyFilled: f.keyFilled(template?.part1_last ?? 0), keyTotal: template?.part1_last ?? 0,
          })}
          primary={{ label: chosen.length > 1 ? `Назначить пробник · ${chosen.length} ${plural(chosen.length, 'группа', 'группы', 'групп')}` : 'Назначить пробник', onClick: () => submit(false), busy: busy === 'assign' }}
          quiet={{ label: 'Сохранить черновиком', onClick: () => submit(true), busy: busy === 'draft' }}
          disabled={busy != null}
          status={status}
        />
      )}
    />
  )
}

/* ─────────────────────────── Настройка (правка) ───────────────────────── */

function EditForm({ examId, onSaved }: { examId: string; onSaved?: () => void }) {
  const { exam, key, hasScores, hasWork, loading, error, saveSettings, uploadFile, saveKey } = useMockExamSetup(examId)
  const { templates } = useMockExamTemplates(true)
  if (loading) return <Loading />
  if (error || !exam) {
    return <p className="flex items-start gap-2 rounded-lg bg-verdict-part-tint px-3 py-2 text-sm text-verdict-part-ink"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error || 'Пробник не найден'}</p>
  }
  return (
    <EditFormLoaded key={exam.id} exam={exam} savedKey={key} hasScores={hasScores} hasWork={hasWork} templates={templates}
      onSave={saveSettings} onUpload={uploadFile} onSaveKey={saveKey} onSaved={onSaved} />
  )
}

type SetupHook = ReturnType<typeof useMockExamSetup>

function EditFormLoaded({ exam, savedKey, hasScores, hasWork, templates, onSave, onUpload, onSaveKey, onSaved }: {
  exam: NonNullable<SetupHook['exam']>
  savedKey: (string | null)[] | null
  hasScores: boolean
  hasWork: boolean
  templates: ReturnType<typeof useMockExamTemplates>['templates']
  onSave: SetupHook['saveSettings']
  onUpload: SetupHook['uploadFile']
  onSaveKey: SetupHook['saveKey']
  onSaved?: () => void
}) {
  const planned = mskParts(exam.starts_at ?? plannedDate(exam.date))
  const f = useFormState({
    title: exam.title, templateId: exam.template_id ?? '', date: planned.date, time: planned.time || '10:00',
    duration: exam.duration_minutes, key: savedKey,
  })
  const { groups } = useMockExamGroups(exam.group_id ? { id: exam.group_id, name: exam.groupName ?? 'группа' } : null)
  const [groupId, setGroupId] = useState(exam.group_id ?? '')
  const [busy, setBusy] = useState<'assign' | 'draft' | null>(null)
  const [status, setStatus] = useState<{ kind: 'error' | 'warn' | 'ok'; text: string } | null>(null)
  const template = templates.find(t => t.id === f.templateId) ?? exam.template
  const n = template?.part1_last ?? 0
  const savedStart = exam.starts_at ? Date.parse(exam.starts_at) : null
  const startChanged = (f.startsIso ? Date.parse(f.startsIso) : null) !== savedStart
  const scheduled = !!exam.starts_at
  const notStarted = !exam.starts_at || Date.parse(exam.starts_at) > f.nowMs
  const groupName = groups.find(g => g.id === groupId)?.name ?? exam.groupName

  async function submit(draft: boolean) {
    setStatus(null)
    const problems = assignProblems({ title: f.title, templateId: f.templateId, groups: groupId ? 1 : 0, startsIso: f.startsIso, draft, durationOk: f.durationOk })
    if (problems.length) { setStatus({ kind: 'error', text: problems.join('. ') + '.' }); return }
    const newStart = draft ? null : f.startsIso
    // §224.2: предупреждение — только о НОВОМ времени; после сохранения оно переезжает в статус.
    const warning = !draft && startChanged ? startNoticeWarning(newStart, Date.now()) : null
    setBusy(draft ? 'draft' : 'assign')
    const r = await onSave({
      title: f.title, starts_at: newStart, duration_minutes: f.duration,
      template_id: f.templateId || null, date: f.plannedIso,
      ...(groupId && groupId !== exam.group_id ? { group_id: groupId } : {}),
    })
    if (r.error) { setBusy(null); setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); return }
    let keyNote = ''
    if (f.keyDirty(n)) {
      const k = await onSaveKey(f.keyValues(n))
      if (k.error) keyNote = ` Ключ не сохранён: ${k.error}.`
      else {
        if (k.changed > 0) keyNote += ` Перепроверено по ключу клеток: ${k.changed}.`
        if (k.notCheckable.length) keyNote += ` Не поддаются автопроверке: ${k.notCheckable.map(x => `№${x}`).join(', ')} — их поставите при проверке.`
        f.markKeySaved()
      }
    }
    setBusy(null)
    const head = draft ? 'Сохранено черновиком — ученики пробник не видят.' : 'Сохранено.'
    setStatus({ kind: warning || keyNote.includes('не сохранён') ? 'warn' : 'ok', text: `${head}${warning ? ` ${warning}` : ''}${keyNote}` })
    onSaved?.()
  }

  return (
    <FormLayout
      testid="mock-form-edit"
      fields={(
        <>
          <TitleTemplate f={f} templates={templates} templateLocked={hasScores} />
          <Field label="Группа" as="div">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Группа" data-testid="mock-form-groups">
              {groups.map(g => (
                <Chip key={g.id} pressed={groupId === g.id} testid="mock-form-group-chip" role="radio"
                  disabled={hasWork && g.id !== groupId} onClick={() => setGroupId(g.id)}>
                  {groupId === g.id && <Check size={13} aria-hidden />}{g.name}
                  {g.count != null && <span className="font-medium text-graphite-400">{g.count}</span>}
                </Chip>
              ))}
            </div>
            <Hint testid="mock-form-group-hint">
              {hasWork
                ? 'У пробника уже есть работы или баллы — группу не сменить. Для другой группы заведите новый пробник.'
                : `Появится у группы ${groupName ?? ''} в меню «Пробники» и в разделе «Пробники» её курса. Группу можно сменить, пока нет баллов.`}
            </Hint>
          </Field>
          <WhenFields f={f} warning={startChanged ? startNoticeWarning(f.startsIso, f.nowMs) : null} />
          <Field label="Файлы" as="div">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <StoredDrop label="Условие" hint="ученик видит с начала пробника" path={exam.condition_path} kind="condition" onUpload={onUpload} />
              <StoredDrop label="Решение" hint="ученик видит после проверки; можно позже" path={exam.solution_path} kind="solution" onUpload={onUpload} />
            </div>
          </Field>
          <KeyField f={f} n={n} />
        </>
      )}
      aside={(
        <SummaryCard
          groupNames={groupName ? [groupName] : []}
          grace={exam.photo_grace_minutes}
          f={f}
          ready={readiness({
            groups: groupId ? 1 : 0, startsIso: f.startsIso, hasCondition: !!exam.condition_path, hasSolution: !!exam.solution_path,
            keyFilled: f.keyFilled(n), keyTotal: n,
          })}
          primary={{ label: scheduled ? 'Сохранить изменения' : 'Назначить пробник', onClick: () => submit(false), busy: busy === 'assign' }}
          quiet={!scheduled || notStarted ? { label: scheduled ? 'Снять с расписания — в черновик' : 'Сохранить черновиком', onClick: () => submit(true), busy: busy === 'draft' } : null}
          disabled={busy != null}
          status={status}
        />
      )}
    />
  )
}

/** У черновика в `date` — задуманный момент; у старых пробников там полночь, её временем не считаем. */
function plannedDate(date: string | null): string | null {
  if (!date) return null
  const p = mskParts(date)
  return p.time === '00:00' || p.time === '03:00' ? mskMoment(p.date, '10:00') : date
}

/* ─────────────────────────────── Состояние ─────────────────────────────── */

interface FormInit { title: string; templateId: string; date: string; time: string; duration: number; key: (string | null)[] | null }

function useFormState(init: FormInit) {
  const [title, setTitle] = useState(init.title)
  const [templateId, setTemplateId] = useState(init.templateId)
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [duration, setDuration] = useState(init.duration)
  const [customDuration, setCustomDuration] = useState(!(DURATION_PRESETS as readonly number[]).includes(init.duration))
  const [key, setKey] = useState<string[]>(() => (init.key ?? []).map(v => v ?? ''))
  const [keySaved, setKeySaved] = useState<string[]>(() => (init.key ?? []).map(v => v ?? ''))
  const [keyNote, setKeyNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  // Часы для предупреждения §224.2: «на сейчас» становится прошедшим, пока заполняют остальное.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const startsIso = mskMoment(date, time)
  return useMemo(() => ({
    title, setTitle, templateId, setTemplateId, date, setDate, time, setTime,
    duration, setDuration, customDuration, setCustomDuration, nowMs,
    startsIso,
    plannedIso: startsIso ?? (date ? mskMoment(date, '10:00') : null),
    durationOk: Number.isInteger(duration) && duration >= 10 && duration <= 720,
    key, keyNote, setKeyNote,
    setKeyAt(i: number, v: string) { setKey(prev => { const nx = prev.slice(); nx[i] = v; return nx }) },
    pasteKey(at: number, answers: string[], n: number) {
      setKey(prev => {
        const nx = Array.from({ length: n }, (_, i) => prev[i] ?? '')
        answers.forEach((a, k) => { if (at + k < n) nx[at + k] = a })
        return nx
      })
    },
    keyValues(n: number) { return Array.from({ length: n }, (_, i) => (key[i] ?? '').trim()) },
    keyFilled(n: number) { return Array.from({ length: n }, (_, i) => key[i] ?? '').filter(v => v.trim()).length },
    keyDirty(n: number) { return Array.from({ length: n }, (_, i) => (key[i] ?? '').trim() !== (keySaved[i] ?? '').trim()).some(Boolean) },
    markKeySaved() { setKeySaved(key.slice()) },
  }), [title, templateId, date, time, duration, customDuration, nowMs, startsIso, key, keySaved, keyNote])
}

type FormState = ReturnType<typeof useFormState>

/* ─────────────────────────────── Раскладка ─────────────────────────────── */

function FormLayout({ fields, aside, testid }: { fields: ReactNode; aside: ReactNode; testid: string }) {
  return (
    <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_330px]" data-testid={testid}>
      <div className="flex min-w-0 flex-col gap-5 rounded-card bg-white p-4 shadow-card sm:p-6" data-testid="mock-form">{fields}</div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4">{aside}</aside>
    </div>
  )
}

function Field({ label, htmlFor, children, as = 'label' }: { label: string; htmlFor?: string; children: ReactNode; as?: 'label' | 'div' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {as === 'label'
        ? <label htmlFor={htmlFor} className="text-[13px] font-semibold text-graphite-500">{label}</label>
        : <span className="text-[13px] font-semibold text-graphite-500">{label}</span>}
      {children}
    </div>
  )
}

function Hint({ children, testid }: { children: ReactNode; testid?: string }) {
  return <span className="text-[13px] leading-snug text-graphite-500 sm:text-xs" data-testid={testid}>{children}</span>
}

const inputCls = 'h-12 w-full min-w-0 rounded-lg border-[1.5px] border-graphite-300 bg-white px-3 text-base font-medium text-graphite-900 focus:border-primary-600 focus:outline-none sm:h-10 sm:text-[15px] disabled:bg-graphite-50 disabled:text-graphite-500'

function Chip({ pressed, onClick, children, testid, disabled, role }: { pressed: boolean; onClick: () => void; children: ReactNode; testid?: string; disabled?: boolean; role?: string }) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : pressed}
      aria-checked={role ? pressed : undefined}
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors sm:min-h-9',
        pressed ? 'border-primary-600 bg-primary-50 text-primary-600' : 'border-graphite-300 bg-white text-graphite-900 hover:border-primary-500',
        'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-gold-300',
      )}
    >
      {children}
    </button>
  )
}

function TitleTemplate({ f, templates, templateLocked }: { f: FormState; templates: ReturnType<typeof useMockExamTemplates>['templates']; templateLocked: boolean }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <Field label="Название" htmlFor="mx-title">
        <input id="mx-title" className={inputCls} value={f.title} onChange={e => f.setTitle(e.target.value)} placeholder="Пробник №4" data-testid="mock-form-title" />
      </Field>
      <Field label="Шаблон" htmlFor="mx-tpl">
        <select id="mx-tpl" className={inputCls} value={f.templateId} onChange={e => f.setTemplateId(e.target.value)} disabled={templateLocked} data-testid="mock-form-template">
          {templates.length === 0 && <option value="">Шаблонов нет — заведите на странице «Шаблоны»</option>}
          {!f.templateId && templates.length > 0 && <option value="">— шаблон</option>}
          {templates.map(t => <option key={t.id} value={t.id}>{t.title} · {t.max_points.length} заданий</option>)}
        </select>
        {templateLocked && <Hint>Баллы уже введены — шаблон не меняется.</Hint>}
      </Field>
    </div>
  )
}

function WhenFields({ f, warning }: { f: FormState; warning: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,1.3fr)]">
        <Field label="Дата" htmlFor="mx-date">
          <input id="mx-date" type="date" className={inputCls} value={f.date} onChange={e => f.setDate(e.target.value)} data-testid="mock-form-date" />
        </Field>
        <Field label="Начало (МСК)" htmlFor="mx-time">
          <input id="mx-time" type="time" className={inputCls} value={f.time} onChange={e => f.setTime(e.target.value)} data-testid="mock-form-time" />
        </Field>
        <Field label="Длительность" as="div">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Длительность">
            {DURATION_PRESETS.map(m => (
              <Chip key={m} pressed={!f.customDuration && f.duration === m} testid="mock-form-duration-chip"
                onClick={() => { f.setCustomDuration(false); f.setDuration(m) }}>{durationLabel(m)}</Chip>
            ))}
            <Chip pressed={f.customDuration} testid="mock-form-duration-chip" onClick={() => f.setCustomDuration(true)}>своё</Chip>
            {f.customDuration && (
              <span className="inline-flex items-center gap-1.5">
                <input type="number" min={10} max={720} step={5} aria-label="Длительность, минут" className={cn(inputCls, 'w-24')}
                  value={f.duration} onChange={e => f.setDuration(Number(e.target.value))} data-testid="mock-form-duration" />
                <span className="text-sm text-graphite-500">мин</span>
              </span>
            )}
          </div>
        </Field>
      </div>
      {warning && (
        <p role="status" data-testid="mock-form-start-warning" className="flex items-start gap-1.5 rounded-lg bg-verdict-part-tint px-3 py-2 text-sm text-verdict-part-ink">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />{warning}
        </p>
      )}
    </div>
  )
}

function KeyField({ f, n }: { f: FormState; n: number }) {
  const first = useRef<HTMLInputElement | null>(null)
  if (!n) {
    return (
      <Field label="Ключ первой части" as="div">
        <Hint>Сначала выберите шаблон — по нему видно, сколько заданий в первой части.</Hint>
      </Field>
    )
  }
  function apply(text: string, at: number): boolean {
    const parsed = parseKeyPaste(text, n - at)
    if (!parsed) return false
    f.pasteKey(at, parsed.answers, n)
    f.setKeyNote(parsed.extra > 0
      ? { kind: 'warn', text: `Вставлено с №${at + 1}; лишние ${parsed.extra} ${plural(parsed.extra, 'значение', 'значения', 'значений')} отброшены — полей всего ${n}.` }
      : { kind: 'ok', text: `Вставлено с №${at + 1}.` })
    return true
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>, at: number) {
    if (apply(e.clipboardData?.getData('text') ?? '', at)) e.preventDefault()
  }
  async function pasteButton() {
    // Буфер обмена браузер может не отдать без жеста или разрешения — тогда курсор в №1 и подсказка.
    try {
      const text = await navigator.clipboard?.readText?.()
      if (text && apply(text, 0)) return
    } catch { /* нет доступа к буферу */ }
    first.current?.focus()
    f.setKeyNote({ kind: 'ok', text: 'Курсор в поле №1 — нажмите Ctrl + V: строка или столбец из Excel разложится по полям.' })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-graphite-500">Ключ первой части</span>
        <button type="button" onClick={pasteButton} data-testid="mock-form-key-paste"
          className="min-h-11 px-1.5 text-sm font-semibold text-primary-600 hover:underline sm:min-h-0">Вставить строку из Excel</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-12">
        {Array.from({ length: n }, (_, i) => (
          <label key={i} className={cn('flex h-12 flex-col items-center justify-center rounded-lg border-[1.5px] bg-white px-1 focus-within:border-primary-600',
            (f.key[i] ?? '').trim() ? 'border-graphite-300' : 'border-dashed border-graphite-300')}>
            <span className="font-mono text-[10px] leading-none text-graphite-400">№{i + 1}</span>
            <input ref={i === 0 ? first : undefined} value={f.key[i] ?? ''} onChange={e => f.setKeyAt(i, e.target.value)}
              onPaste={e => onPaste(e, i)} maxLength={40} autoComplete="off" placeholder="—" aria-label={`Ответ ключа на задание ${i + 1}`}
              data-testid="mock-form-key-input"
              className="w-full min-w-0 border-0 bg-transparent p-0 text-center font-mono text-sm font-semibold text-graphite-900 placeholder:text-graphite-400 focus:outline-none" />
          </label>
        ))}
      </div>
      <Hint>«0,75», «0.75» и « 0,75 » считаются одним ответом. Пустое поле — задание проверите вручную. Ученик ключ не видит до проверки.</Hint>
      {f.keyNote && <span role="status" data-testid="mock-form-key-status" className={cn('text-sm', f.keyNote.kind === 'warn' ? 'text-verdict-part-ink' : 'text-verdict-ok-ink')}>{f.keyNote.text}</span>}
    </div>
  )
}

/** Файл, выбранный в форме «Новый пробник»: грузится после создания пробников. */
function LocalDrop({ label, hint, file, onPick, kind }: { label: string; hint: string; file: File | null; onPick: (f: File | null) => void; kind: string }) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <DropShell done={!!file} kind={kind} onFile={x => { if (!isPdf(x)) { setErr('Нужен PDF'); return } setErr(null); onPick(x) }}>
      <b className="text-sm text-graphite-900">{label}</b>
      {file
        ? <span className="block truncate text-[13px] text-graphite-500">{file.name} · {sizeLabel(file.size)}</span>
        : <span className="block text-[13px] font-semibold text-primary-600">Загрузить или перетащить</span>}
      <span className="block text-xs text-graphite-500">{hint}</span>
      {err && <span className="block text-xs text-verdict-bad-ink" role="alert">{err}</span>}
    </DropShell>
  )
}

/** Файл существующего пробника: грузится сразу, путь — в пробнике. */
function StoredDrop({ label, hint, path, kind, onUpload }: { label: string; hint: string; path: string | null; kind: 'condition' | 'solution'; onUpload: SetupHook['uploadFile'] }) {
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const name = path ? fileNameFromStoragePath(path).replace(/^\d+_/, '') : null
  async function go(file: File) {
    setErr(null); setPct(0)
    const r = await onUpload(kind, file, p => setPct(p))
    setPct(null)
    if (r.error) setErr(r.error)
  }
  return (
    <DropShell done={!!path} kind={kind} onFile={go} busy={pct != null}>
      <b className="text-sm text-graphite-900">{label}</b>
      {pct != null ? <span className="inline-flex items-center gap-1 text-[13px] text-graphite-500"><Loader2 size={12} className="animate-spin" />{pct}%</span>
        : path && name ? (
          <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={path} className="block truncate text-[13px] text-primary-600 hover:underline">
            <FileText size={12} className="mr-1 inline" aria-hidden />{name}
          </SignedFileLink>
        ) : <span className="block text-[13px] font-semibold text-primary-600">Загрузить или перетащить</span>}
      <span className="block text-xs text-graphite-500">{hint}{path ? ' · заменить — выбрать другой файл' : ''}</span>
      {err && <span className="block text-xs text-verdict-bad-ink" role="alert">{err}</span>}
    </DropShell>
  )
}

function DropShell({ done, kind, onFile, busy, children }: { done: boolean; kind: string; onFile: (f: File) => void; busy?: boolean; children: ReactNode }) {
  const [drag, setDrag] = useState(false)
  return (
    <label
      className={cn('flex cursor-pointer items-center gap-3 rounded-[14px] border-[1.5px] p-3.5',
        done ? 'border-solid border-[#bfe3c7] bg-[#f5fcf6]' : 'border-dashed border-graphite-300 bg-[#fbfcff]',
        drag && 'border-primary-600 bg-primary-50')}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const x = e.dataTransfer.files?.[0]; if (x && !busy) onFile(x) }}
      data-testid={`mock-form-file-${kind}`}
    >
      <span className={cn('grid h-[46px] w-[38px] shrink-0 place-items-center rounded-md font-mono text-[11px] font-bold',
        done ? 'bg-verdict-ok-tint text-verdict-ok' : 'bg-primary-50 text-primary-600')} aria-hidden>PDF</span>
      <span className="min-w-0 flex-1">{children}</span>
      <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy}
        onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; if (x) onFile(x) }} data-testid={`mock-form-file-input-${kind}`} />
    </label>
  )
}

function SummaryCard({ groupNames, f, ready, primary, quiet, disabled, status, grace = 15 }: {
  groupNames: string[]
  grace?: number
  f: FormState
  ready: ReturnType<typeof readiness>
  primary: { label: string; onClick: () => void; busy: boolean }
  quiet: { label: string; onClick: () => void; busy: boolean } | null
  disabled: boolean
  status: { kind: 'error' | 'warn' | 'ok'; text: string } | null
}) {
  const items = studentTimeline(f.startsIso, f.duration, grace, f.nowMs)
  const who = groupNames.length === 0 ? 'группы' : joinNames(groupNames)
  return (
    <div className="flex flex-col gap-3.5 rounded-card bg-white p-4 shadow-card sm:p-6" data-testid="mock-form-summary">
      <h3 className="text-base font-bold text-graphite-900">Как увидят ученики {who}</h3>
      <ol className="flex flex-col" data-testid="mock-form-timeline">
        {items.map((it, i) => (
          <li key={it.key} data-key={it.key} data-skipped={it.skipped ? true : undefined}
            className="relative grid grid-cols-[64px_18px_minmax(0,1fr)] items-start gap-2 pb-3">
            <span className={cn('font-mono text-[13px] font-semibold', it.skipped ? 'text-graphite-400 line-through' : 'text-graphite-900')}>{it.at}</span>
            <span className={cn('mt-[5px] h-2.5 w-2.5 rounded-full shadow-[0_0_0_4px_#eef3ff]', it.key === 'after' ? 'bg-gold-300' : it.skipped ? 'bg-graphite-300' : 'bg-primary-600')} aria-hidden />
            <span className="text-sm text-graphite-900">
              {it.text}
              {it.skipped && <span className="block text-[13px] text-verdict-part-ink sm:text-xs">{it.skipped}</span>}
            </span>
            {i < items.length - 1 && <span className="absolute bottom-0 left-[76px] top-[18px] w-0.5 bg-graphite-200" aria-hidden />}
          </li>
        ))}
      </ol>
      <ul className="flex flex-col gap-1.5" data-testid="mock-form-ready">
        {ready.map(r => (
          <li key={r.text} className="flex items-center gap-2 text-sm" data-state={r.state}>
            <VerdictMark state={r.state === 'ok' ? 'ok' : r.state === 'todo' ? 'unk' : 'none'} size={18} label={null} />
            <span className={r.state === 'ok' ? 'text-graphite-900' : 'text-graphite-500'}>{r.text}</span>
          </li>
        ))}
      </ul>
      <Button onClick={primary.onClick} loading={primary.busy} disabled={disabled} className="min-h-12 w-full sm:min-h-[46px]" data-testid="mock-form-assign">{primary.label}</Button>
      {quiet && (
        <button type="button" onClick={quiet.onClick} disabled={disabled} data-testid="mock-form-draft"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 self-center px-2 text-sm font-semibold text-primary-600 hover:underline disabled:opacity-50 sm:min-h-8">
          {quiet.busy && <Loader2 size={14} className="animate-spin" aria-hidden />}{quiet.label}
        </button>
      )}
      {status && (
        <p role="status" data-testid="mock-form-status"
          className={cn('rounded-lg px-3 py-2 text-sm', status.kind === 'error' ? 'bg-verdict-bad-tint text-verdict-bad-ink' : status.kind === 'warn' ? 'bg-verdict-part-tint text-verdict-part-ink' : 'bg-verdict-ok-tint text-verdict-ok-ink')}>
          {status.text}
        </p>
      )}
    </div>
  )
}

function Loading() {
  return <div className="flex h-40 items-center justify-center gap-2 text-graphite-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}

function isPdf(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}
