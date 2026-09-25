import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { useMockExamTemplates } from '@/hooks/useMockExamTemplates'

/**
 * §218. Пробник заводится ОТ ШАБЛОНА: предмет, тип экзамена и максимум
 * берутся из него, а не вводятся руками. Иначе «макс. балл 100» в форме
 * расходился бы с 32 первичными шаблона, и итог «18 из 100» врал бы.
 * Группа обязательна по-прежнему: без неё нет списка учеников.
 */
const schema = z.object({
  title:       z.string().min(2, 'Введите название'),
  date:        z.string().min(1, 'Укажите дату'),
  group_id:    z.string().min(1, 'Выберите группу'),
  template_id: z.string().min(1, 'Выберите шаблон'),
})
type FormValues = z.infer<typeof schema>

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (examId: string) => void
}

export function CreateMockExamModal({ open, onClose, onCreated }: Props) {
  const profile = useAuthStore(s => s.profile)
  const [groups, setGroups]     = useState<{ id: string; name: string }[]>([])
  const [teacherId, setTeacherId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    mode: 'onChange',
  })
  const { templates, loading: loadingTemplates } = useMockExamTemplates(open)

  // Reset the form only on the open transition (false→true), not on every
  // re-run of the data-loading effect below — a background token refresh
  // must never wipe whatever the user has already typed into an open modal.
  useEffect(() => {
    if (open) reset({})
  }, [open, reset])

  useEffect(() => {
    if (!open || !profile) return
    setLoadingData(true)
    async function load() {
      // §219. Строку `teachers` ищем по профилю НЕЗАВИСИМО от роли: у
      // владельца роль в профиле — admin, а строка `teachers` есть (§73).
      // Раньше поиск стоял под `role === 'teacher'`, и пробник владельца
      // ложился с created_by = null — в режиме учителя его потом не было
      // видно, и казалось, что он не сохранился.
      const { data: tc } = await supabase.from('teachers').select('id').eq('profile_id', profile!.id).maybeSingle()
      setTeacherId(tc?.id || null)
      if (profile!.role === 'teacher') {
        // Teacher's groups
        if (tc?.id) {
          const { data: gs } = await supabase.from('groups').select('id, name').eq('teacher_id', tc.id)
          setGroups(gs || [])
        }
      } else {
        const { data: gs } = await supabase.from('groups').select('id, name').order('name')
        setGroups(gs || [])
      }
      setLoadingData(false)
    }
    load()
  }, [open, profile?.id, profile?.role])

  async function onSubmit(values: FormValues) {
    const template = templates.find(t => t.id === values.template_id)
    if (!template) return
    const { data, error } = await supabase
      .from('mock_exams')
      .insert({
        title:       values.title,
        subject:     template.subject,
        exam_type:   template.exam_type,
        date:        values.date,
        group_id:    values.group_id,
        template_id: template.id,
        // max_score база перепишет из шаблона (триггер mock_exams_template_guard);
        // здесь то же число, чтобы строка была верной и до триггера.
        max_score:   template.score_scale?.length
          ? template.score_scale[template.score_scale.length - 1]
          : template.max_points.reduce((a, b) => a + b, 0),
        created_by:  teacherId,
      } as any)
      .select()
      .single()

    if (error) { alert(error.message); return }
    onCreated(data.id)
    onClose()
  }

  if (!open) return null

  const templateOptions = [
    { value: '', label: templates.length ? '— Шаблон' : 'Шаблонов нет — заведите на странице «Шаблоны»' },
    ...templates.map(t => ({ value: t.id, label: `${t.title} · ${t.year}` })),
  ]
  const groupOptions = [
    { value: '', label: '— Группа' },
    ...groups.map(g => ({ value: g.id, label: g.name })),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Новый пробный экзамен</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {loadingData || loadingTemplates ? (
          <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" />Загрузка…
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
            <Input label="Название" placeholder="Пробник ЕГЭ #3" error={errors.title?.message} {...register('title')} />

            <Select label="Шаблон" options={templateOptions} error={errors.template_id?.message} {...register('template_id')} />

            <Select label="Группа" options={groupOptions} error={errors.group_id?.message} {...register('group_id')} />

            <Input label="Дата" type="date" error={errors.date?.message} {...register('date')} />

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button type="submit" className="flex-1" loading={isSubmitting}>
                Создать и открыть таблицу →
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
