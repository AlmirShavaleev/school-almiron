import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Check, FileText, Loader2, Lock, Pencil, Plus, Shuffle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { useAuthStore } from '@/store/authStore'
import { useMockExamTemplates } from '@/hooks/useMockExamTemplates'
import { useMockExamGroups } from '@/hooks/useMockExamGroups'
import { useMockExamSetup } from '@/hooks/useMockExamSetup'
import { useMockExamVariants, type VariantItem } from '@/hooks/useMockExamVariants'
import { useGroupRosters } from '@/hooks/useGroupRosters'
import { createMockExams } from '@/lib/mockExamCreate'
import { MOCK_EXAMS_BUCKET, parseKeyPaste, startNoticeWarning } from '@/lib/mockExamLesson'
import { fileNameFromStoragePath } from '@/lib/storage'
import { plural } from '@/lib/plural'
import {
  DURATION_PRESETS, assignProblems, durationLabel, mskMoment, mskParts, readiness, studentTimeline,
} from '@/lib/mockExamV3'
import {
  FILE_KIND_LABEL, MAX_VARIANTS, VARIANT_LABEL_MAX, VARIANT_MODES, distributeVariants, missingConditions, studentsLabel, variantCountLabel,
  variantCounts, variantName,
  type RosterStudent, type VariantFileKind, type VariantMode, type VariantReady,
} from '@/lib/mockExamVariants'
import { cn } from '@/utils/cn'

/**
 * §228. Форма «Новый пробник» — одна вместо прежних `CreateMockExamModal`
 * (§218) и `MockExamSetupPage` (§221): название, шаблон, группы, дата, начало
 * по Москве, длительность, файлы, ключ первой части. Справа — «Как увидят
 * ученики»: таймлайн по тем же правилам, что у триггера напоминаний §224, и
 * чек-лист готовности; главная кнопка «Назначить пробник», тихая «Сохранить
 * черновиком» (черновик = без времени начала, ученикам не виден).
 *
 * §229. «Варианты и файлы» (экран 5 макета): «Один вариант / Несколько», у
 * каждого варианта условие (обязательно), решение и критерии («можно
 * позже»), ключ первой части; «Кому какой вариант» — по очереди, случайно
 * или вручную. Несколько групп — варианты и файлы у каждого пробника свои
 * копии, раздача внутри каждой группы.
 *
 * Та же форма — вкладка «Настройка» существующего пробника (`examId`): группа
 * одна, сменить её можно, пока у пробника нет работ и баллов (защита — в
 * базе, §228), файлы грузятся сразу — в любой момент, и после экзамена
 * («Добавить/заменить решение», «…критерии»), ключи и раздача сохраняются
 * вместе с формой.
 */

type Mode = { kind: 'create'; defaultGroupId?: string | null } | { kind: 'edit'; examId: string; onSaved?: () => void }

export function MockExamForm(props: { mode: Mode }) {
  if (props.mode.kind === 'edit') return <EditForm examId={props.mode.examId} onSaved={props.mode.onSaved} />
  return <CreateForm defaultGroupId={props.mode.defaultGroupId ?? null} />
}

/** Файлы варианта в форме создания — пока только выбраны, грузятся после «Назначить». */
interface DraftVariant { condition: File | null; solution: File | null; criteria: File | null; key: string[]; label: string }
const emptyDraft = (): DraftVariant => ({ condition: null, solution: null, criteria: null, key: [], label: '' })

/** Повторяемая «случайная» раздача: пока не нажали «Перемешать», таблица не прыгает. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hashOf = (s: string) => Array.from(s).reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7)

const keyFilled = (key: (string | null)[] | null | undefined, n: number) =>
  Array.from({ length: n }, (_, i) => key?.[i] ?? '').filter(v => (v ?? '').trim()).length
const keyValues = (key: (string | null)[] | null | undefined, n: number) =>
  Array.from({ length: n }, (_, i) => (key?.[i] ?? '').trim())

/** §230. Имя варианта по номеру — «Резерв» или «Вариант 3». */
const namesOf = (vs: { position: number; label?: string | null }[]): Record<number, string> =>
  Object.fromEntries(vs.map(v => [v.position, variantName(v)]))
/** Подпись из имени: «Вариант 3» у третьего — это не подпись. */
const labelOnly = (name: string | undefined, p: number): string | null => (name && name !== `Вариант ${p}` ? name : null)

/* ─────────────────────────────── Создание ─────────────────────────────── */

function CreateForm({ defaultGroupId }: { defaultGroupId: string | null }) {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const { templates, loading: tplLoading } = useMockExamTemplates(true)
  const { groups, loading: grLoading } = useMockExamGroups()
  const [picked, setPicked] = useState<string[]>(defaultGroupId ? [defaultGroupId] : [])
  const [drafts, setDrafts] = useState<DraftVariant[]>([emptyDraft()])
  const [multi, setMulti] = useState(false)
  const [vMode, setVMode] = useState<VariantMode>('order')
  const [seed, setSeed] = useState(1)
  const [manual, setManual] = useState<Record<string, Record<string, number>>>({})
  const [openVariant, setOpenVariant] = useState(0)
  const f = useFormState({ title: '', templateId: '', date: '', time: '10:00', duration: DURATION_PRESETS[0] })
  const [busy, setBusy] = useState<'assign' | 'draft' | null>(null)
  const [status, setStatus] = useState<{ kind: 'error' | 'warn' | 'ok'; text: string } | null>(null)

  // Шаблон один на школу чаще всего — подставляем первый, как только список пришёл.
  useEffect(() => {
    if (!f.templateId && templates.length > 0) f.setTemplateId(templates[0].id)
  }, [templates, f])

  const template = templates.find(t => t.id === f.templateId) ?? null
  const n = template?.part1_last ?? 0
  const chosen = groups.filter(g => picked.includes(g.id))
  const shown = multi ? drafts : drafts.slice(0, 1)
  const positions = shown.map((_, k) => k + 1)
  const { rosters } = useGroupRosters(multi ? picked : [])

  // Раздача по группам: по выбранному способу; «Вручную» — как поправили.
  const chosenKey = picked.slice().sort().join(',')
  const nVariants = shown.length
  // Считается заново на каждый рендер: учеников десятки, а «случайно» повторяемо (seed).
  const assignments: Record<string, Record<string, number>> = {}
  if (multi && chosenKey) {
    const pos = Array.from({ length: nVariants }, (_, k) => k + 1)
    for (const gid of chosenKey.split(',')) {
      assignments[gid] = distributeVariants(rosters[gid] ?? [], pos, vMode, { current: manual[gid], rng: seeded(seed + hashOf(gid)) })
    }
  }

  const ready: VariantReady[] = shown.map((d, k) => ({
    position: k + 1, label: d.label, hasCondition: !!d.condition, hasSolution: !!d.solution, hasCriteria: !!d.criteria,
    keyFilled: keyFilled(d.key, n), keyTotal: n,
  }))

  function patchDraft(k: number, patch: Partial<DraftVariant>) {
    setDrafts(prev => prev.map((d, i) => (i === k ? { ...d, ...patch } : d)))
  }
  function setMultiOn(on: boolean) {
    setMulti(on)
    if (on && drafts.length < 2) setDrafts(prev => [...prev, emptyDraft()])
    if (!on) setOpenVariant(0)
  }

  async function submit(draft: boolean) {
    setStatus(null)
    const problems = assignProblems({
      title: f.title, templateId: f.templateId, groups: chosen.length, startsIso: f.startsIso, draft, durationOk: f.durationOk,
      missingCondition: multi ? missingConditions(ready) : [],
      variantNames: namesOf(ready),
    })
    if (problems.length) { setStatus({ kind: 'error', text: problems.join('. ') + '.' }); return }
    if (!template || !profile) return
    setBusy(draft ? 'draft' : 'assign')
    const res = await createMockExams({
      title: f.title, template, groups: chosen.map(g => ({ id: g.id, name: g.name })),
      startsAt: draft ? null : f.startsIso,
      plannedAt: f.plannedIso,
      durationMinutes: f.duration,
      variants: shown.map(d => ({ condition: d.condition, solution: d.solution, criteria: d.criteria, key: keyValues(d.key, n), label: d.label })),
      variantMode: vMode,
      assignments,
      profileId: profile.id,
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
              каждой будет свой пробник с теми же вариантами, файлами и ключами. Группу можно сменить, пока нет баллов.
            </Hint>
          </Field>
          <WhenFields f={f} warning={startNoticeWarning(f.startsIso, f.nowMs)} />
        </>
      )}
      below={(
        <>
          <VariantsCard
            multi={multi}
            onMulti={setMultiOn}
            canSingle
            count={shown.length}
            onAdd={shown.length < MAX_VARIANTS ? () => { setDrafts(prev => [...prev, emptyDraft()]); setOpenVariant(shown.length) } : undefined}
            laterNote
          >
            {shown.map((d, k) => (
              <VariantCard
                key={k}
                position={k + 1}
                label={d.label}
                onLabel={label => patchDraft(k, { label })}
                multi={multi}
                open={!multi || openVariant === k}
                onOpen={() => setOpenVariant(k)}
                students={multi ? chosen.reduce((a, g) => a + Object.values(assignments[g.id] ?? {}).filter(p => p === k + 1).length, 0) : null}
                onRemove={multi && k > 0 && k === shown.length - 1 && shown.length > 2 ? () => { setDrafts(prev => prev.slice(0, -1)); setOpenVariant(0) } : undefined}
                slots={(['condition', 'solution', 'criteria'] as const).map(kind => (
                  <FileSlot key={kind} kind={kind} position={k + 1} multi={multi}
                    local={d[kind]} onPick={file => patchDraft(k, { [kind]: file })} />
                ))}
                keyTotal={n}
                keyFilledCount={keyFilled(d.key, n)}
                keyField={<KeyField n={n} values={d.key} onChange={v => patchDraft(k, { key: v })} />}
              />
            ))}
          </VariantsCard>
          {multi && (
            <DistributionCard
              groups={chosen.map(g => ({ id: g.id, name: g.name, roster: rosters[g.id] ?? [] }))}
              positions={positions}
              names={namesOf(ready)}
              mode={vMode}
              onMode={m => { setVMode(m); setManual({}); if (m === 'random') setSeed(s => s + 1) }}
              onShuffle={vMode === 'random' ? () => setSeed(s => s + 1) : undefined}
              assign={assignments}
              locked={{}}
              onSet={(gid, sid, pos) => { setManual(prev => ({ ...prev, [gid]: { ...assignments[gid], [sid]: pos } })); setVMode('manual') }}
            />
          )}
        </>
      )}
      aside={(
        <SummaryCard
          groupNames={chosen.map(g => g.name)}
          f={f}
          variants={shown.length}
          ready={readiness({
            groups: chosen.length, startsIso: f.startsIso, hasCondition: !!shown[0].condition, hasSolution: !!shown[0].solution,
            keyFilled: keyFilled(shown[0].key, n), keyTotal: n, variants: ready,
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
  const { exam, key, hasScores, hasWork, loading, error, saveSettings } = useMockExamSetup(examId)
  const { templates } = useMockExamTemplates(true)
  const variants = useMockExamVariants(exam, key)
  if (loading || (exam && variants.loading)) return <Loading />
  if (error || !exam) {
    return <p className="flex items-start gap-2 rounded-lg bg-verdict-part-tint px-3 py-2 text-sm text-verdict-part-ink"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error || 'Пробник не найден'}</p>
  }
  return (
    <EditFormLoaded key={exam.id} exam={exam} hasScores={hasScores} hasWork={hasWork} templates={templates}
      onSave={saveSettings} variants={variants} onSaved={onSaved} />
  )
}

type SetupHook = ReturnType<typeof useMockExamSetup>
type VariantsHook = ReturnType<typeof useMockExamVariants>

function EditFormLoaded({ exam, hasScores, hasWork, templates, onSave, variants: vh, onSaved }: {
  exam: NonNullable<SetupHook['exam']>
  hasScores: boolean
  hasWork: boolean
  templates: ReturnType<typeof useMockExamTemplates>['templates']
  onSave: SetupHook['saveSettings']
  variants: VariantsHook
  onSaved?: () => void
}) {
  const planned = mskParts(exam.starts_at ?? plannedDate(exam.date))
  const f = useFormState({
    title: exam.title, templateId: exam.template_id ?? '', date: planned.date, time: planned.time || '10:00',
    duration: exam.duration_minutes,
  })
  const { groups } = useMockExamGroups(exam.group_id ? { id: exam.group_id, name: exam.groupName ?? 'группа' } : null)
  const [groupId, setGroupId] = useState(exam.group_id ?? '')
  const [busy, setBusy] = useState<'assign' | 'draft' | null>(null)
  const [status, setStatus] = useState<{ kind: 'error' | 'warn' | 'ok'; text: string } | null>(null)
  const [vBusy, setVBusy] = useState<string | null>(null)
  const [openVariant, setOpenVariant] = useState(0)
  const template = templates.find(t => t.id === f.templateId) ?? exam.template
  const n = template?.part1_last ?? 0
  const savedStart = exam.starts_at ? Date.parse(exam.starts_at) : null
  const startChanged = (f.startsIso ? Date.parse(f.startsIso) : null) !== savedStart
  const scheduled = !!exam.starts_at
  const notStarted = !exam.starts_at || Date.parse(exam.starts_at) > f.nowMs
  const groupName = groups.find(g => g.id === groupId)?.name ?? exam.groupName

  const items = vh.variants
  const multi = items.length > 1
  const positions = items.map(v => v.position)
  const posKey = positions.join(',')

  // Ключи — черновики по номеру варианта: файлы грузятся сразу и перечитывают
  // варианты, а недописанный ключ при этом теряться не должен.
  const [keys, setKeys] = useState<Record<number, string[]>>({})
  const savedKey = (v: VariantItem) => keyValues(v.key, n)
  const keyOf = (v: VariantItem) => keys[v.position] ?? savedKey(v)
  const keyDirty = (v: VariantItem) => keys[v.position] != null && keyValues(keys[v.position], n).some((x, i) => x !== savedKey(v)[i])

  // Раздача. Пока не трогали — как в базе (кому не выдано — по выбранному
  // способу); нажали способ или поменяли ученику — черновик.
  const { rosters } = useGroupRosters(multi && groupId ? [groupId] : [])
  const roster: RosterStudent[] = rosters[groupId] ?? []
  const firstPos = Math.min(...positions)
  const lockedPos: Record<string, number> = {}
  for (const s of roster) if (vh.locked.has(s.id)) lockedPos[s.id] = vh.assigned[s.id] ?? firstPos
  const [vMode, setVMode] = useState<VariantMode>(vh.mode)
  /** Черновик раздачи — для того набора вариантов, при котором его сделали. */
  const [draft, setDraft] = useState<{ pos: string; assign: Record<string, number> } | null>(null)
  const [seed, setSeed] = useState(1)
  // Набор вариантов, с которым вкладка открылась. Добавили или убрали вариант —
  // раскладка «с нуля» тем же способом (кроме уже открывших), пока не тронули руками.
  const [openedPos] = useState(posKey)
  const shownAssign = draft && draft.pos === posKey ? draft.assign
    : posKey !== openedPos ? distributeVariants(roster, positions, vMode === 'manual' ? 'order' : vMode, { locked: lockedPos, rng: seeded(seed) })
      : distributeVariants(roster, positions, 'manual', { locked: lockedPos, current: vh.assigned })
  const setDraftAssign = (assign: Record<string, number> | null) => setDraft(assign ? { pos: posKey, assign } : null)
  const assignDirty = roster.some(s => !vh.locked.has(s.id) && shownAssign[s.id] != null && shownAssign[s.id] !== vh.assigned[s.id])

  const counts = variantCounts(shownAssign, positions)
  const ready: VariantReady[] = items.map(v => ({
    position: v.position, label: v.label, hasCondition: !!v.condition_path, hasSolution: !!v.solution_path, hasCriteria: !!v.criteria_path,
    keyFilled: keyFilled(keyOf(v), n), keyTotal: n,
  }))

  async function submit(draft: boolean) {
    setStatus(null)
    const problems = assignProblems({
      title: f.title, templateId: f.templateId, groups: groupId ? 1 : 0, startsIso: f.startsIso, draft, durationOk: f.durationOk,
      missingCondition: multi ? missingConditions(ready) : [],
      variantNames: namesOf(ready),
    })
    if (problems.length) { setStatus({ kind: 'error', text: problems.join('. ') + '.' }); return }
    const newStart = draft ? null : f.startsIso
    // §224.2: предупреждение — только о НОВОМ времени; после сохранения оно переезжает в статус.
    const warning = !draft && startChanged ? startNoticeWarning(newStart, Date.now()) : null
    setBusy(draft ? 'draft' : 'assign')
    const r = await onSave({
      title: f.title, starts_at: newStart, duration_minutes: f.duration,
      template_id: f.templateId || null, date: f.plannedIso,
      ...(groupId && groupId !== exam.group_id ? { group_id: groupId } : {}),
      ...(multi && vMode !== vh.mode && !vh.unavailable ? { variant_mode: vMode } : {}),
    })
    if (r.error) { setBusy(null); setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); return }
    let note = ''
    for (const v of items) {
      if (!keyDirty(v)) continue
      const k = await vh.saveKey(v, keyValues(keys[v.position], n))
      const who = multi ? ` (${variantName(v)})` : ''
      if (k.error) { note += ` Ключ${who} не сохранён: ${k.error}.`; continue }
      if (k.changed > 0) note += ` Перепроверено по ключу${who} клеток: ${k.changed}.`
      if (k.notCheckable.length) note += ` Не поддаются автопроверке${who}: ${k.notCheckable.map(x => `№${x}`).join(', ')} — их поставите при проверке.`
      setKeys(prev => { const nx = { ...prev }; delete nx[v.position]; return nx })
    }
    if (multi && (assignDirty || (groupId !== exam.group_id))) {
      const a = await vh.saveAssignments(shownAssign)
      if (a.error) note += ` Раздача вариантов не сохранена: ${a.error}.`
      else if (a.changed > 0) { note += ` Варианты выданы: ${a.changed} ${plural(a.changed, 'ученику', 'ученикам', 'ученикам')}.`; setDraftAssign(null) }
    }
    setBusy(null)
    const head = draft ? 'Сохранено черновиком — ученики пробник не видят.' : 'Сохранено.'
    setStatus({ kind: warning || note.includes('не сохранен') ? 'warn' : 'ok', text: `${head}${warning ? ` ${warning}` : ''}${note}` })
    vh.reload()
    onSaved?.()
  }

  async function variantAction(label: string, run: () => Promise<{ error: string | null }>) {
    setVBusy(label)
    setStatus(null)
    const r = await run()
    setVBusy(null)
    if (r.error) setStatus({ kind: 'error', text: r.error })
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
        </>
      )}
      below={(
        <>
          <VariantsCard
            multi={multi}
            onMulti={on => { if (on && !multi) void variantAction('add', vh.addVariant) }}
            canSingle={!multi}
            count={items.length}
            busy={vBusy === 'add'}
            unavailable={vh.unavailable}
            onAdd={!vh.unavailable && items.length < MAX_VARIANTS ? () => { setOpenVariant(items.length); void variantAction('add', vh.addVariant) } : undefined}
          >
            {items.map((v, k) => (
              <VariantCard
                key={v.id ?? `legacy-${v.position}`}
                position={v.position}
                label={v.label}
                onRename={v.id ? label => vh.renameVariant(v, label) : undefined}
                multi={multi}
                open={!multi || openVariant === k}
                onOpen={() => setOpenVariant(k)}
                students={multi ? counts[v.position] ?? 0 : null}
                onRemove={multi && v.id && k === items.length - 1 && !roster.some(s => vh.locked.has(s.id) && (lockedPos[s.id] === v.position))
                  ? () => void variantAction('remove', () => vh.removeVariant(v)) : undefined}
                slots={(['condition', 'solution', 'criteria'] as const).map(kind => (
                  <FileSlot key={kind} kind={kind} position={v.position} multi={multi} stored
                    path={v[`${kind}_path`]} onUpload={(file, onP) => vh.uploadFile(v, kind, file, onP)}
                    disabled={kind === 'criteria' && vh.unavailable} />
                ))}
                keyTotal={n}
                keyFilledCount={keyFilled(keyOf(v), n)}
                keyField={<KeyField n={n} values={keyOf(v)} onChange={vals => setKeys(prev => ({ ...prev, [v.position]: vals }))} />}
              />
            ))}
          </VariantsCard>
          {multi && (
            <DistributionCard
              groups={[{ id: groupId, name: groupName ?? 'группа', roster }]}
              positions={positions}
              names={namesOf(ready)}
              mode={vMode}
              onMode={m => {
                setVMode(m)
                if (m !== 'manual') { const nextSeed = seed + 1; setSeed(nextSeed); setDraftAssign(distributeVariants(roster, positions, m, { locked: lockedPos, rng: seeded(nextSeed) })) }
              }}
              onShuffle={vMode === 'random' ? () => { const nextSeed = seed + 1; setSeed(nextSeed); setDraftAssign(distributeVariants(roster, positions, 'random', { locked: lockedPos, rng: seeded(nextSeed) })) } : undefined}
              assign={{ [groupId]: shownAssign }}
              locked={{ [groupId]: vh.locked }}
              onSet={(_g, sid, pos) => { setDraftAssign({ ...shownAssign, [sid]: pos }); setVMode('manual') }}
              dirty={assignDirty}
            />
          )}
        </>
      )}
      aside={(
        <SummaryCard
          groupNames={groupName ? [groupName] : []}
          grace={exam.photo_grace_minutes}
          f={f}
          variants={items.length}
          ready={readiness({
            groups: groupId ? 1 : 0, startsIso: f.startsIso, hasCondition: !!items[0]?.condition_path, hasSolution: !!items[0]?.solution_path,
            keyFilled: keyFilled(items[0] ? keyOf(items[0]) : null, n), keyTotal: n, variants: ready,
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

interface FormInit { title: string; templateId: string; date: string; time: string; duration: number }

function useFormState(init: FormInit) {
  const [title, setTitle] = useState(init.title)
  const [templateId, setTemplateId] = useState(init.templateId)
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [duration, setDuration] = useState(init.duration)
  const [customDuration, setCustomDuration] = useState(!(DURATION_PRESETS as readonly number[]).includes(init.duration))
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
  }), [title, templateId, date, time, duration, customDuration, nowMs, startsIso])
}

type FormState = ReturnType<typeof useFormState>

/* ─────────────────────────────── Раскладка ─────────────────────────────── */

function FormLayout({ fields, below, aside, testid }: { fields: ReactNode; below?: ReactNode; aside: ReactNode; testid: string }) {
  return (
    <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_330px]" data-testid={testid}>
      <div className="flex min-w-0 flex-col gap-[18px]">
        <div className="flex min-w-0 flex-col gap-5 rounded-card bg-white p-4 shadow-card sm:p-6" data-testid="mock-form">{fields}</div>
        {below}
      </div>
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

/** Сегмент «таблетками» (`.seg` макета): один выбранный из нескольких. */
function Segmented<T extends string>({ value, options, onChange, label, testid, className }: {
  value: T
  options: { key: T; label: ReactNode; aria?: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  label: string
  testid?: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testid} className={cn('inline-flex flex-wrap gap-0.5 rounded-[22px] bg-primary-50 p-[3px]', className)}>
      {options.map(o => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} aria-label={o.aria} disabled={o.disabled} title={o.title}
          onClick={() => onChange(o.key)} data-key={o.key}
          className={cn('min-h-10 rounded-full px-3.5 text-[13px] font-semibold sm:min-h-8',
            value === o.key ? 'bg-white text-graphite-900 shadow-[0_2px_6px_rgba(18,35,74,.08)]' : 'text-graphite-500 hover:text-graphite-900',
            'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-gold-300')}>
          {o.label}
        </button>
      ))}
    </div>
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

/* ─────────────────────────── §229. Варианты и файлы ───────────────────── */

function VariantsCard({ multi, onMulti, canSingle, count, onAdd, busy, laterNote, unavailable, children }: {
  multi: boolean
  onMulti: (on: boolean) => void
  /** Можно ли вернуться к одному варианту (в правке — только когда он и так один). */
  canSingle: boolean
  count: number
  onAdd?: () => void
  busy?: boolean
  laterNote?: boolean
  unavailable?: boolean
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-card bg-white p-4 shadow-card sm:p-6" data-testid="mock-form-variants" aria-labelledby="mx-variants-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="mx-variants-h" className="text-xl font-bold text-graphite-900">Варианты и файлы</h2>
        <Segmented
          label="Сколько вариантов"
          testid="mock-form-variant-count"
          value={multi ? 'multi' : 'single'}
          onChange={v => onMulti(v === 'multi')}
          options={[
            { key: 'single', label: 'Один вариант', disabled: !canSingle && multi, title: !canSingle && multi ? 'Чтобы вернуться к одному варианту, уберите лишние (кнопка «Убрать вариант» у последнего)' : undefined },
            { key: 'multi', label: multi ? `Несколько · ${count}` : 'Несколько', disabled: unavailable },
          ]}
        />
      </div>
      {unavailable && <Hint>Несколько вариантов появятся после обновления базы. Пока у пробника один вариант — как раньше.</Hint>}
      {children}
      {multi && onAdd && (
        <button type="button" onClick={onAdd} disabled={busy} data-testid="mock-form-variant-add"
          className="inline-flex min-h-11 items-center gap-1.5 self-start px-1.5 text-sm font-semibold text-primary-600 hover:underline disabled:opacity-50 sm:min-h-8">
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={15} aria-hidden />}Добавить вариант
        </button>
      )}
      {laterNote && (
        <p className="border-l-[3px] border-gold-300 pl-3 text-[13px] leading-snug text-graphite-500 sm:text-xs">
          <b className="text-graphite-900">Решение и критерии — можно позже.</b> На странице пробника во вкладке «Настройка» у каждого
          варианта остаются «Добавить решение» и «Добавить критерии» — в любой момент, даже после экзамена. Решение ученик увидит после
          проверки; критерии видите только вы — они открываются рядом с номером на экране проверки.
        </p>
      )}
    </section>
  )
}

function VariantCard({ position, label, onLabel, onRename, multi, open, onOpen, students, onRemove, slots, keyTotal, keyFilledCount, keyField }: {
  position: number
  label?: string | null
  /** §230. Подпись в форме создания — черновик, уходит вместе с «Назначить». */
  onLabel?: (label: string) => void
  /** §230. Подпись у существующего пробника — сохраняется сразу (уход из поля или Enter). */
  onRename?: (label: string) => Promise<{ error: string | null }>
  multi: boolean
  open: boolean
  onOpen: () => void
  students: number | null
  onRemove?: () => void
  slots: ReactNode
  keyTotal: number
  keyFilledCount: number
  keyField: ReactNode
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-2xl bg-white', multi && 'border-[1.5px] p-3.5 sm:p-4', multi && (open ? 'border-primary-200 shadow-[0_0_0_3px_#eef3ff]' : 'border-graphite-200'))}
      data-testid="mock-form-variant" data-position={position} data-open={open || undefined}
    >
      {multi && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {onLabel || onRename
            ? <VariantLabelField position={position} value={label ?? ''} onChange={onLabel} onCommit={onRename} />
            : <span className="rounded-full bg-gold-300 px-3 py-0.5 text-[13px] font-extrabold text-graphite-900">{variantName({ position, label })}</span>}
          <span className="flex items-center gap-3">
            {students != null && <span className="text-xs text-graphite-500" data-testid="mock-form-variant-students">{studentsLabel(students)}</span>}
            {onRemove && (
              <button type="button" onClick={onRemove} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-graphite-500 hover:text-verdict-bad-ink" data-testid="mock-form-variant-remove">
                <Trash2 size={13} aria-hidden />Убрать вариант
              </button>
            )}
          </span>
        </div>
      )}
      <div className="grid gap-2.5 md:grid-cols-3">{slots}</div>
      {open ? keyField : (
        <button type="button" onClick={onOpen} className="self-start text-left text-sm text-graphite-500 hover:text-primary-600" data-testid="mock-form-variant-key-summary">
          Ключ: {keyFilledCount} из {keyTotal}{keyTotal > 0 && keyFilledCount === keyTotal ? ' ✓' : ''} · <span className="font-semibold text-primary-600">изменить</span>
        </button>
      )}
    </div>
  )
}

/**
 * §230. Подпись варианта: жёлтая метка-поле («Вариант А», «Резерв»). Пусто —
 * «Вариант N» (подсказка в поле). В форме создания — черновик; у
 * существующего пробника сохраняется сразу: уход из поля или Enter, Esc —
 * вернуть как было. Ученик видит подпись в шапке пробника, учитель — везде,
 * где раньше стояло «Вариант N».
 */
function VariantLabelField({ position, value, onChange, onCommit }: {
  position: number
  value: string
  onChange?: (v: string) => void
  onCommit?: (v: string) => Promise<{ error: string | null }>
}) {
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<{ kind: 'saving' | 'saved' | 'error'; text?: string } | null>(null)
  // Сохранённое изменилось снаружи (перечитали варианты) — поле за ним, пока его не правят.
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setDraft(value) }
  const placeholder = `Вариант ${position}`
  const shown = onCommit ? draft : value
  const width = Math.min(Math.max((shown || placeholder).length, 6), 28) + 2

  async function commit() {
    if (!onCommit) return
    const clean = draft.replace(/\s+/g, ' ').trim()
    if (clean === value.trim()) { setDraft(value); return }
    setState({ kind: 'saving' })
    const r = await onCommit(clean)
    if (r.error) { setState({ kind: 'error', text: r.error }); return }
    setState({ kind: 'saved' })
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="group relative inline-flex min-w-0 items-center rounded-full bg-gold-300 focus-within:ring-[3px] focus-within:ring-gold-200">
        <input
          value={shown}
          onChange={e => { const v = e.target.value.slice(0, VARIANT_LABEL_MAX); if (onCommit) { setDraft(v); setState(null) } else onChange?.(v) }}
          onBlur={() => { void commit() }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur() }
            if (e.key === 'Escape' && onCommit) { e.preventDefault(); setDraft(value); setState(null) }
          }}
          maxLength={VARIANT_LABEL_MAX}
          placeholder={placeholder}
          aria-label={`Подпись варианта ${position}`}
          title="Подпись видят ученики этого варианта. Пусто — «Вариант N»."
          size={width}
          data-testid="mock-form-variant-label"
          className="h-9 min-w-0 max-w-full rounded-full border-0 bg-transparent py-0 pl-3 pr-8 text-[13px] font-extrabold text-graphite-900 placeholder:text-graphite-900 focus:outline-none sm:h-7"
        />
        <Pencil size={12} className="pointer-events-none absolute right-3 text-graphite-700" aria-hidden />
      </span>
      {state?.kind === 'saving' && <Loader2 size={13} className="animate-spin text-graphite-400" aria-label="сохраняется" />}
      {state?.kind === 'saved' && <span className="text-xs text-verdict-ok-ink" role="status" data-testid="mock-form-variant-label-status">сохранено</span>}
      {state?.kind === 'error' && <span className="text-xs text-verdict-bad-ink" role="alert" data-testid="mock-form-variant-label-status">{state.text}</span>}
    </span>
  )
}

const SLOT_HINT: Record<VariantFileKind, { need: string; who: string }> = {
  condition: { need: 'обязательно', who: 'ученик видит с начала' },
  solution: { need: 'можно позже', who: 'ученик видит после проверки' },
  criteria: { need: 'можно позже', who: 'только вам при проверке' },
}

/**
 * Файл варианта. В форме создания — выбран и ждёт «Назначить» (`local`); у
 * существующего пробника (`stored`) грузится сразу: «Добавить…», а если файл
 * уже есть — «Заменить…», в любой момент, и после экзамена.
 */
function FileSlot({ kind, position, multi, local, onPick, stored, path, onUpload, disabled }: {
  kind: VariantFileKind
  position: number
  multi: boolean
  local?: File | null
  onPick?: (f: File | null) => void
  stored?: boolean
  path?: string | null
  onUpload?: (file: File, onProgress: (p: number) => void) => Promise<{ error: string | null }>
  disabled?: boolean
}) {
  const [drag, setDrag] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const done = stored ? !!path : !!local
  const name = stored ? (path ? fileNameFromStoragePath(path).replace(/^\d+_/, '') : null) : local?.name ?? null
  const hint = SLOT_HINT[kind]
  const noun = kind === 'condition' ? 'условие' : kind === 'solution' ? 'решение' : 'критерии'
  const action = stored ? `${done ? 'Заменить' : 'Добавить'} ${noun}` : done ? 'Заменить' : 'Загрузить'

  async function take(file: File) {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setErr('Нужен PDF'); return }
    setErr(null)
    if (!stored) { onPick?.(file); return }
    setPct(0)
    const r = await onUpload!(file, p => setPct(p))
    setPct(null)
    if (r.error) setErr(r.error)
  }

  return (
    <label
      className={cn('flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-xl border-[1.5px] px-3 py-2.5',
        done ? 'border-solid border-[#bfe3c7] bg-[#f5fcf6]' : 'border-dashed border-graphite-300 bg-[#fbfcff]',
        drag && 'border-primary-600 bg-primary-50', disabled && 'cursor-not-allowed opacity-50')}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const x = e.dataTransfer.files?.[0]; if (x && pct == null && !disabled) void take(x) }}
      data-testid={`mock-form-file-${kind}`}
      data-variant={position}
      data-done={done || undefined}
    >
      <b className="flex items-center gap-1.5 text-[13px] text-graphite-900">
        <span className={cn('grid h-5 w-4 shrink-0 place-items-center rounded-[3px] font-mono text-[8px] font-bold', done ? 'bg-verdict-ok-tint text-verdict-ok' : 'bg-primary-50 text-primary-600')} aria-hidden>PDF</span>
        {FILE_KIND_LABEL[kind]}{done && <Check size={13} className="text-verdict-ok" aria-label="загружено" />}
      </b>
      {pct != null ? <span className="inline-flex items-center gap-1 text-xs text-graphite-500"><Loader2 size={12} className="animate-spin" />{pct}%</span>
        : done && name ? (
          stored && path
            ? <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={path} className="block truncate text-xs text-primary-600 hover:underline"><FileText size={11} className="mr-1 inline" aria-hidden />{name}</SignedFileLink>
            : <span className="block truncate text-xs text-graphite-500">{name}{local ? ` · ${sizeLabel(local.size)}` : ''}</span>
        ) : null}
      <span className="text-[13px] font-semibold text-primary-600 sm:text-xs" data-testid={`mock-form-file-action-${kind}`}>{action}</span>
      <span className="text-xs leading-snug text-graphite-500">{hint.need} · {hint.who}</span>
      {kind === 'condition' && multi && !done && <span className="text-xs font-semibold text-verdict-bad-ink">без условия не назначить</span>}
      {err && <span className="text-xs text-verdict-bad-ink" role="alert">{err}</span>}
      <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={pct != null || disabled}
        aria-label={`${FILE_KIND_LABEL[kind]}${multi ? `, вариант ${position}` : ''} — PDF`}
        onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void take(x) }} data-testid={`mock-form-file-input-${kind}`} />
    </label>
  )
}

function KeyField({ n, values, onChange }: { n: number; values: string[]; onChange: (v: string[]) => void }) {
  const first = useRef<HTMLInputElement | null>(null)
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  if (!n) {
    return (
      <Field label="Ключ первой части" as="div">
        <Hint>Сначала выберите шаблон — по нему видно, сколько заданий в первой части.</Hint>
      </Field>
    )
  }
  const at = (i: number) => values[i] ?? ''
  function setAt(i: number, v: string) {
    const nx = Array.from({ length: n }, (_, k) => at(k))
    nx[i] = v
    onChange(nx)
  }
  function apply(text: string, from: number): boolean {
    const parsed = parseKeyPaste(text, n - from)
    if (!parsed) return false
    const nx = Array.from({ length: n }, (_, k) => at(k))
    parsed.answers.forEach((a, k) => { if (from + k < n) nx[from + k] = a })
    onChange(nx)
    setNote(parsed.extra > 0
      ? { kind: 'warn', text: `Вставлено с №${from + 1}; лишние ${parsed.extra} ${plural(parsed.extra, 'значение', 'значения', 'значений')} отброшены — полей всего ${n}.` }
      : { kind: 'ok', text: `Вставлено с №${from + 1}.` })
    return true
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>, i: number) {
    if (apply(e.clipboardData?.getData('text') ?? '', i)) e.preventDefault()
  }
  async function pasteButton() {
    // Буфер обмена браузер может не отдать без жеста или разрешения — тогда курсор в №1 и подсказка.
    try {
      const text = await navigator.clipboard?.readText?.()
      if (text && apply(text, 0)) return
    } catch { /* нет доступа к буферу */ }
    first.current?.focus()
    setNote({ kind: 'ok', text: 'Курсор в поле №1 — нажмите Ctrl + V: строка или столбец из Excel разложится по полям.' })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-graphite-500">Ключ первой части</span>
        <button type="button" onClick={pasteButton} data-testid="mock-form-key-paste"
          className="min-h-11 px-1.5 text-sm font-semibold text-primary-600 hover:underline sm:min-h-0">Вставить строку из Excel</button>
      </div>
      {/* В карточке варианта двенадцать клеток в ряд не помещают «0,75» — по шесть до широкого экрана. */}
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 2xl:grid-cols-12">
        {Array.from({ length: n }, (_, i) => (
          <label key={i} className={cn('flex h-12 flex-col items-center justify-center rounded-lg border-[1.5px] bg-white px-1 focus-within:border-primary-600',
            at(i).trim() ? 'border-graphite-300' : 'border-dashed border-graphite-300')}>
            <span className="font-mono text-[10px] leading-none text-graphite-400">№{i + 1}</span>
            <input ref={i === 0 ? first : undefined} value={at(i)} onChange={e => setAt(i, e.target.value)}
              onPaste={e => onPaste(e, i)} maxLength={40} autoComplete="off" placeholder="—" aria-label={`Ответ ключа на задание ${i + 1}`}
              data-testid="mock-form-key-input"
              className="w-full min-w-0 border-0 bg-transparent p-0 text-center font-mono text-sm font-semibold text-graphite-900 placeholder:text-graphite-400 focus:outline-none" />
          </label>
        ))}
      </div>
      <Hint>«0,75», «0.75» и « 0,75 » считаются одним ответом. Пустое поле — задание проверите вручную. Ученик ключ не видит до проверки.</Hint>
      {note && <span role="status" data-testid="mock-form-key-status" className={cn('text-sm', note.kind === 'warn' ? 'text-verdict-part-ink' : 'text-verdict-ok-ink')}>{note.text}</span>}
    </div>
  )
}

/** «Кому какой вариант» — по группе: способ раздачи и ученик → вариант. */
function DistributionCard({ groups, positions, names, mode, onMode, onShuffle, assign, locked, onSet, dirty }: {
  groups: { id: string; name: string; roster: RosterStudent[] }[]
  positions: number[]
  /** §230. Подписи вариантов по номеру — в счёте «Резерв (№3) — 4». */
  names?: Record<number, string>
  mode: VariantMode
  onMode: (m: VariantMode) => void
  onShuffle?: () => void
  assign: Record<string, Record<string, number>>
  locked: Record<string, Set<string>>
  onSet: (groupId: string, studentId: string, position: number) => void
  dirty?: boolean
}) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-white p-4 shadow-card sm:p-6" data-testid="mock-form-distribution" aria-labelledby="mx-dist-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="mx-dist-h" className="text-base font-bold text-graphite-900">Кому какой вариант</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Как раздать варианты" testid="mock-form-variant-mode" value={mode} onChange={onMode}
            options={VARIANT_MODES.map(m => ({ key: m.key, aria: m.label, label: <><span className="sm:hidden">{m.short}</span><span className="hidden sm:inline">{m.label}</span></> }))} />
          {onShuffle && (
            <button type="button" onClick={onShuffle} className="inline-flex min-h-10 items-center gap-1 px-1.5 text-[13px] font-semibold text-primary-600 hover:underline sm:min-h-8" data-testid="mock-form-variant-shuffle">
              <Shuffle size={14} aria-hidden />Перемешать
            </button>
          )}
        </div>
      </div>
      {groups.map(g => {
        const a = assign[g.id] ?? {}
        const counts = variantCounts(a, positions)
        return (
          <div key={g.id} className="flex flex-col gap-2" data-testid="mock-form-distribution-group">
            {groups.length > 1 && <span className="text-[13px] font-bold uppercase tracking-[.04em] text-graphite-500">{g.name}</span>}
            {g.roster.length === 0 ? (
              <span className="text-sm text-graphite-500">В группе пока нет учеников — варианты выдадутся при первом входе, поровну.</span>
            ) : (
              <ul className="grid gap-x-5 sm:grid-cols-2 xl:grid-cols-3">
                {g.roster.map(s => {
                  const isLocked = locked[g.id]?.has(s.id) ?? false
                  return (
                    <li key={s.id} className="flex min-h-11 items-center justify-between gap-2 border-b border-graphite-200 py-1.5" data-testid="mock-form-distribution-row" data-student={s.id}>
                      <span className="min-w-0 truncate text-sm text-graphite-900" title={s.name}>{s.name}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {isLocked && <Lock size={13} className="text-graphite-400" aria-label="уже открыл пробник — вариант не меняется" />}
                        <select
                          value={a[s.id] ?? ''}
                          disabled={isLocked}
                          onChange={e => onSet(g.id, s.id, Number(e.target.value))}
                          aria-label={`Вариант для ${s.name}`}
                          title={isLocked ? 'Уже открыл пробник — вариант не меняется' : undefined}
                          data-testid="mock-form-distribution-select"
                          className="h-10 min-w-[56px] rounded-lg border-[1.5px] border-graphite-300 bg-white px-2 text-sm font-bold text-graphite-900 focus:border-primary-600 focus:outline-none disabled:bg-graphite-50 disabled:text-graphite-500 sm:h-8"
                        >
                          {a[s.id] == null && <option value="">—</option>}
                          {positions.map(p => <option key={p} value={p} title={names?.[p]}>{p}</option>)}
                        </select>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <span className="text-[13px] text-graphite-900 sm:text-xs" data-testid="mock-form-distribution-counts">
              {positions.map(p => variantCountLabel({ position: p, label: labelOnly(names?.[p], p) }, counts[p] ?? 0)).join(' · ')}
            </span>
          </div>
        )
      })}
      <Hint>
        Любому ученику можно поменять вариант, пока он не открыл пробник. Соседи по списку получают разные варианты. Кто появится в группе
        позже, получит наименее занятый вариант при первом входе.{dirty ? ' Раздача сохранится кнопкой справа.' : ''}
      </Hint>
    </section>
  )
}

function SummaryCard({ groupNames, f, ready, primary, quiet, disabled, status, grace = 15, variants = 1 }: {
  groupNames: string[]
  grace?: number
  variants?: number
  f: FormState
  ready: ReturnType<typeof readiness>
  primary: { label: string; onClick: () => void; busy: boolean }
  quiet: { label: string; onClick: () => void; busy: boolean } | null
  disabled: boolean
  status: { kind: 'error' | 'warn' | 'ok'; text: string } | null
}) {
  const items = studentTimeline(f.startsIso, f.duration, grace, f.nowMs, variants)
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
            <span className={r.state === 'ok' ? 'text-graphite-900' : r.state === 'todo' ? 'font-semibold text-graphite-900' : 'text-graphite-500'}>{r.text}</span>
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

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}
