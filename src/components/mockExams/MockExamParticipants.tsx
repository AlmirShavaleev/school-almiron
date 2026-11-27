import { ChevronDown, Plus, X } from 'lucide-react'
import type { MockExamGroupOption } from '@/hooks/useMockExamGroups'
import { byName, studentsLabel, type RosterStudent } from '@/lib/mockExamVariants'
import { cn } from '@/utils/cn'

export type ExamParticipant = RosterStudent & { groupId: string }

export function MockExamParticipants({
  groups, openGroupId, onOpen, participants, onChange, roster, loading, error, onRetry, disabled, readOnly,
}: {
  groups: MockExamGroupOption[]
  openGroupId: string | null
  onOpen: (groupId: string | null) => void
  participants: ExamParticipant[]
  onChange: (participants: ExamParticipant[]) => void
  roster: RosterStudent[]
  loading: boolean
  error: string | null
  onRetry: () => void
  disabled?: boolean
  readOnly?: boolean
}) {
  const selected = new Set(participants.map(student => student.id))
  const groupsById = new Map(groups.map(group => [group.id, group.name]))
  const countByGroup = new Map<string, number>()
  for (const student of participants) countByGroup.set(student.groupId, (countByGroup.get(student.groupId) ?? 0) + 1)

  return (
    <fieldset className="min-w-0 space-y-3 [container-type:inline-size]" disabled={disabled}>
      <legend className="text-sm font-semibold text-ink">Участники пробника</legend>
      {!readOnly && <p className="text-sm text-graphite-600">Раскройте группу и выберите отдельных учеников или добавьте всех сразу.</p>}
      <div className={cn('grid items-start gap-3', !readOnly && '[@container(min-width:560px)]:grid-cols-2')}>
        {!readOnly && (
          <div className="overflow-hidden rounded-2xl border border-primary-100 bg-white" data-testid="mock-form-groups">
            <h3 className="border-b border-primary-100 px-4 py-3 text-sm font-semibold text-ink">Группы</h3>
            {groups.length === 0 && <p className="px-4 py-3 text-sm text-graphite-500">Нет доступных групп.</p>}
            <ul className="max-h-72 divide-y divide-primary-100 overflow-y-auto">
              {groups.map(group => {
                const open = group.id === openGroupId
                const count = countByGroup.get(group.id) ?? 0
                const panelId = `mock-roster-${group.id}`
                const available = open && roster.some(student => !selected.has(student.id))
                return (
                  <li key={group.id}>
                    <button
                      type="button" aria-expanded={open} aria-controls={open ? panelId : undefined}
                      onClick={() => onOpen(open ? null : group.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-primary-50 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                    >
                      <ChevronDown aria-hidden size={16} className={cn('shrink-0 text-graphite-500', open && 'rotate-180')} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold text-ink">{group.name}</span>
                        {group.courseName && group.courseName !== group.name && <span className="block break-words text-xs text-graphite-500">{group.courseName}</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-graphite-600">
                        {count > 0 ? `${count} выбрано` : group.count == null ? null : studentsLabel(group.count)}
                      </span>
                    </button>
                    {open && (
                      <div id={panelId} className="space-y-2 border-t border-primary-100 bg-primary-50/40 px-4 py-3">
                        {loading ? <p role="status" className="text-sm text-graphite-600">Загружаем учеников…</p>
                          : error ? (
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span role="alert" className="text-red-700">Не удалось загрузить учеников.</span>
                              <button type="button" onClick={onRetry} className="font-semibold text-primary-700 underline">Повторить</button>
                            </div>
                          ) : roster.length === 0 ? <p className="text-sm text-graphite-600">В группе пока нет учеников.</p>
                            : (
                              <>
                                <button
                                  type="button" disabled={!available}
                                  onClick={() => onChange([...participants, ...roster.filter(student => !selected.has(student.id)).map(student => ({ ...student, groupId: group.id }))])}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-white px-3 py-1.5 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:text-graphite-500"
                                >
                                  <Plus aria-hidden size={15} />
                                  {available ? 'Добавить всю группу' : 'Все ученики добавлены'}
                                </button>
                                <ul>
                                  {roster.map(student => (
                                    <li key={student.id}>
                                      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white">
                                        <input
                                          type="checkbox" checked={selected.has(student.id)} className="size-4 shrink-0 accent-primary-600"
                                          onChange={event => onChange(event.target.checked
                                            ? [...participants, { ...student, groupId: group.id }]
                                            : participants.filter(item => item.id !== student.id))}
                                        />
                                        <span className="min-w-0 break-words">{student.name}</span>
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <section aria-label="Кто пишет" className="overflow-hidden rounded-2xl border border-primary-100 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Кто пишет</h3>
            <span aria-live="polite" className="text-xs font-medium tabular-nums text-graphite-600">{studentsLabel(participants.length)}</span>
          </div>
          {participants.length === 0 ? <p className="px-4 pb-3 text-sm text-graphite-500">{readOnly ? (loading ? 'Загружаем учеников…' : 'Список участников пуст.') : 'Выбранные ученики появятся здесь.'}</p>
            : (
              <ul className="max-h-64 divide-y divide-primary-100 overflow-y-auto border-t border-primary-100">
                {byName(participants).map(student => (
                  <li key={student.id} className="flex min-w-0 items-center gap-3 px-4 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-medium text-ink">{student.name}</div>
                      <div className="break-words text-xs text-graphite-500">{groupsById.get(student.groupId)}</div>
                    </div>
                    {!readOnly && <button
                      type="button" onClick={() => onChange(participants.filter(item => item.id !== student.id))}
                      aria-label={`Убрать ${student.name} из списка`} title="Убрать из списка"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-graphite-600 hover:bg-primary-50 hover:text-ink focus-visible:outline-primary-500"
                    >
                      <X aria-hidden size={16} />
                    </button>}
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </fieldset>
  )
}
