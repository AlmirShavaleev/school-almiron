import { useMemo, useState } from 'react'
import { BookOpen, LibraryBig, Loader2, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LessonTemplateEditorModal } from '@/components/modals/LessonTemplateEditorModal'
import { useLessonTemplates } from '@/hooks/useLessonLibrary'
import { toast } from '@/store/toastStore'
import { SUBJECT_LABELS, EXAM_LABELS, formatDateTime } from '@/utils/format'
import type { LessonTemplate } from '@/types/lessonLibrary'

export function LessonLibraryPage() {
  const { templates, loading, error, createTemplate, reload, deleteTemplate } = useLessonTemplates()
  const [query, setQuery] = useState('')
  const [openingTemplate, setOpeningTemplate] = useState<LessonTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(item =>
      item.title.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
    )
  }, [query, templates])

  async function handleCreateTemplate() {
    setCreating(true)
    try {
      const created = await createTemplate({
        title: 'Новый урок',
        subject: 'physics',
        exam_type: 'ege',
        description: null,
      })
      toast.success('Урок создан')
      setOpeningTemplate(created)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать урок')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
              <LibraryBig size={14} />
              Библиотека уроков
            </div>
            <h1 className="mt-3 text-3xl font-bold text-gray-900">Библиотека уроков</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">
              Личная библиотека учителя. Здесь редактируются тема, материалы bucket `lesson-library` и задачи каталога. В программу группы урок попадает только через copy-on-add.
            </p>
          </div>
          <Button onClick={handleCreateTemplate} loading={creating}>
            <Plus size={16} />
            Создать урок
          </Button>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по названию или описанию"
              className="min-h-11 w-full rounded-2xl border border-gray-200 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
            <Loader2 size={18} className="animate-spin" />
            Загрузка библиотеки…
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-gray-300 bg-white/80 px-6 py-16 text-center shadow-sm">
            <BookOpen size={28} className="mx-auto text-gray-300" />
            <div className="mt-3 text-lg font-semibold text-gray-900">{templates.length === 0 ? 'Библиотека пока пуста' : 'Ничего не найдено'}</div>
            <div className="mt-2 text-sm text-gray-500">{templates.length === 0 ? 'Создайте первый урок и наполните его материалами.' : 'Попробуйте другой поисковый запрос.'}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filtered.map(template => (
              <button
                key={template.id}
                onClick={() => setOpeningTemplate(template)}
                className="rounded-[28px] border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">{template.title}</div>
                    {template.description && <div className="mt-2 text-sm leading-relaxed text-gray-500">{template.description}</div>}
                  </div>
                  <div className="rounded-2xl bg-primary-50 p-3 text-primary-700">
                    <LibraryBig size={18} />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{SUBJECT_LABELS[template.subject]}</span>
                  {template.exam_type && <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{EXAM_LABELS[template.exam_type]}</span>}
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">updated {formatDateTime(template.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <LessonTemplateEditorModal
        open={!!openingTemplate}
        template={openingTemplate}
        onClose={() => setOpeningTemplate(null)}
        onSaved={reload}
        onDeleted={async (templateId) => {
          await deleteTemplate(templateId)
          setOpeningTemplate(null)
        }}
      />
    </>
  )
}
