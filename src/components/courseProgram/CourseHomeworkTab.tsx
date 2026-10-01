import { useState, type ComponentProps } from 'react'
import { cn } from '@/utils/cn'
import { useCourseHomeworkGrades } from '@/hooks/useCourseHomeworkGrades'
import { CourseTopicHomeworkSection } from './CourseTopicHomeworkSection'
import { CourseHomeworkJournal } from './CourseHomeworkJournal'

type HwView = 'table' | 'topics'

/**
 * §250. Вкладка курса «Домашние задания»: основной вид — журнал «ученики ×
 * разделы» (решение владельца 01.10, п. 4), второй — прежний список по темам
 * (`CourseTopicHomeworkSection`, со всем, что в нём есть: выдача, тумблер темы,
 * «Открыть заново» у работ по времени).
 *
 * `focusTopicId` (§241: «Работы» / «Кто пишет» из «Проверочных и контрольных»)
 * открывает «По темам» с раскрытой темой — как раньше: туда ведут ссылки, и
 * таблица уроков им не ответ (проверочных и контрольных в ней нет вовсе).
 */
export function CourseHomeworkTab({ courseId, modules, refreshKey = 0, onToggleTopicOpen, focusTopicId = null, groupName }: {
  courseId: string
  modules: ComponentProps<typeof CourseTopicHomeworkSection>['modules']
  refreshKey?: number
  onToggleTopicOpen?: (topicId: string, isOpen: boolean) => Promise<void>
  focusTopicId?: string | null
  groupName: string | null
}) {
  const [view, setView] = useState<HwView>(focusTopicId ? 'topics' : 'table')
  // Пришли по ссылке «Работы» уже на открытой вкладке — тоже «По темам»
  // (смена пропа ловится в рендере, без эффекта).
  const [seenFocus, setSeenFocus] = useState(focusTopicId)
  if (seenFocus !== focusTopicId) {
    setSeenFocus(focusTopicId)
    if (focusTopicId) setView('topics')
  }
  const journal = useCourseHomeworkGrades(courseId, refreshKey, view === 'table')

  return (
    <div className="space-y-4" data-testid="hw-tab">
      <span role="group" aria-label="Вид" data-testid="hw-view" className="inline-flex max-w-full overflow-hidden rounded-lg border border-gray-200">
        {([['table', 'Таблица'], ['topics', 'По темам']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-key={key}
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={cn(
              'min-h-11 px-4 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400 md:min-h-9',
              view === key ? 'bg-primary-600 text-white' : 'bg-white text-graphite-600 hover:text-graphite-900',
            )}
          >
            {label}
          </button>
        ))}
      </span>
      {view === 'table' ? (
        <CourseHomeworkJournal status={journal.status} data={journal.data} groupName={groupName} onShowTopics={() => setView('topics')} />
      ) : (
        <CourseTopicHomeworkSection courseId={courseId} modules={modules} refreshKey={refreshKey} onToggleTopicOpen={onToggleTopicOpen} focusTopicId={focusTopicId} />
      )}
    </div>
  )
}
