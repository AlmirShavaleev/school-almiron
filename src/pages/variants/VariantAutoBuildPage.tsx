import { useState, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  ArrowLeft, Loader2, Search, Wand2, AlertTriangle, Save, RefreshCw, X,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import {
  useVariantTopicSections,
  useVariantSelectionAvailability,
  useVariantAutoBuild,
  levelScaleFor,
  LEVELS_BY_SCALE,
  LEVEL_LABELS,
  SCALE_HINTS,
  type VariantLevel,
  type AutoBuiltTask,
  type SectionGroup,
} from '@/hooks/useVariantAutoBuild'
import { useVariantBuilder } from '@/hooks/useVariants'
import { useCatalogTasksBatch, SUBJECT_FROM_SLUG, EXAM_FROM_SLUG } from '@/hooks/useCatalog'
import { CatalogTaskContent } from '@/components/catalog/CatalogTaskContent'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/toastStore'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

/**
 * Автосборка теста из каталога: тема + раскладка по сложности.
 *
 * Без ИИ — детерминированная случайная выборка через RPC. Задачи без
 * эталонного ответа не попадают: фильтр стоит в самой выборке, а не здесь.
 *
 * Главное в интерфейсе — остатки. По физике ЕГЭ «сложных» задач 95 штук на 94
 * темы, поэтому запрос вроде «3 сложных по одной теме» не набирается постоянно,
 * и учитель должен видеть это ДО нажатия, а не ловить ошибку после.
 */
export function VariantAutoBuildPage() {
  const navigate = useNavigate()
  const { examSubject = 'math', examType = 'ege' } = useParams<{ examSubject?: string; examType?: string }>()

  const subjectDb  = SUBJECT_FROM_SLUG[examSubject] ?? examSubject
  const examTypeDb = EXAM_FROM_SLUG[examType] ?? examType
  const scale      = levelScaleFor(subjectDb, examTypeDb)
  const levels     = LEVELS_BY_SCALE[scale]

  // ИИ-дерево физики — отдельная таксономия. Смешивать её с обычными темами в
  // одной выборке нельзя: связи не пересекаются, а счётчики задвоятся.
  const canPickSource = subjectDb === 'Физика'
  const [topicSource, setTopicSource] = useState<string | null>(null)

  const [title, setTitle] = useState(
    `${SUBJECT_LABELS[examSubject] ?? examSubject} ${EXAM_LABELS[examType] ?? examType} — ${format(new Date(), 'd MMMM', { locale: ru })}`
  )
  const [search, setSearch] = useState('')
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])
  const [counts, setCounts] = useState<Partial<Record<VariantLevel, number>>>({})
  const [built, setBuilt] = useState<AutoBuiltTask[] | null>(null)

  const { sections, loading: topicsLoading, error: topicsError } =
    useVariantTopicSections(subjectDb, examTypeDb, topicSource)
  const { byLevel, loading: availLoading } =
    useVariantSelectionAvailability(subjectDb, examTypeDb, selectedTopics, topicSource)
  const { generate, generating, error: buildError, setError: setBuildError } = useVariantAutoBuild()
  const { saveVariant, saving } = useVariantBuilder()

  // Поиск идёт и по заголовку номера, и по теме. Совпал номер — показываем его
  // целиком; совпала тема — показываем номер только с подходящими темами.
  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sections
    const result: SectionGroup[] = []
    for (const section of sections) {
      if (section.title.toLowerCase().includes(q)) { result.push(section); continue }
      const topics = section.topics.filter(t => t.title.toLowerCase().includes(q))
      if (topics.length) result.push({ ...section, topics })
    }
    return result
  }, [sections, search])

  const searching = search.trim().length > 0
  const [expanded, setExpanded] = useState<string[]>([])

  const toggleExpanded = (id: string) =>
    setExpanded(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])

  const toggleSection = (section: SectionGroup) => {
    setBuilt(null)
    const ids = section.topics.map(t => t.id)
    const allOn = ids.every(id => selectedTopics.includes(id))
    setSelectedTopics(prev => allOn
      ? prev.filter(id => !ids.includes(id))
      : [...new Set([...prev, ...ids])])
  }

  const totalRequested = useMemo(
    () => levels.reduce((sum, lvl) => sum + (counts[lvl] ?? 0), 0),
    [levels, counts],
  )

  const shortages = useMemo(
    () => levels.filter(lvl => (counts[lvl] ?? 0) > (byLevel[lvl] ?? 0)),
    [levels, counts, byLevel],
  )

  const canBuild =
    selectedTopics.length > 0 &&
    totalRequested > 0 &&
    totalRequested <= 50 &&
    shortages.length === 0 &&
    !availLoading

  const toggleTopic = (id: string) => {
    setBuilt(null)
    setSelectedTopics(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  const setCount = (level: VariantLevel, value: number) => {
    setBuilt(null)
    setCounts(prev => ({ ...prev, [level]: Math.max(0, value) }))
  }

  const switchSource = (next: string | null) => {
    setTopicSource(next)
    setSelectedTopics([])
    setExpanded([])
    setBuilt(null)
  }

  async function handleBuild() {
    setBuildError(null)
    const result = await generate({
      subjectDb, examTypeDb, topicIds: selectedTopics, levels: counts, topicSource,
    })
    if (result) setBuilt(result)
  }

  async function handleSave() {
    if (!built?.length) return
    try {
      const variantId = await saveVariant({
        variantId:   null,
        title:       title.trim() || 'Тест без названия',
        description: '',
        subject:     examSubject,
        examType:    examType,
        status:      'ready',
        settings: {
          sections: [],
          generation_mode: 'auto_topic',
          autobuild: {
            subject:      subjectDb,
            exam_type:    examTypeDb,
            topic_ids:    selectedTopics,
            topic_source: topicSource,
            levels:       Object.fromEntries(
              levels.filter(l => (counts[l] ?? 0) > 0).map(l => [l, counts[l] as number])
            ),
          },
        },
        items: built.map(t => ({
          task_id:    t.task_id,
          section_id: t.section_id,
          topic_id:   t.topic_id,
          position:   t.position,
        })),
      })
      toast.success('Тест собран и сохранён')
      navigate(`/variants/${variantId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить тест')
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link
        to={`/variants/exam/${examSubject}/${examType}`}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1"
      >
        <ArrowLeft size={14} /> К списку тестов
      </Link>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Автосборка теста</h1>
      <p className="text-sm text-gray-500 mb-6">
        {SUBJECT_LABELS[examSubject] ?? examSubject} {EXAM_LABELS[examType] ?? examType} ·
        {' '}задачи без эталонного ответа не попадают
      </p>

      {/* 1. Название */}
      <Section step={1} title="Название">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          placeholder="Название теста"
        />
      </Section>

      {/* 2. Темы */}
      <Section
        step={2}
        title="Темы"
        hint={selectedTopics.length ? `выбрано ${selectedTopics.length}` : undefined}
      >
        {canPickSource && (
          <div className="flex items-center gap-2 mb-3">
            <SourceTab active={topicSource === null} onClick={() => switchSource(null)}>
              Темы каталога
            </SourceTab>
            <SourceTab active={topicSource === 'ai_physics_v1'} onClick={() => switchSource('ai_physics_v1')}>
              ИИ-дерево физики
            </SourceTab>
          </div>
        )}

        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по номеру или теме..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Галочка на номере берёт все его темы разом — так быстрее, чем выбирать поштучно.
        </p>

        {topicsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={22} className="animate-spin text-primary-600" />
          </div>
        ) : topicsError ? (
          <p className="text-sm text-red-600 py-2">{topicsError}</p>
        ) : filteredSections.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            {sections.length === 0
              ? 'По этому экзамену нет тем с задачами, у которых есть эталонный ответ.'
              : 'Ничего не найдено.'}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
            {filteredSections.map(section => {
              const ids      = section.topics.map(t => t.id)
              const picked   = ids.filter(id => selectedTopics.includes(id)).length
              const isOpen   = searching || expanded.includes(section.id)

              return (
                <div key={section.id}>
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={picked === ids.length && ids.length > 0}
                      ref={el => { if (el) el.indeterminate = picked > 0 && picked < ids.length }}
                      onChange={() => toggleSection(section)}
                      className="flex-shrink-0"
                      aria-label={`Выбрать все темы: ${section.title}`}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpanded(section.id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      {isOpen
                        ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                        : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-gray-800 truncate">{section.title}</span>
                        <span className="block text-xs text-gray-400">
                          {section.topics.length} {plural(section.topics.length, 'тема', 'темы', 'тем')}
                          {picked > 0 && ` · выбрано ${picked}`}
                        </span>
                      </span>
                    </button>
                  </div>

                  {isOpen && (
                    <div className="bg-gray-50/60 border-t border-gray-100">
                      {section.topics.map(topic => (
                        <label
                          key={topic.id}
                          className="flex items-start gap-3 pl-9 pr-3 py-2 hover:bg-gray-100/60 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTopics.includes(topic.id)}
                            onChange={() => toggleTopic(topic.id)}
                            className="mt-1 flex-shrink-0"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-gray-700">{topic.title}</span>
                            <span className="block text-xs text-gray-400">
                              {levels
                                .filter(l => (topic.byLevel[l] ?? 0) > 0)
                                .map(l => `${LEVEL_LABELS[l].toLowerCase()}: ${topic.byLevel[l]}`)
                                .join(' · ') || 'нет задач с эталоном'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* 3. Раскладка */}
      <Section step={3} title="Раскладка по сложности">
        <p className="text-xs text-gray-500 mb-3">{SCALE_HINTS[scale]}</p>

        {selectedTopics.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">Сначала выберите темы — тогда станут видны остатки.</p>
        ) : (
          <div className="space-y-3">
            {levels.map(level => {
              const requested = counts[level] ?? 0
              const available = byLevel[level] ?? 0
              const short     = requested > available
              return (
                <div key={level} className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm text-gray-700 w-32 flex-shrink-0">
                    {LEVEL_LABELS[level]}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={requested}
                    onChange={e => setCount(level, Number(e.target.value))}
                    className={`w-20 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
                      short
                        ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-400'
                        : 'border-gray-200 focus:ring-primary-400'
                    }`}
                  />
                  <span className={`text-xs ${short ? 'text-red-600' : 'text-gray-400'}`}>
                    {availLoading
                      ? 'считаем...'
                      : short
                        ? `доступно только ${available}`
                        : `доступно ${available}`}
                  </span>
                </div>
              )
            })}

            <div className="pt-2 text-sm text-gray-600 border-t border-gray-100">
              Всего задач: <span className="font-medium">{totalRequested}</span>
              {totalRequested > 50 && (
                <span className="text-red-600 ml-2">не больше 50</span>
              )}
            </div>
          </div>
        )}
      </Section>

      {shortages.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            Задач не хватает:{' '}
            {shortages
              .map(l => `${LEVEL_LABELS[l].toLowerCase()} — ${counts[l] ?? 0} из ${byLevel[l] ?? 0}`)
              .join('; ')}
            . Уменьшите количество или добавьте темы.
          </span>
        </div>
      )}

      {buildError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{buildError}</span>
          <button onClick={() => setBuildError(null)} className="text-red-400 hover:text-red-600">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-6">
        <Button variant="primary" onClick={handleBuild} disabled={!canBuild || generating}>
          {generating
            ? <Loader2 size={16} className="mr-1.5 animate-spin" />
            : <Wand2 size={16} className="mr-1.5" />}
          {built ? 'Собрать заново' : 'Собрать'}
        </Button>
        {built && (
          <Button variant="success" onClick={handleSave} disabled={saving}>
            {saving
              ? <Loader2 size={16} className="mr-1.5 animate-spin" />
              : <Save size={16} className="mr-1.5" />}
            Сохранить тест
          </Button>
        )}
      </div>

      {built && <BuiltPreview tasks={built} onRebuild={handleBuild} rebuilding={generating} />}
    </div>
  )
}

// ── Предпросмотр собранного ──────────────────────────────────────────────────

function BuiltPreview({ tasks, onRebuild, rebuilding }: {
  tasks: AutoBuiltTask[]
  onRebuild: () => void
  rebuilding: boolean
}) {
  const taskIds = useMemo(() => tasks.map(t => t.task_id), [tasks])
  const { tasks: loaded, loading } = useCatalogTasksBatch(taskIds)
  const byId = useMemo(() => new Map(loaded.map(t => [t.id, t])), [loaded])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-medium text-gray-900">Собрано: {tasks.length} задач</h2>
        <button
          onClick={onRebuild}
          disabled={rebuilding}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={rebuilding ? 'animate-spin' : ''} />
          Другая выборка
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={22} className="animate-spin text-primary-600" />
        </div>
      ) : (
        <ol className="space-y-3">
          {tasks.map(item => {
            const task = byId.get(item.task_id)
            return (
              <li key={item.task_id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1 text-xs text-gray-400">
                  <span className="font-medium text-gray-600">№{item.position}</span>
                  <span>{LEVEL_LABELS[item.level]}</span>
                </div>
                {task
                  ? <CatalogTaskContent task={task} />
                  : <span className="text-sm text-gray-400">Задача не загрузилась</span>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function Section({ step, title, hint, children }: {
  step: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-50 text-primary-700 text-xs font-medium">
          {step}
        </span>
        <h2 className="font-medium text-gray-900">{title}</h2>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function SourceTab({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-primary-50 text-primary-700 font-medium'
          : 'text-gray-500 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}
