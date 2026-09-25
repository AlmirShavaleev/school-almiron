import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { EXAM_LABELS, SUBJECT_LABELS } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { useMockExamTemplates, type TemplateDraft } from '@/hooks/useMockExamTemplates'
import { checkScale, parseScale } from '@/lib/mockExamGrid'

/**
 * §218. Шаблоны пробников: максимум за каждое задание, граница частей и
 * таблица перевода первичного балла в тестовый.
 *
 * Таблица перевода вставляется столбцом из Excel — тем же разбором буфера,
 * что и таблица баллов (`parseScale` в `lib/mockExamGrid`). Правила длины и
 * «не убывает» — те же, что в базе (`mock_exam_template_scale_ok`): здесь —
 * чтобы объяснить ошибку словами, там — чтобы её нельзя было обойти.
 *
 * Правит владелец/админ платформы: смена таблицы перевода пересчитывает
 * итоги всех пробников шаблона, в том числе чужих групп. Остальной персонал
 * видит шаблон только для чтения.
 */

const blankDraft = (): TemplateDraft => ({
  title: '', subject: 'math', exam_type: 'ege', year: new Date().getFullYear() + 1,
  max_points: Array(12).fill(1), part1_last: 12, score_scale: null,
})

export function MockExamTemplatesPage() {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner'].includes(profile.role)
  const { templates, loading, error, saveTemplate } = useMockExamTemplates()
  const [selected, setSelected] = useState<string | 'new' | null>(null)

  useEffect(() => {
    if (selected == null && templates.length) setSelected(templates[0].id)
  }, [templates, selected])

  const current = useMemo<TemplateDraft | null>(() => {
    if (selected === 'new') return blankDraft()
    return templates.find(t => t.id === selected) ?? null
  }, [selected, templates])

  return (
    <div className="space-y-4" data-testid="mock-templates-page">
      <div>
        <Link to="/mock-exams" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-graphite-500 hover:text-primary-700"><ArrowLeft size={12} />Пробники</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Шаблоны пробников</h1>
        <p className="text-sm text-graphite-600">Структура экзамена на год: максимум за каждое задание, где кончается первая часть, и таблица перевода в тестовый балл. Задаётся один раз — дальше её берут все пробники.</p>
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-graphite-600">Шаблоны правит владелец школы: таблица перевода пересчитывает итоги всех групп. Здесь — только просмотр.</p>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-gray-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <nav className="flex flex-wrap gap-2 lg:flex-col" aria-label="Шаблоны">
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className={cn('rounded-lg border px-3 py-2 text-left text-sm',
                  selected === t.id ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-slate-200 bg-white text-graphite-800 hover:border-primary-200')}
              >
                <span className="block font-medium">{t.title}</span>
                <span className="block text-xs text-graphite-500">{t.year} · {t.max_points.length} заданий · {t.score_scale ? 'таблица перевода есть' : 'без таблицы перевода'}</span>
              </button>
            ))}
            {templates.length === 0 && <p className="text-sm text-graphite-500">Шаблонов пока нет.</p>}
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setSelected('new')} data-testid="mock-template-new"><Plus size={14} />Новый шаблон</Button>
            )}
          </nav>
          {current ? (
            <TemplateEditor key={selected ?? 'none'} initial={current} canEdit={canEdit} onSave={async d => {
              const res = await saveTemplate(d)
              if (!res.error && res.id) setSelected(res.id)
              return res.error
            }} />
          ) : (
            <p className="text-sm text-graphite-500">Выберите шаблон слева.</p>
          )}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({ initial, canEdit, onSave }: { initial: TemplateDraft; canEdit: boolean; onSave: (d: TemplateDraft) => Promise<string | null> }) {
  const [d, setD] = useState<TemplateDraft>(initial)
  const [scaleText, setScaleText] = useState('')
  const [scaleError, setScaleError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const p1 = d.max_points.slice(0, d.part1_last).reduce((a, b) => a + b, 0)
  const p2 = d.max_points.slice(d.part1_last).reduce((a, b) => a + b, 0)
  const maxPrimary = p1 + p2
  // Таблица перевода, внесённая под прежнюю раскладку, после правки
  // максимумов может перестать подходить — говорим сразу, а не при сохранении.
  const scaleProblem = d.score_scale ? checkScale(d.score_scale, maxPrimary) : null

  function patch(p: Partial<TemplateDraft>) { setD(prev => ({ ...prev, ...p })); setStatus(null) }

  function setCount(n: number) {
    const count = Math.max(1, Math.min(60, Math.round(n) || 1))
    const next = d.max_points.slice(0, count)
    while (next.length < count) next.push(1)
    patch({ max_points: next, part1_last: Math.min(d.part1_last, count) })
  }

  function applyScale(text: string) {
    setScaleText(text)
    if (!text.trim()) { setScaleError(null); return }
    const res = parseScale(text, maxPrimary)
    setScaleError(res.error)
    if (res.scale) patch({ score_scale: res.scale })
  }

  async function save() {
    if (!d.title.trim()) { setStatus({ kind: 'error', text: 'Назовите шаблон' }); return }
    if (scaleProblem) { setStatus({ kind: 'error', text: `Таблица перевода не подходит: ${scaleProblem}` }); return }
    setSaving(true)
    const err = await onSave(d)
    setSaving(false)
    setStatus(err ? { kind: 'error', text: `Не сохранено: ${err}` } : { kind: 'ok', text: 'Шаблон сохранён' })
  }

  const ro = !canEdit
  const field = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-graphite-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50'

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="mock-template-editor">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="text-xs text-graphite-500">Название
          <input className={cn(field, 'mt-1 block w-full')} value={d.title} disabled={ro} onChange={e => patch({ title: e.target.value })} aria-label="Название шаблона" />
        </label>
        <label className="text-xs text-graphite-500">Предмет
          <select className={cn(field, 'mt-1 block')} value={d.subject} disabled={ro} onChange={e => patch({ subject: e.target.value })}>
            {Object.entries(SUBJECT_LABELS).filter(([v]) => v === 'math' || v === 'physics').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-graphite-500">Экзамен
          <select className={cn(field, 'mt-1 block')} value={d.exam_type} disabled={ro} onChange={e => patch({ exam_type: e.target.value })}>
            {Object.entries(EXAM_LABELS).filter(([v]) => v === 'ege' || v === 'oge').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-graphite-500">Год экзамена
          <input type="number" className={cn(field, 'mt-1 block w-24')} value={d.year} disabled={ro} onChange={e => patch({ year: Number(e.target.value) })} />
        </label>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-graphite-900">Максимум за задание</h3>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="mock-template-struct">
          {d.max_points.map((m, t) => (
            <label key={t} className="flex w-10 flex-col items-center text-[11px] text-graphite-500">
              №{t + 1}
              <input
                type="number" min={0} max={20} value={m} disabled={ro}
                aria-label={`Максимум за задание ${t + 1}`}
                onChange={e => { const next = d.max_points.slice(); next[t] = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)); patch({ max_points: next }) }}
                className={cn('h-[30px] w-10 rounded border bg-white text-center font-mono text-[13px] text-graphite-900 disabled:bg-slate-50', t >= d.part1_last ? 'border-graphite-400' : 'border-slate-200')}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-graphite-600">
          <span>Заданий</span>
          <input type="number" min={1} max={60} value={d.max_points.length} disabled={ro} onChange={e => setCount(Number(e.target.value))} className={cn(field, 'w-16 text-center font-mono')} aria-label="Число заданий" />
          <span>· первая часть — задания с 1 по</span>
          <input type="number" min={1} max={d.max_points.length} value={d.part1_last} disabled={ro}
            onChange={e => patch({ part1_last: Math.max(1, Math.min(d.max_points.length, parseInt(e.target.value, 10) || 1)) })}
            className={cn(field, 'w-16 text-center font-mono')} aria-label="Последнее задание первой части" />
          <span data-testid="mock-template-sum">· первая часть {p1} б., вторая {p2} б., всего {maxPrimary}</span>
        </div>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-graphite-900">Таблица перевода первичный → тестовый</h3>
        <p className="mt-0.5 text-sm text-graphite-600">
          Официальная, одна на год. Скопируйте из Excel столбец тестовых баллов (строка — первичный 0, 1, 2, …) или два столбца «первичный, тестовый» и вставьте сюда.
          Пока таблицы нет, тестовый балл равен первичному; когда она появится, итоги всех пробников этого шаблона пересчитаются сами.
        </p>
        {canEdit && (
          <textarea
            value={scaleText}
            onChange={e => applyScale(e.target.value)}
            placeholder={'0\n6\n11\n…'}
            spellCheck={false}
            aria-label="Таблица перевода из Excel"
            className="mt-2 block min-h-[96px] w-full max-w-md rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs text-graphite-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        )}
        {scaleError && <p className="mt-1 flex items-center gap-1 text-sm text-red-700" data-testid="mock-template-scale-error"><AlertCircle size={14} />{scaleError}</p>}
        {scaleProblem && !scaleError && <p className="mt-1 flex items-center gap-1 text-sm text-red-700"><AlertCircle size={14} />Таблица не подходит к раскладке: {scaleProblem}</p>}
        {d.score_scale ? (
          <div className="mt-2 flex flex-wrap gap-1" data-testid="mock-template-scale">
            {d.score_scale.map((v, k) => (
              <span key={k} className="inline-flex w-11 flex-col items-center rounded border border-slate-200 py-0.5 font-mono text-xs">
                <span className="text-[10px] text-graphite-500">{k}</span>
                <span className="text-graphite-900">{v}</span>
              </span>
            ))}
            {canEdit && <Button variant="ghost" size="sm" onClick={() => { patch({ score_scale: null }); setScaleText(''); setScaleError(null) }}>Убрать таблицу</Button>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-graphite-500">Таблицы перевода нет.</p>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={save} loading={saving} data-testid="mock-template-save"><Save size={14} />Сохранить шаблон</Button>
          {status && <span role="status" className={cn('text-sm', status.kind === 'error' ? 'text-red-700' : 'text-emerald-700')}>{status.text}</span>}
        </div>
      )}
    </section>
  )
}
