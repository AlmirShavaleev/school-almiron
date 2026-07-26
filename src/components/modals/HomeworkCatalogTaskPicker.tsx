import { useState } from 'react'
import { Loader2, Plus, Check, Search } from 'lucide-react'
import { Select, Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import { ALL_SUBJECTS, SUBJECT_SLUGS, EXAMS_FOR_SUBJECT, EXAM_FROM_SLUG, useCatalogSections, useCatalogTopics, useCatalogTasks, useCatalogSearch } from '@/hooks/useCatalog'

// EXAMS_FOR_SUBJECT/EXAM_FROM_SLUG are keyed by slug ('math'/'physics', 'ege'/'oge'), not by
// the Cyrillic display values useCatalogSections expects — resolve subject -> slug -> exam list.
function examsForSubject(subject: string): string[] {
  const slug = SUBJECT_SLUGS[subject]
  return (EXAMS_FOR_SUBJECT[slug] || []).map(s => EXAM_FROM_SLUG[s] || s)
}

interface Props {
  onAdd: (task: import('@/hooks/useCatalog').CatalogTask) => void
  isSelected: (catalogTaskId: string) => boolean
  embedded?: boolean
  onTopicChange?: (topic: { id: string; title: string } | null) => void
}

/** Reuses the existing catalog browsing/search hooks (useCatalogSections/useCatalogTopics/
 * useCatalogTasks/useCatalogSearch) — no task_collections read/write anywhere here, this only
 * ever reads catalog_tasks + related catalog_* tables. */
export function HomeworkCatalogTaskPicker({ onAdd, isSelected, embedded = false, onTopicChange }: Props) {
  const [subject, setSubject] = useState<string>(ALL_SUBJECTS[0])
  const [examType, setExamType] = useState<string>(examsForSubject(ALL_SUBJECTS[0])[0] || '')
  const [sectionId, setSectionId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [mode, setMode] = useState<'topic' | 'search'>('topic')
  const [searchQuery, setSearchQuery] = useState('')
  const [difficulty, setDifficulty] = useState('')

  const { sections, loading: sectionsLoading } = useCatalogSections(subject, examType)
  const { topics, loading: topicsLoading } = useCatalogTopics(sectionId || undefined)
  const { tasks, loading: tasksLoading } = useCatalogTasks(mode === 'topic' ? (topicId || undefined) : undefined)
  const { results: searchResults, loading: searchLoading } = useCatalogSearch(mode === 'search' ? searchQuery : '', sectionId || undefined, mode === 'search')

  const difficulties = [...new Set(tasks.map(t => t.difficulty).filter(Boolean))] as string[]
  const visibleTasks = difficulty ? tasks.filter(t => t.difficulty === difficulty) : tasks

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Select label="Предмет" value={subject} onChange={e => { setSubject(e.target.value); setExamType(examsForSubject(e.target.value)[0] || ''); setSectionId(''); setTopicId(''); onTopicChange?.(null) }}
          options={ALL_SUBJECTS.map(s => ({ value: s, label: s }))} />
        <Select label="Экзамен" value={examType} onChange={e => { setExamType(e.target.value); setSectionId(''); setTopicId(''); onTopicChange?.(null) }}
          options={examsForSubject(subject).map(e => ({ value: e, label: e }))} />
      </div>

      <Select label="Раздел" value={sectionId} onChange={e => { setSectionId(e.target.value); setTopicId(''); onTopicChange?.(null) }} disabled={sectionsLoading}
        options={[{ value: '', label: sectionsLoading ? 'Загрузка…' : '— выберите раздел —' }, ...sections.map(s => ({ value: s.id, label: `${s.title} (${s.task_count})` }))]} />

      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('topic')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${mode === 'topic' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
          По теме
        </button>
        <button type="button" onClick={() => setMode('search')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${mode === 'search' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
          Поиск / номер
        </button>
      </div>

      {mode === 'topic' ? (
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Тема"
            value={topicId}
            onChange={e => {
              const nextTopicId = e.target.value
              setTopicId(nextTopicId)
              const selectedTopic = topics.find(topic => topic.id === nextTopicId)
              onTopicChange?.(selectedTopic ? { id: selectedTopic.id, title: selectedTopic.title } : null)
            }}
            disabled={!sectionId || topicsLoading}
            options={[{ value: '', label: topicsLoading ? 'Загрузка…' : '— выберите тему —' }, ...topics.map(t => ({ value: t.id, label: t.title }))]} />
          {difficulties.length > 0 && (
            <Select label="Сложность" value={difficulty} onChange={e => setDifficulty(e.target.value)}
              options={[{ value: '', label: 'Любая' }, ...difficulties.map(d => ({ value: d, label: d }))]} />
          )}
        </div>
      ) : (
        <div className="relative">
          <Input label="Номер задания или текст (в выбранном разделе)" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            icon={<Search size={14} />} disabled={!sectionId} placeholder={sectionId ? 'например: 12' : 'сначала выберите раздел'} />
        </div>
      )}

      {mode === 'topic' && sectionId && !topicsLoading && topics.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
          В этом разделе нет тем
        </p>
      )}

      <div className={`${embedded ? 'space-y-2' : 'max-h-96 overflow-y-auto space-y-2'} rounded-xl border border-gray-100 bg-gray-50/50 p-2`}>
        {(mode === 'topic' ? tasksLoading : searchLoading) ? (
          <div className="flex items-center justify-center py-6 text-gray-400 gap-2"><Loader2 size={16} className="animate-spin" />Загрузка задач…</div>
        ) : mode === 'topic' ? (
          visibleTasks.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-4">{topicId ? 'Нет задач в теме' : 'Выберите тему'}</p>
          ) : visibleTasks.map((task, idx) => (
            <TaskDisplayCard
              key={task.id}
              task={task}
              number={idx + 1}
              defaultOpen={{ answer: false, solution: false }}
              extraActions={
                <Button size="sm" variant={isSelected(task.id) ? 'secondary' : 'primary'} onClick={() => onAdd(task)} disabled={isSelected(task.id)}>
                  {isSelected(task.id) ? <><Check size={13} className="mr-1" />Добавлено</> : <><Plus size={13} className="mr-1" />Добавить</>}
                </Button>
              }
            />
          ))
        ) : searchResults.length === 0 ? (
          <p className="text-center text-xs text-gray-400 py-4">{searchQuery.trim().length >= 2 ? 'Ничего не найдено' : 'Введите минимум 2 символа'}</p>
        ) : (
          searchResults.map((task, idx) => (
            <TaskDisplayCard
              key={task.id}
              task={task}
              number={idx + 1}
              defaultOpen={{ answer: false, solution: false }}
              extraActions={
                <Button size="sm" variant={isSelected(task.id) ? 'secondary' : 'primary'} onClick={() => onAdd(task)} disabled={isSelected(task.id)}>
                  {isSelected(task.id) ? <><Check size={13} className="mr-1" />Добавлено</> : <><Plus size={13} className="mr-1" />Добавить</>}
                </Button>
              }
            />
          ))
        )}
      </div>
    </div>
  )
}
