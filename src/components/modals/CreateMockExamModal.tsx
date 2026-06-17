import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'

const schema = z.object({
  title:     z.string().min(2, 'Введите название'),
  subject:   z.string().min(1, 'Выберите предмет'),
  exam_type: z.string().min(1, 'Выберите тип'),
  date:      z.string().min(1, 'Укажите дату'),
  group_id:  z.string().min(1, 'Выберите группу'),
  max_score: z.coerce.number().min(1).max(500),
})
type FormValues = z.infer<typeof schema>

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (examId: string, groupId: string, maxScore: number, title: string) => void
}

export function CreateMockExamModal({ open, onClose, onCreated }: Props) {
  const profile = useAuthStore(s => s.profile)
  const [groups, setGroups]     = useState<{ id: string; name: string }[]>([])
  const [teacherId, setTeacherId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    mode: 'onChange',
    defaultValues: { max_score: 100 },
  })

  useEffect(() => {
    if (!open || !profile) return
    setLoadingData(true)
    async function load() {
      // Teacher id
      if (profile!.role === 'teacher') {
        const { data } = await supabase.from('teachers').select('id').eq('profile_id', profile!.id).single()
        setTeacherId(data?.id || null)
        // Teacher's groups
        if (data?.id) {
          const { data: gs } = await supabase.from('groups').select('id, name').eq('teacher_id', data.id)
          setGroups(gs || [])
        }
      } else {
        const { data: gs } = await supabase.from('groups').select('id, name').order('name')
        setGroups(gs || [])
        setTeacherId(null)
      }
      setLoadingData(false)
    }
    load()
    reset({ max_score: 100 })
  }, [open, profile])

  async function onSubmit(values: FormValues) {
    const { data, error } = await supabase
      .from('mock_exams')
      .insert({
        title:      values.title,
        subject:    values.subject,
        exam_type:  values.exam_type,
        date:       values.date,
        group_id:   values.group_id,
        max_score:  values.max_score,
        created_by: teacherId,
      } as any)
      .select()
      .single()

    if (error) { alert(error.message); return }
    onCreated(data.id, values.group_id, values.max_score, values.title)
    onClose()
  }

  if (!open) return null

  const subjectOptions = [
    { value: '', label: '— Предмет' },
    ...Object.entries(SUBJECT_LABELS).map(([v, l]) => ({ value: v, label: l })),
  ]
  const examTypeOptions = [
    { value: '', label: '— Тип экзамена' },
    ...Object.entries(EXAM_LABELS).map(([v, l]) => ({ value: v, label: l })),
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

        {loadingData ? (
          <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" />Загрузка…
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
            <Input label="Название" placeholder="Пробник ЕГЭ #3" error={errors.title?.message} {...register('title')} />

            <div className="grid grid-cols-2 gap-3">
              <Select label="Предмет" options={subjectOptions} error={errors.subject?.message} {...register('subject')} />
              <Select label="Тип" options={examTypeOptions} error={errors.exam_type?.message} {...register('exam_type')} />
            </div>

            <Select label="Группа" options={groupOptions} error={errors.group_id?.message} {...register('group_id')} />

            <div className="grid grid-cols-2 gap-3">
              <Input label="Дата" type="date" error={errors.date?.message} {...register('date')} />
              <Input label="Макс. балл" type="number" min={1} max={500} error={errors.max_score?.message} {...register('max_score')} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button type="submit" className="flex-1" loading={isSubmitting}>
                Создать и внести результаты →
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
