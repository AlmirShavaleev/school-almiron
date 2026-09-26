import { useMemo, useState, type ClipboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, FileText, Loader2, Save, Table2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { useMockExamSetup, type SetupDraft, type SetupExam, type SetupModule } from '@/hooks/useMockExamSetup'
import { useMockExamTemplates } from '@/hooks/useMockExamTemplates'
import { fileNameFromStoragePath } from '@/lib/storage'
import { plural } from '@/lib/plural'
import {
  MOCK_EXAMS_BUCKET, fromMskInput, mskTime, parseKeyPaste, toMskInput,
} from '@/lib/mockExamLesson'
import { cn } from '@/utils/cn'

/**
 * §221. Настройка пробника-урока — вкладка «Преподаватель · Настройка» макета
 * `МАКЕТ-ОНЛАЙН-ПРОБНИКА.html`.
 *
 * Время вводится по Москве (школа живёт по московскому), хранится моментом
 * (`timestamptz`). Длительность по умолчанию — 4 часа, догрузка фото — 15
 * минут после конца (решение владельца 25.09).
 */
export function MockExamSetupPage() {
  const { id } = useParams<{ id: string }>()
  const { exam, modules, key, hasScores, loading, error, saveSettings, uploadFile, saveKey } = useMockExamSetup(id)
  const { templates } = useMockExamTemplates(true)

  if (loading) {
    return <div className="flex h-64 items-center justify-center gap-2 text-gray-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
  }
  if (error || !exam) {
    return (
      <div className="space-y-3">
        <Link to="/mock-exams" className="inline-flex items-center gap-1 text-sm text-graphite-500 hover:text-primary-700"><ArrowLeft size={14} />Пробники</Link>
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error || 'Пробник не найден'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-4" data-testid="mock-setup-page">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <Link to="/mock-exams" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-graphite-500 hover:text-primary-700">
            <ArrowLeft size={12} />Пробники{exam.groupName ? ` · группа ${exam.groupName}` : ''}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 [text-wrap:balance]">{exam.title} — настройка</h1>
        </div>
        <div className="flex-1" />
        {exam.template && exam.group_id && (
          <Link to={`/mock-exams/${exam.id}`} data-testid="mock-setup-grid-link"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-graphite-800 hover:border-primary-200">
            <Table2 size={14} />Проверка — таблица по номерам
          </Link>
        )}
      </header>

      <SettingsPanel exam={exam} modules={modules} templates={templates} hasScores={hasScores} onSave={saveSettings} />

      <div className="grid gap-4 md:grid-cols-2">
        <FilesPanel exam={exam} onUpload={uploadFile} />
        <KeyPanel key={exam.id} exam={exam} saved={key} onSave={saveKey} />
      </div>
    </div>
  )
}

function Panel({ children, testid, className }: { children: React.ReactNode; testid?: string; className?: string }) {
  return <section className={cn('rounded-xl border border-slate-200 bg-white px-4 py-4 sm:px-5', className)} data-testid={testid}>{children}</section>
}

const fieldCls = 'w-full max-w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-graphite-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-graphite-500'

function SettingsPanel({ exam, modules, templates, hasScores, onSave }: {
  exam: SetupExam
  modules: SetupModule[]
  templates: { id: string; title: string; year: number; max_points: number[]; part1_last: number }[]
  hasScores: boolean
  onSave: (d: SetupDraft) => Promise<{ error: string | null }>
}) {
  const [title, setTitle] = useState(exam.title)
  const [start, setStart] = useState(toMskInput(exam.starts_at))
  const [duration, setDuration] = useState(String(exam.duration_minutes))
  const [templateId, setTemplateId] = useState(exam.template_id ?? '')
  const [moduleId, setModuleId] = useState(exam.module_id ?? '')
  const [position, setPosition] = useState(() => positionOption(modules.find(m => m.id === exam.module_id) ?? null, exam.module_position))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const mod = modules.find(m => m.id === moduleId) ?? null
  const startsIso = fromMskInput(start)
  const mins = Number(duration)
  const endsIso = startsIso && Number.isFinite(mins) ? new Date(new Date(startsIso).getTime() + mins * 60000).toISOString() : null
  const photosIso = endsIso ? new Date(new Date(endsIso).getTime() + exam.photo_grace_minutes * 60000).toISOString() : null

  async function save() {
    setStatus(null)
    if (!title.trim()) { setStatus({ kind: 'error', text: 'Нужно название' }); return }
    if (start && !startsIso) { setStatus({ kind: 'error', text: 'Начало — дата и время целиком' }); return }
    if (!Number.isInteger(mins) || mins < 10 || mins > 720) { setStatus({ kind: 'error', text: 'Длительность — от 10 до 720 минут' }); return }
    if (startsIso && !templateId) { setStatus({ kind: 'error', text: 'Онлайн-пробнику нужен шаблон: по нему строится бланк' }); return }
    setBusy(true)
    const r = await onSave({
      title, starts_at: startsIso, duration_minutes: mins, template_id: templateId || null,
      module_id: moduleId || null, module_position: Number(position) || 0,
    })
    setBusy(false)
    setStatus(r.error ? { kind: 'error', text: `Не сохранено: ${r.error}` } : { kind: 'ok', text: 'Сохранено.' })
  }

  return (
    <Panel testid="mock-setup-settings">
      <h2 className="text-[17px] font-semibold text-graphite-900">Пробник в программе курса</h2>
      <p className="mb-4 text-sm text-graphite-600">
        Появляется у учеников как урок в выбранном разделе. До начала — «откроется {start ? `${start.slice(8, 10)}.${start.slice(5, 7)} в ${start.slice(11, 16)}` : '…'}», после конца — «на проверке».
        Все сроки проверяет сервер, а не часы ученика.
      </p>
      <div className="grid items-center gap-x-4 gap-y-2.5 sm:grid-cols-[180px_1fr]">
        <label htmlFor="mx-title" className="text-sm text-graphite-600">Название</label>
        <input id="mx-title" className={fieldCls} value={title} onChange={e => setTitle(e.target.value)} data-testid="mock-setup-title" />

        <label htmlFor="mx-start" className="text-sm text-graphite-600">Начало для всех <span className="text-graphite-400">(МСК)</span></label>
        <input id="mx-start" type="datetime-local" className={cn(fieldCls, 'sm:max-w-[16rem]')} value={start} onChange={e => setStart(e.target.value)} data-testid="mock-setup-start" />

        <label htmlFor="mx-dur" className="text-sm text-graphite-600">Длительность</label>
        <span className="flex items-center gap-2">
          <input id="mx-dur" type="number" min={10} max={720} step={5} className={cn(fieldCls, 'w-24')} value={duration} onChange={e => setDuration(e.target.value)} data-testid="mock-setup-duration" />
          <span className="text-sm text-graphite-500">минут{Number.isFinite(mins) && mins > 0 ? ` — ${Math.floor(mins / 60)} ч ${String(mins % 60).padStart(2, '0')} мин` : ''}</span>
        </span>

        <span className="text-sm text-graphite-600">Догрузка фото</span>
        <span className="text-sm text-graphite-500">{exam.photo_grace_minutes} минут после конца{photosIso ? ` — до ${mskTime(photosIso)}` : ''}</span>

        <label htmlFor="mx-tpl" className="text-sm text-graphite-600">Шаблон</label>
        <span>
          <select id="mx-tpl" className={fieldCls} value={templateId} onChange={e => setTemplateId(e.target.value)} disabled={hasScores} data-testid="mock-setup-template">
            <option value="">— без шаблона —</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.title} · {t.year} · {t.max_points.length} заданий · {t.max_points.reduce((a, b) => a + b, 0)} первичных</option>
            ))}
          </select>
          {hasScores && <span className="mt-1 block text-xs text-graphite-500">Баллы уже введены — шаблон не меняется.</span>}
        </span>

        <span className="text-sm text-graphite-600">Группа</span>
        <span className="text-sm text-graphite-500">{exam.groupName ?? 'не указана'} — берётся из пробника</span>

        <label htmlFor="mx-mod" className="text-sm text-graphite-600">Раздел</label>
        <select id="mx-mod" className={fieldCls} value={moduleId} onChange={e => { setModuleId(e.target.value); setPosition('-1') }} disabled={!exam.courseId} data-testid="mock-setup-module">
          <option value="">— не показывать в программе —</option>
          {modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>

        <label htmlFor="mx-pos" className="text-sm text-graphite-600">Место в разделе</label>
        <select id="mx-pos" className={fieldCls} value={position} onChange={e => setPosition(e.target.value)} disabled={!mod} data-testid="mock-setup-position">
          <option value="-1">в начале раздела</option>
          {(mod?.topics ?? []).map(t => <option key={t.id} value={String(t.order_index)}>после темы «{t.title}»</option>)}
        </select>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} loading={busy} data-testid="mock-setup-save"><Save size={14} />Сохранить</Button>
        {startsIso && endsIso && (
          <span className="text-sm text-graphite-600">Окно: {mskTime(startsIso)}–{mskTime(endsIso)}, фото до {mskTime(photosIso)}.</span>
        )}
        {status && (
          <span role="status" className={cn('text-sm', status.kind === 'error' ? 'text-red-700' : 'text-emerald-700')} data-testid="mock-setup-status">{status.text}</span>
        )}
      </div>
    </Panel>
  )
}

/**
 * Значение «Место в разделе» для сохранённой позиции: последняя тема с
 * order_index <= позиции (то же правило, что `placeInModule`), иначе «в начале».
 */
function positionOption(mod: SetupModule | null, pos: number): string {
  const before = (mod?.topics ?? []).filter(t => t.order_index <= pos)
  return before.length ? String(before[before.length - 1].order_index) : '-1'
}

function FilesPanel({ exam, onUpload }: {
  exam: SetupExam
  onUpload: (kind: 'condition' | 'solution', file: File, onProgress?: (p: number) => void) => Promise<{ error: string | null }>
}) {
  return (
    <Panel testid="mock-setup-files">
      <h2 className="text-[17px] font-semibold text-graphite-900">Задания и решение</h2>
      <p className="mb-3 text-sm text-graphite-600">Условие ученик видит с началом пробника. Решение — только после того, как ты проверишь и нажмёшь «Уведомить».</p>
      <div className="space-y-2.5">
        <FileRow label="Условие" kind="condition" path={exam.condition_path} onUpload={onUpload} />
        <FileRow label="Решение" kind="solution" path={exam.solution_path} onUpload={onUpload} />
      </div>
    </Panel>
  )
}

function FileRow({ label, kind, path, onUpload }: {
  label: string
  kind: 'condition' | 'solution'
  path: string | null
  onUpload: (kind: 'condition' | 'solution', file: File, onProgress?: (p: number) => void) => Promise<{ error: string | null }>
}) {
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const name = path ? fileNameFromStoragePath(path).replace(/^\d+_/, '') : null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`mock-setup-file-${kind}`}>
      <span className={cn('whitespace-nowrap rounded px-1.5 py-px text-xs', path ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-graphite-600')}>{path ? 'загружено' : 'нет файла'}</span>
      <span className="text-sm text-graphite-800">{label}</span>
      {path && name && (
        <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={path} className="inline-flex min-w-0 items-center gap-1 text-sm text-primary-700 hover:underline">
          <FileText size={13} /><span className="max-w-[14rem] truncate">{name}</span>
        </SignedFileLink>
      )}
      <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-graphite-800 hover:bg-primary-50">
        {pct != null ? <><Loader2 size={12} className="animate-spin" />{pct}%</> : <><Upload size={12} />{path ? 'заменить' : 'загрузить PDF'}</>}
        <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={pct != null}
          onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            setErr(null); setPct(0)
            const r = await onUpload(kind, f, p => setPct(p))
            setPct(null)
            if (r.error) setErr(r.error)
          }} />
      </label>
      {err && <span className="w-full text-xs text-red-700" role="alert">{err}</span>}
    </div>
  )
}

function KeyPanel({ exam, saved, onSave }: {
  exam: SetupExam
  saved: (string | null)[] | null
  onSave: (answers: string[]) => Promise<{ error: string | null; notCheckable: number[]; changed: number }>
}) {
  const n = exam.template?.part1_last ?? 0
  const initial = useMemo(() => Array.from({ length: n }, (_, i) => saved?.[i] ?? ''), [n, saved])
  // Поля — из ключа на момент открытия. Эффекта «ключ пришёл — перезаписать
  // поля» нет намеренно: он перетирал бы то, что человек успел ввести.
  const [values, setValues] = useState<string[]>(initial)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null)
  const dirty = values.some((v, i) => v.trim() !== (initial[i] ?? '').trim())
  const filled = values.filter(v => v.trim()).length

  if (!n) {
    return (
      <Panel testid="mock-setup-key">
        <h2 className="text-[17px] font-semibold text-graphite-900">Ключ ответов части 1</h2>
        <p className="text-sm text-graphite-600">Сначала выбери шаблон — по нему видно, сколько заданий в первой части.</p>
      </Panel>
    )
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, at: number) {
    const parsed = parseKeyPaste(e.clipboardData?.getData('text') ?? '', n - at)
    if (!parsed) return
    e.preventDefault()
    setValues(prev => {
      const next = prev.slice()
      parsed.answers.forEach((a, k) => { if (at + k < n) next[at + k] = a })
      return next
    })
    setStatus(parsed.extra > 0
      ? { kind: 'warn', text: `Вставлено с №${at + 1}; лишние ${parsed.extra} ${plural(parsed.extra, 'значение', 'значения', 'значений')} отброшены — полей всего ${n}.` }
      : { kind: 'ok', text: `Вставлено с №${at + 1}. Не забудь «Сохранить ключ».` })
  }

  async function save() {
    setBusy(true)
    setStatus(null)
    const r = await onSave(values)
    setBusy(false)
    if (r.error) { setStatus({ kind: 'error', text: `Не сохранено: ${r.error}` }); return }
    const parts = ['Ключ сохранён.']
    if (r.changed > 0) parts.push(`Перепроверено по ключу клеток: ${r.changed}.`)
    if (r.notCheckable.length) {
      setStatus({ kind: 'warn', text: `${parts.join(' ')} Не поддаются автопроверке: ${r.notCheckable.map(x => `№${x}`).join(', ')} — эти клетки поставишь руками в таблице.` })
      return
    }
    setStatus({ kind: 'ok', text: parts.join(' ') })
  }

  return (
    <Panel testid="mock-setup-key">
      <h2 className="text-[17px] font-semibold text-graphite-900">Ключ ответов части 1</h2>
      <p className="mb-3 text-sm text-graphite-600">
        Можно вставить строкой или столбцом из Excel — в любое поле, дальше разложится само. Проверка бланка — точным сравнением, без ИИ:
        «0,75», «0.75» и « 0,75 » — один ответ. Ученик ключ не видит никогда; верные ответы — только после «Уведомить».
      </p>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(84px,1fr))]">
        {values.map((v, i) => (
          <label key={i} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 py-1 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100">
            <span className="font-mono text-[12px] text-graphite-500">№{i + 1}</span>
            <input value={v} onChange={e => setValues(prev => { const nx = prev.slice(); nx[i] = e.target.value; return nx })}
              onPaste={e => onPaste(e, i)} maxLength={40} autoComplete="off" aria-label={`Ответ ключа на задание ${i + 1}`}
              data-testid="mock-setup-key-input"
              className="min-w-0 flex-1 border-0 bg-transparent py-0.5 font-mono text-sm text-graphite-900 focus:outline-none" />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} loading={busy} disabled={!dirty && saved != null} data-testid="mock-setup-key-save"><Save size={14} />Сохранить ключ</Button>
        <span className="text-xs text-graphite-500">заполнено {filled} из {n}</span>
        {status && (
          <span role="status" data-testid="mock-setup-key-status"
            className={cn('text-sm', status.kind === 'error' ? 'text-red-700' : status.kind === 'warn' ? 'text-amber-800' : 'text-emerald-700')}>{status.text}</span>
        )}
      </div>
    </Panel>
  )
}
