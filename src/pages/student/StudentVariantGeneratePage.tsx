import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BookOpen, CheckSquare, Hammer, Loader2, RefreshCw, Square } from 'lucide-react'
import { useCatalogSections, SUBJECT_FROM_SLUG, EXAM_FROM_SLUG, type CatalogSection } from '@/hooks/useCatalog'
import { useVariantBuilder, useCreateSelfBuiltVariant, usePickReplacementTask, type GeneratedTask, type VariantSectionConfig } from '@/hooks/useVariants'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

function sortSections(a: CatalogSection, b: CatalogSection) {
  const an = a.exam_number ?? 999
  const bn = b.exam_number ?? 999
  if (an === 0) return 1
  if (bn === 0) return -1
  return an - bn || a.position - b.position
}

function getStatementPreview(html?: string) {
  if (!html) return 'Условие загружается...'
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Условие загружается...'
}

export function StudentVariantGeneratePage() {
  const navigate = useNavigate()
  const { generateTasks, generating, genError, setGenError } = useVariantBuilder()
  const { create, saving: creating, error: createError } = useCreateSelfBuiltVariant()
  const { pick, loading: replacing, error: replaceError } = usePickReplacementTask()

  const [subject, setSubject] = useState<'math' | 'physics'>('math')
  const [examType, setExamType] = useState<'ege' | 'oge'>('ege')
  const [selectedSections, setSelectedSections] = useState<Record<string, boolean>>({})
  const [generatedTasksState, setGeneratedTasksState] = useState<GeneratedTask[]>([])
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const subjectDb = SUBJECT_FROM_SLUG[subject] ?? subject
  const examTypeDb = EXAM_FROM_SLUG[examType] ?? examType
  const { sections, loading: loadingSections, error: sectionsError } = useCatalogSections(subjectDb, examTypeDb)

  const sortedSections = useMemo(() => [...sections].sort(sortSections), [sections])
  const sectionById = useMemo(() => new Map(sortedSections.map(section => [section.id, section])), [sortedSections])

  useEffect(() => {
    if (sortedSections.length === 0) {
      setSelectedSections({})
      return
    }

    setSelectedSections(prev => {
      const next: Record<string, boolean> = {}
      for (const section of sortedSections) {
        next[section.id] = prev[section.id] ?? true
      }
      return next
    })
  }, [sortedSections])

  const selectedConfigs = useMemo<VariantSectionConfig[]>(
    () => sortedSections
      .filter(section => selectedSections[section.id])
      .map(section => ({
        section_id: section.id,
        cnt: 1,
        topic_ids: [],
      })),
    [selectedSections, sortedSections],
  )

  const canGenerate = selectedConfigs.length > 0 && !loadingSections && !generating

  const handleGenerate = async () => {
    setSelectionError(null)
    setPreviewError(null)
    setGenError(null)

    if (selectedConfigs.length === 0) {
      setSelectionError('Выберите хотя бы одну позицию')
      return
    }

    try {
      const tasks = await generateTasks(selectedConfigs)
      setGeneratedTasksState(tasks)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Не удалось сгенерировать вариант')
    }
  }

  const handleReplace = async (idx: number) => {
    const current = generatedTasksState[idx]
    if (!current) return

    const replacement = await pick({
      sectionId: current.section_id,
      topicId: current.topic_id || null,
      excludeIds: generatedTasksState.map(task => task.task_id),
    })
    if (!replacement) return

    setGeneratedTasksState(prev => prev.map((task, index) => (
      index === idx
        ? {
            ...task,
            task_id: replacement.id,
            task: replacement,
          }
        : task
    )))
  }

  const handleCreate = async () => {
    if (generatedTasksState.length === 0) return

    const studentAssignmentId = await create({
      title: `Вариант ${SUBJECT_LABELS[subject]} ${EXAM_LABELS[examType]}`,
      subject,
      examType,
      items: generatedTasksState.map((task, idx) => ({
        task_id: task.task_id,
        section_id: task.section_id,
        topic_id: task.topic_id || null,
        pos: idx + 1,
      })).map(({ pos: _pos, ...item }) => item),
    })

    if (studentAssignmentId) {
      navigate(`/student/variants/${studentAssignmentId}`)
    }
  }

  const toggleSection = (sectionId: string) => {
    setSelectedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/student/variants" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Сгенерировать вариант</h1>
          <p className="text-sm text-gray-500 mt-0.5">Система сама подберёт задачи по выбранным позициям экзамена</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Предмет</label>
            <select
              value={subject}
              onChange={e => {
                setSubject(e.target.value as 'math' | 'physics')
                setGeneratedTasksState([])
                setSelectionError(null)
                setPreviewError(null)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {(['math', 'physics'] as const).map(item => <option key={item} value={item}>{SUBJECT_LABELS[item]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Экзамен</label>
            <select
              value={examType}
              onChange={e => {
                setExamType(e.target.value as 'ege' | 'oge')
                setGeneratedTasksState([])
                setSelectionError(null)
                setPreviewError(null)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {(['ege', 'oge'] as const).map(item => <option key={item} value={item}>{EXAM_LABELS[item]}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Позиции экзамена</h2>
              <p className="text-sm text-gray-500">По умолчанию выбраны все доступные позиции</p>
            </div>
            <div className="flex gap-3 text-sm">
              <button
                onClick={() => setSelectedSections(Object.fromEntries(sortedSections.map(section => [section.id, true])))}
                className="text-blue-600 hover:underline"
              >
                Выбрать все
              </button>
              <button
                onClick={() => setSelectedSections(Object.fromEntries(sortedSections.map(section => [section.id, false])))}
                className="text-gray-500 hover:underline"
              >
                Снять всё
              </button>
            </div>
          </div>

          {loadingSections ? (
            <div className="py-8 text-center"><Loader2 size={22} className="animate-spin text-primary-500 mx-auto" /></div>
          ) : sectionsError ? (
            <ErrorBanner message={sectionsError} />
          ) : sortedSections.length === 0 ? (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">
              Позиции для выбранного экзамена не найдены
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sortedSections.map(section => (
                <button
                  key={section.id}
                  onClick={() => toggleSection(section.id)}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                    selectedSections[section.id]
                      ? 'border-primary-300 bg-primary-50/50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {selectedSections[section.id]
                    ? <CheckSquare size={18} className="text-primary-600 mt-0.5 shrink-0" />
                    : <Square size={18} className="text-gray-300 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {section.exam_number != null && section.exam_number > 0 && (
                        <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">№{section.exam_number}</span>
                      )}
                      <span className="text-sm font-medium text-gray-900">{section.title}</span>
                    </div>
                    <p className="text-xs text-gray-500">{section.task_count ?? 0} задач в банке</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectionError && <ErrorBanner message={selectionError} />}
        {previewError && <ErrorBanner message={previewError} />}
        {genError && <ErrorBanner message={genError} />}
        {replaceError && <ErrorBanner message={replaceError} />}
        {createError && <ErrorBanner message={createError} />}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-500">Выбрано позиций: <span className="font-medium text-gray-800">{selectedConfigs.length}</span></p>
          <button
            data-testid="student-generator-submit"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Hammer size={16} />}
            {generating ? 'Генерируем…' : 'Сгенерировать'}
          </button>
        </div>
      </div>

      {generatedTasksState.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Предпросмотр</h2>
              <p className="text-sm text-gray-500">Проверьте подбор и при необходимости замените отдельные позиции</p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-primary-400 hover:text-primary-700 transition-colors"
            >
              <RefreshCw size={14} />
              Сгенерировать заново
            </button>
          </div>

          <div className="space-y-3">
            {generatedTasksState.map((task, idx) => {
              const section = sectionById.get(task.section_id)
              return (
                <div key={`${task.task_id}-${idx}`} data-testid="student-generated-item" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Позиция {idx + 1}</span>
                        {section?.exam_number != null && section.exam_number > 0 && (
                          <span className="text-xs font-mono bg-white text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">№{section.exam_number}</span>
                        )}
                        <span className="text-xs text-gray-500">{task.task?.sectionTitle ?? section?.title ?? 'Раздел'}</span>
                      </div>
                      <p className="text-sm text-gray-800 leading-6">{getStatementPreview(task.task?.statement_html)}</p>
                    </div>
                    <button
                      data-testid={`student-generated-replace-${idx}`}
                      onClick={() => handleReplace(idx)}
                      disabled={replacing}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      {replacing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Заменить
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
            <div className="text-xs text-gray-500 flex items-start gap-2">
              <BookOpen size={14} className="mt-0.5 shrink-0" />
              <span>Часть 1 проверится автоматически. Часть 2 вы оцените сами после завершения.</span>
            </div>
            <button
              data-testid="student-generator-create"
              onClick={handleCreate}
              disabled={creating || generatedTasksState.length === 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Hammer size={16} />}
              {creating ? 'Создаём…' : 'Начать вариант'}
            </button>
          </div>
        </div>
      )}

      <div className="text-sm text-gray-500">
        Или используйте вторичный путь:
        {' '}
        <Link to="/student/variants/build" className="text-primary-600 hover:underline">собрать вручную из каталога</Link>
      </div>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}
