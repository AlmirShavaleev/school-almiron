import { useState, useCallback, useEffect, useMemo } from 'react'
import { useBeforeUnload } from 'react-router-dom'
import {
  FilePlus2, ChevronDown, ChevronUp, CheckSquare, Square,
  Minus, Plus, RefreshCw, Trash2, GripVertical, ArrowLeft,
  AlertTriangle, Loader2, Save, Eye, FileDown,
} from 'lucide-react'
import { useCatalogSections, useCatalogTopics, SUBJECT_FROM_SLUG, EXAM_FROM_SLUG, type CatalogSection } from '@/hooks/useCatalog'
import { useVariantBuilder, type GeneratedTask, type VariantSectionConfig, type VariantSettings } from '@/hooks/useVariants'
import { CatalogTaskContent } from '@/components/catalog/CatalogTaskContent'
import { VariantPrintPanel } from '@/components/pdf/VariantPrintPanel'
import type { PrintableItem } from '@/utils/variantPrintUtils'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/toastStore'
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'

type Step = 'build' | 'preview'

interface SectionState {
  enabled: boolean
  expanded: boolean
  cnt: number
  topicIds: Set<string>
}

type PresetKind = 'standard' | 'part1' | 'part2'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

function getSectionExamPart(section: CatalogSection): 1 | 2 {
  return (section.part1_count ?? 0) >= (section.part2_count ?? 0) ? 1 : 2
}

function humanizeGenerateError(message: string, sections: CatalogSection[]): string {
  if (message.startsWith('NOT_ENOUGH:')) {
    const match = message.match(/section=([^:]+):topic=([^:]+):needed=(\d+):available=(\d+)/)
    if (match) {
      const section = sections.find(s => s.id === match[1])
      return `Недостаточно задач в разделе «${section?.title ?? match[1]}»: запрошено ${match[3]}, доступно ${match[4]}. Уменьшите количество или снимите часть тем.`
    }
    return 'Недостаточно задач в выбранных темах, уменьшите количество.'
  }
  return message
}

export interface VariantConstructorInitialData {
  subject: string
  examType: string
  title: string
  description?: string
  settings?: VariantSettings | null
  tasks?: GeneratedTask[]
}

export interface VariantConstructorSubmitPayload {
  title: string
  description: string
  subject: string
  examType: string
  settings: VariantSettings
  tasks: GeneratedTask[]
}

export interface VariantConstructorProps {
  headerTitle: string
  backLabel?: string
  loading?: boolean
  initialData?: VariantConstructorInitialData | null
  saving?: boolean
  showDescription?: boolean
  showDraftAction?: boolean
  completeOnGenerate?: boolean
  showPreviewStep?: boolean
  completeActionLabel: string
  completeStepLabel?: string
  onBack: () => void
  onComplete: (payload: VariantConstructorSubmitPayload) => Promise<void>
  onSaveDraft?: (payload: VariantConstructorSubmitPayload) => Promise<void>
  onReplaceTask: (
    task: GeneratedTask,
    excludeIds: string[],
  ) => Promise<(CatalogTask & { assets: CatalogTaskAsset[]; sectionTitle?: string | null }) | null>
}

export function VariantConstructor({
  headerTitle,
  backLabel = 'Назад',
  loading = false,
  initialData,
  saving = false,
  showDescription = true,
  showDraftAction = true,
  completeOnGenerate = false,
  showPreviewStep = true,
  completeActionLabel,
  completeStepLabel = 'Сохранение',
  onBack,
  onComplete,
  onSaveDraft,
  onReplaceTask,
}: VariantConstructorProps) {
  const [subject, setSubject] = useState(initialData?.subject ?? 'math')
  const [examType, setExamType] = useState(initialData?.examType ?? 'ege')
  const [title, setTitle] = useState(initialData?.title ?? '')
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [step, setStep] = useState<Step>('build')
  const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>({})
  const [isDirty, setIsDirty] = useState(false)
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>(initialData?.tasks ?? [])
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const subjectDb = SUBJECT_FROM_SLUG[subject] ?? subject
  const examTypeDb = EXAM_FROM_SLUG[examType] ?? examType
  const { sections, loading: loadingSections } = useCatalogSections(subjectDb, examTypeDb)
  const { generateTasks, generating, genError, setGenError } = useVariantBuilder()
  const filteredSections = useMemo(
    () => sections.filter(section => section.subject === subjectDb && section.exam_type === examTypeDb),
    [sections, subjectDb, examTypeDb],
  )

  useEffect(() => {
    if (!initialData) return
    setSubject(initialData.subject)
    setExamType(initialData.examType)
    setTitle(initialData.title)
    setDescription(initialData.description ?? '')
    if ((initialData.tasks ?? []).length > 0) {
      setGeneratedTasks(initialData.tasks ?? [])
      if (initialData.settings?.sections) {
        const states: Record<string, SectionState> = {}
        for (const sc of initialData.settings.sections) {
          states[sc.section_id] = {
            enabled: true,
            expanded: false,
            cnt: sc.cnt,
            topicIds: new Set(sc.topic_ids),
          }
        }
        setSectionStates(states)
      }
      setStep('preview')
    }
  }, [initialData])

  useBeforeUnload(useCallback((e) => {
    if (isDirty) e.preventDefault()
  }, [isDirty]))

  useEffect(() => {
    setSectionStates(prev => {
      const next: Record<string, SectionState> = {}
      for (const s of filteredSections) {
        next[s.id] = prev[s.id] ?? { enabled: false, expanded: false, cnt: 0, topicIds: new Set() }
      }
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      const sameKeys = prevKeys.length === nextKeys.length && prevKeys.every(key => nextKeys.includes(key))
      if (sameKeys) {
        let changed = false
        for (const key of nextKeys) {
          if (prev[key] !== next[key]) {
            changed = true
            break
          }
        }
        if (!changed) return prev
      }
      return next
    })
  }, [filteredSections])

  const switchSubject = (val: string) => {
    if (isDirty && !confirm('Сменить предмет? Несохранённые настройки разделов будут сброшены.')) return
    setSubject(val)
    setExamType('ege')
    setSectionStates({})
    setGeneratedTasks([])
    setStep('build')
    setIsDirty(false)
  }

  const switchExam = (val: string) => {
    if (isDirty && !confirm('Сменить экзамен? Несохранённые настройки разделов будут сброшены.')) return
    setExamType(val)
    setSectionStates({})
    setGeneratedTasks([])
    setStep('build')
    setIsDirty(false)
  }

  const updateSection = (id: string, patch: Partial<SectionState>) => {
    setSectionStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setIsDirty(true)
  }

  const toggleSection = (id: string) => {
    const st = sectionStates[id]
    if (!st) return
    if (st.enabled) updateSection(id, { enabled: false, cnt: 0, topicIds: new Set() })
    else updateSection(id, { enabled: true, cnt: st.cnt === 0 ? 1 : st.cnt })
  }

  const toggleExpand = (id: string) => updateSection(id, { expanded: !sectionStates[id]?.expanded })

  const setCnt = (id: string, val: number) => {
    const sec = sections.find(s => s.id === id)
    const max = sec?.task_count ?? 999
    const clamped = Math.max(0, Math.min(isNaN(val) ? 0 : val, max))
    if (clamped === 0) updateSection(id, { cnt: 0, enabled: false, topicIds: new Set() })
    else updateSection(id, { cnt: clamped, enabled: true })
  }

  const toggleTopic = (sectionId: string, topicId: string) => {
    const st = sectionStates[sectionId]
    if (!st) return
    const next = new Set(st.topicIds)
    if (next.has(topicId)) next.delete(topicId)
    else next.add(topicId)
    updateSection(sectionId, { topicIds: next })
  }

  const enabledSections = filteredSections.filter(s => {
    const st = sectionStates[s.id]
    return st?.enabled && st.cnt > 0
  })
  const totalTasks = enabledSections.reduce((sum, s) => sum + (sectionStates[s.id]?.cnt ?? 0), 0)
  const totalTopics = enabledSections.reduce((sum, s) => sum + (sectionStates[s.id]?.topicIds.size ?? 0), 0)

  const applyPreset = (preset: PresetKind) => {
    setSectionStates(prev => {
      const next: Record<string, SectionState> = {}
      for (const section of filteredSections) {
        const current = prev[section.id] ?? { enabled: false, expanded: false, cnt: 0, topicIds: new Set<string>() }
        const matches =
          preset === 'standard'
            ? true
            : preset === 'part1'
              ? getSectionExamPart(section) === 1
              : getSectionExamPart(section) === 2
        next[section.id] = {
          ...current,
          enabled: matches,
          cnt: matches ? 1 : 0,
          topicIds: new Set(),
        }
      }
      return next
    })
    setGeneratedTasks([])
    setStep('build')
    setIsDirty(true)
  }

  const buildSettings = useCallback((): VariantSettings => ({
    sections: enabledSections.map(s => ({
      section_id: s.id,
      cnt: sectionStates[s.id].cnt,
      topic_ids: [...sectionStates[s.id].topicIds],
    })),
    generation_mode: 'random',
  }), [enabledSections, sectionStates])

  const handleGenerate = async () => {
    setGenError(null)
    if (!title.trim()) {
      toast.error('Введите название варианта')
      return
    }
    const configs: VariantSectionConfig[] = enabledSections.map(s => ({
      section_id: s.id,
      cnt: sectionStates[s.id].cnt,
      topic_ids: [...sectionStates[s.id].topicIds],
    }))
    if (configs.length === 0) {
      toast.error('Укажите количество задач хотя бы в одном разделе')
      return
    }
    try {
      const tasks = await generateTasks(configs, { hydrateTasks: !completeOnGenerate })
      if (tasks.length === 0) {
        const emptyMsg = 'Не удалось подобрать задачи. Попробуйте уменьшить количество или выбрать другие темы.'
        setGenError(emptyMsg)
        toast.error(emptyMsg)
        return
      }
      if (completeOnGenerate) {
        await onComplete({
          title: title.trim(),
          description: description.trim(),
          subject,
          examType,
          settings: {
            sections: configs,
            generation_mode: 'random',
          },
          tasks,
        })
        setIsDirty(false)
        return
      }
      setGeneratedTasks(tasks)
      setStep('preview')
      setIsDirty(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка генерации'
      const humanMessage = humanizeGenerateError(msg, filteredSections)
      setGenError(humanMessage)
      toast.error(humanMessage)
    }
  }

  const moveTask = (from: number, to: number) => {
    setGeneratedTasks(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next.map((t, i) => ({ ...t, position: i + 1 }))
    })
    setIsDirty(true)
  }

  const deleteTask = (idx: number) => {
    setGeneratedTasks(prev => prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, position: i + 1 })))
    setIsDirty(true)
  }

  const replaceTaskInList = async (idx: number) => {
    const task = generatedTasks[idx]
    if (!task) return
    const replacement = await onReplaceTask(task, generatedTasks.map(t => t.task_id))
    if (!replacement) {
      toast.error('Нет доступной замены для этой задачи')
      return
    }
    setGeneratedTasks(prev => {
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        task_id: replacement.id,
        task: replacement,
      }
      return next
    })
    setIsDirty(true)
  }

  const createPayload = useCallback((): VariantConstructorSubmitPayload => ({
    title: title.trim(),
    description: description.trim(),
    subject,
    examType,
    settings: buildSettings(),
    tasks: generatedTasks,
  }), [title, description, subject, examType, buildSettings, generatedTasks])

  const handleComplete = async () => {
    if (!title.trim()) {
      toast.error('Введите название варианта')
      return
    }
    if (!generatedTasks.length) {
      toast.error('Вариант пустой')
      return
    }
    try {
      await onComplete(createPayload())
      setIsDirty(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось завершить действие')
    }
  }

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return
    if (!title.trim()) {
      toast.error('Введите название варианта')
      return
    }
    if (!generatedTasks.length) {
      toast.error('Вариант пустой')
      return
    }
    try {
      await onSaveDraft(createPayload())
      setIsDirty(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить черновик')
    }
  }

  if (loading) return <BuilderSkeleton />

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" aria-label={backLabel}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <FilePlus2 size={22} className="text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">{headerTitle}</h1>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {(['build', ...(showPreviewStep ? ['preview'] as const : [])] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-gray-300" />}
            <button
              onClick={() => { if (s === 'preview' && !generatedTasks.length) return; setStep(s) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step === s
                  ? 'bg-primary-600 text-white'
                  : generatedTasks.length || s === 'build'
                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    : 'bg-gray-50 text-gray-400 cursor-not-allowed'
              }`}
            >
              <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold border-current">{i + 1}</span>
              {s === 'build' ? 'Создание' : 'Предпросмотр'}
            </button>
          </div>
        ))}
        {generatedTasks.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-px bg-gray-300" />
            <button
              onClick={handleComplete}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold border-current">3</span>
              {completeStepLabel}
            </button>
          </div>
        )}
      </div>

      {step === 'build' ? (
        <BuildStep
          subject={subject}
          examType={examType}
          title={title}
          description={description}
          showDescription={showDescription}
          sections={filteredSections}
          sectionStates={sectionStates}
          loadingSections={loadingSections}
          enabledSections={enabledSections}
          totalTasks={totalTasks}
          totalTopics={totalTopics}
          generating={generating}
          genError={genError}
          onSwitchSubject={switchSubject}
          onSwitchExam={switchExam}
          onTitleChange={v => { setTitle(v); setIsDirty(true) }}
          onDescChange={v => { setDescription(v); setIsDirty(true) }}
          onToggleSection={toggleSection}
          onToggleExpand={toggleExpand}
          onSetCnt={setCnt}
          onToggleTopic={toggleTopic}
          onApplyPreset={applyPreset}
          onGenerate={handleGenerate}
          onReset={() => {
            if (!confirm('Сбросить все настройки?')) return
            setSectionStates({})
            setGeneratedTasks([])
            setIsDirty(false)
          }}
        />
      ) : (
        <PreviewStep
          tasks={generatedTasks}
          saving={saving}
          dragIdx={dragIdx}
          subject={subject}
          examType={examType}
          title={title}
          completeActionLabel={completeActionLabel}
          showDraftAction={showDraftAction}
          onSetDragIdx={setDragIdx}
          onMove={moveTask}
          onDelete={deleteTask}
          onReplace={replaceTaskInList}
          onBack={() => setStep('build')}
          onSaveDraft={handleSaveDraft}
          onComplete={handleComplete}
          onRegenerate={() => {
            if (!confirm('Сгенерировать заново? Текущие задачи будут заменены.')) return
            setStep('build')
            setGeneratedTasks([])
          }}
        />
      )}
    </div>
  )
}

function BuildStep({
  subject, examType, title, description, showDescription,
  sections, sectionStates, loadingSections,
  enabledSections, totalTasks, totalTopics,
  generating, genError,
  onSwitchSubject, onSwitchExam,
  onTitleChange, onDescChange,
  onToggleSection, onToggleExpand, onSetCnt, onToggleTopic,
  onApplyPreset,
  onGenerate, onReset,
}: {
  subject: string
  examType: string
  title: string
  description: string
  showDescription: boolean
  sections: CatalogSection[]
  sectionStates: Record<string, SectionState>
  loadingSections: boolean
  enabledSections: CatalogSection[]
  totalTasks: number
  totalTopics: number
  generating: boolean
  genError: string | null
  onSwitchSubject: (v: string) => void
  onSwitchExam: (v: string) => void
  onTitleChange: (v: string) => void
  onDescChange: (v: string) => void
  onToggleSection: (id: string) => void
  onToggleExpand: (id: string) => void
  onSetCnt: (id: string, v: number) => void
  onToggleTopic: (sectionId: string, topicId: string) => void
  onApplyPreset: (preset: PresetKind) => void
  onGenerate: () => void
  onReset: () => void
}) {
  const canGenerate = totalTasks > 0 && title.trim().length > 0

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Настройки варианта</h2>

          <div className="flex flex-wrap gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Предмет</label>
              <div className="flex gap-2">
                {(['math', 'physics'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => onSwitchSubject(s)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      subject === s
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary-400'
                    }`}
                  >
                    {SUBJECT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Экзамен</label>
              <div className="flex gap-2">
                {(['ege', 'oge'] as const).map(e => (
                  <button
                    key={e}
                    onClick={() => onSwitchExam(e)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      examType === e
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary-400'
                    }`}
                  >
                    {EXAM_LABELS[e]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Название варианта *</label>
            <input
              value={title}
              onChange={e => onTitleChange(e.target.value)}
              placeholder="Например: Вариант №1 по физике ЕГЭ"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          {showDescription && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Описание (необязательно)</label>
              <textarea
                value={description}
                onChange={e => onDescChange(e.target.value)}
                rows={2}
                placeholder="Для группы 10А, подготовка к пробнику..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
              />
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Пресеты</h3>
            <p className="text-xs text-gray-500 mt-1">Быстро проставляют количество задач по разделам. После этого можно править вручную.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="variant-preset-standard"
              onClick={() => onApplyPreset('standard')}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-primary-300 hover:bg-primary-50 transition-colors"
            >
              Стандартный вариант
            </button>
            <button
              type="button"
              data-testid="variant-preset-part1"
              onClick={() => onApplyPreset('part1')}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-primary-300 hover:bg-primary-50 transition-colors"
            >
              Только 1 часть
            </button>
            <button
              type="button"
              data-testid="variant-preset-part2"
              onClick={() => onApplyPreset('part2')}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-primary-300 hover:bg-primary-50 transition-colors"
            >
              Только 2 часть
            </button>
          </div>
        </div>

        <h2 className="font-semibold text-gray-800 px-1">Выберите разделы и темы</h2>

        {loadingSections ? (
          <SectionsSkeleton />
        ) : sections.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            Разделы не найдены для выбранных параметров
          </div>
        ) : (
          <div className="space-y-2">
            {sections.map(section => (
              <SectionCard
                key={section.id}
                section={section}
                state={sectionStates[section.id] ?? { enabled: false, expanded: false, cnt: 0, topicIds: new Set() }}
                onToggle={() => onToggleSection(section.id)}
                onToggleExpand={() => onToggleExpand(section.id)}
                onSetCnt={v => onSetCnt(section.id, v)}
                onToggleTopic={topicId => onToggleTopic(section.id, topicId)}
              />
            ))}
          </div>
        )}

        {genError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{genError}</p>
          </div>
        )}
      </div>

      <div className="w-full lg:w-72 lg:flex-shrink-0">
        <div className="lg:sticky lg:top-6 bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800">Итог</h3>
          <div className="space-y-2 text-sm">
            <Row label="Предмет" value={SUBJECT_LABELS[subject] ?? subject} />
            <Row label="Экзамен" value={EXAM_LABELS[examType] ?? examType} />
            <Row label="Разделов" value={String(enabledSections.length)} />
            <Row label="Тем" value={String(totalTopics)} />
            <Row label="Задач" value={<span className="font-bold text-primary-600 text-base">{totalTasks}</span>} />
          </div>

          {!title.trim() && (
            <p className="text-xs text-amber-600 flex gap-1.5 items-start">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              Введите название варианта
            </p>
          )}
          {totalTasks === 0 && (
            <p className="text-xs text-amber-600 flex gap-1.5 items-start">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              Укажите количество задач в хотя бы одном разделе
            </p>
          )}

          <button
            onClick={onGenerate}
            disabled={!canGenerate || generating}
            data-testid="variant-constructor-generate"
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              canGenerate && !generating
                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {generating
              ? <><Loader2 size={16} className="animate-spin" /> Генерация...</>
              : <><Eye size={16} /> Сгенерировать</>
            }
          </button>

          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors"
          >
            <RefreshCw size={14} /> Сбросить
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  )
}

function SectionCard({
  section, state, onToggle, onToggleExpand, onSetCnt, onToggleTopic,
}: {
  section: CatalogSection
  state: SectionState
  onToggle: () => void
  onToggleExpand: () => void
  onSetCnt: (v: number) => void
  onToggleTopic: (topicId: string) => void
}) {
  const { topics } = useSectionTopics(state.expanded ? section.id : undefined)
  const visibleTopics = topics.filter(t => (t.task_count ?? 0) > 0)

  return (
    <div className={`bg-white rounded-xl border transition-all ${state.enabled ? 'border-primary-300 shadow-sm' : 'border-gray-200'}`}>
      <div className="flex items-center gap-3 p-4">
        <button onClick={onToggle} className="flex-shrink-0" data-testid={`variant-section-toggle-${section.id}`}>
          {state.enabled ? <CheckSquare size={20} className="text-primary-600" /> : <Square size={20} className="text-gray-300 hover:text-gray-400" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {section.exam_number && (
              <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                №{section.exam_number}
              </span>
            )}
            <span className="text-sm font-medium text-gray-800 leading-tight">{section.title}</span>
            <span className="text-xs text-gray-400">{section.task_count ?? 0} задач</span>
          </div>
          {state.enabled && state.topicIds.size > 0 && (
            <span className="text-xs text-primary-600 mt-0.5 block">{state.topicIds.size} тем выбрано</span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onSetCnt(state.cnt - 1)}
            disabled={state.cnt === 0}
            className="w-6 h-6 rounded flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus size={12} />
          </button>
          <input
            type="number"
            value={state.cnt}
            min={0}
            max={section.task_count ?? 999}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              onSetCnt(isNaN(v) ? 0 : v)
            }}
            className="w-10 text-center text-sm border border-gray-200 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <button
            onClick={() => onSetCnt(state.cnt + 1)}
            data-testid={`variant-section-plus-${section.id}`}
            className="w-6 h-6 rounded flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>

        <button onClick={onToggleExpand} className="p-1 text-gray-400 hover:text-gray-600">
          {state.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {state.expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-1">
          {visibleTopics.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">Нет доступных тем</p>
          ) : (
            <>
              <div className="flex gap-3 mb-2">
                <button
                  onClick={() => visibleTopics.forEach(t => {
                    if (!state.topicIds.has(t.id)) onToggleTopic(t.id)
                  })}
                  className="text-xs text-primary-600 hover:underline"
                >
                  Выбрать все
                </button>
                <button
                  onClick={() => [...state.topicIds].forEach(id => onToggleTopic(id))}
                  className="text-xs text-gray-400 hover:underline"
                >
                  Снять выбор
                </button>
              </div>
              {visibleTopics.map(topic => (
                <button
                  key={topic.id}
                  onClick={() => onToggleTopic(topic.id)}
                  className="flex items-center gap-2 w-full text-left py-1 px-1 rounded hover:bg-gray-50 transition-colors"
                >
                  {state.topicIds.has(topic.id)
                    ? <CheckSquare size={15} className="text-primary-600 flex-shrink-0" />
                    : <Square size={15} className="text-gray-300 flex-shrink-0" />
                  }
                  <span className="text-sm text-gray-700 flex-1">{topic.title}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{topic.task_count}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function useSectionTopics(sectionId: string | undefined) {
  const { topics } = useCatalogTopics(sectionId)
  return { topics }
}

function PreviewStep({
  tasks, saving, dragIdx, subject, examType, title,
  completeActionLabel, showDraftAction,
  onSetDragIdx, onMove, onDelete, onReplace,
  onBack, onSaveDraft, onComplete, onRegenerate,
}: {
  tasks: GeneratedTask[]
  saving: boolean
  dragIdx: number | null
  subject: string
  examType: string
  title: string
  completeActionLabel: string
  showDraftAction: boolean
  onSetDragIdx: (i: number | null) => void
  onMove: (from: number, to: number) => void
  onDelete: (i: number) => void
  onReplace: (i: number) => void
  onBack: () => void
  onSaveDraft: () => void
  onComplete: () => void
  onRegenerate: () => void
}) {
  const [showPrintPanel, setShowPrintPanel] = useState(false)
  const printItems: PrintableItem[] = tasks.map(t => ({ id: t.task_id, task: t.task, customNumber: null }))

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">{tasks.length} задач в варианте</h2>
            <button onClick={onRegenerate} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              <RefreshCw size={14} /> Перегенерировать
            </button>
          </div>

          {tasks.map((t, idx) => (
            <div
              key={`${t.task_id}-${idx}`}
              draggable
              data-testid="student-generated-item"
              onDragStart={() => onSetDragIdx(idx)}
              onDragOver={e => { e.preventDefault() }}
              onDrop={() => { if (dragIdx !== null && dragIdx !== idx) onMove(dragIdx, idx); onSetDragIdx(null) }}
              className={`transition-opacity ${dragIdx === idx ? 'opacity-40' : 'opacity-100'}`}
            >
              {t.task ? (
                <div className="group relative">
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <GripVertical size={14} className="text-gray-300 cursor-grab active:cursor-grabbing" />
                    <span className="text-xs font-medium text-gray-500">Задача {idx + 1}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => onReplace(idx)}
                      data-testid={`student-generated-replace-${idx}`}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors px-2 py-1 rounded hover:bg-blue-50"
                    >
                      <RefreshCw size={12} /> Заменить
                    </button>
                    <button onClick={() => onDelete(idx)} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50">
                      <Trash2 size={12} /> Удалить
                    </button>
                  </div>
                  <CatalogTaskContent task={t.task} variantNumber={idx + 1} showControls={true} />
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-sm text-gray-400 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Загрузка задачи...
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="w-full lg:w-72 lg:flex-shrink-0">
          <div className="lg:sticky lg:top-6 bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="font-semibold text-gray-800">Действия</h3>
            <p className="text-sm text-gray-500">Задач в варианте: <strong>{tasks.length}</strong></p>

            <Button variant="primary" className="w-full" onClick={onComplete} disabled={saving} data-testid="student-generator-create">
              {saving ? <Loader2 size={15} className="animate-spin mr-1" /> : <Save size={15} className="mr-1" />}
              {completeActionLabel}
            </Button>

            {showDraftAction && (
              <Button variant="secondary" className="w-full" onClick={onSaveDraft} disabled={saving}>
                <Save size={15} className="mr-1" />
                Сохранить черновик
              </Button>
            )}

            <button
              onClick={onBack}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors"
            >
              <ArrowLeft size={14} /> Вернуться к настройкам
            </button>

            <button
              onClick={() => setShowPrintPanel(v => !v)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm text-primary-700 hover:bg-primary-50 border border-primary-200 transition-colors"
            >
              <FileDown size={14} /> {showPrintPanel ? 'Скрыть печать' : 'Печать / PDF'}
            </button>
          </div>
        </div>
      </div>

      {showPrintPanel && tasks.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <VariantPrintPanel items={printItems} subject={subject} examType={examType} initialTitle={title} fileNamePrefix="Вариант" />
        </div>
      )}
    </>
  )
}

function SectionsSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-gray-100 rounded-xl h-14" />
      ))}
    </div>
  )
}

function BuilderSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-64" />
      <div className="h-48 bg-gray-100 rounded-xl" />
      <div className="h-14 bg-gray-100 rounded-xl" />
      <div className="h-14 bg-gray-100 rounded-xl" />
    </div>
  )
}
