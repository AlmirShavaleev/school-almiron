import { useState, useEffect } from 'react'
import { X, BookOpen, Calendar, DollarSign, Loader2, AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import type { AdminCourse } from '@/hooks/useAdminDashboard'

const schema = z.object({
  title:                 z.string().trim().min(3, 'Минимум 3 символа'),
  subject:               z.enum(['physics', 'math']),
  exam_type:             z.enum(['ege', 'oge']),
  description:           z.string().trim().max(1000).optional().or(z.literal('')),
  price:                 z.coerce.number().min(0, 'Цена не может быть отрицательной'),
  duration_weeks:        z.coerce.number().min(1).max(104).optional().or(z.nan()),
  start_date:            z.string().optional().or(z.literal('')),
  end_date:              z.string().optional().or(z.literal('')),
  enrollment_open_until: z.string().optional().or(z.literal('')),
  is_active:             z.boolean(),
}).superRefine((data, ctx) => {
  // end_date >= start_date
  if (data.start_date && data.end_date && data.end_date < data.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_date'],
      message: 'Дата окончания должна быть позже даты старта',
    })
  }
  // enrollment_open_until <= start_date
  if (data.enrollment_open_until && data.start_date && data.enrollment_open_until > data.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['enrollment_open_until'],
      message: 'Дедлайн записи не может быть позже старта курса',
    })
  }
})

type FormValues = z.infer<typeof schema>

interface Props {
  open:      boolean
  onClose:   () => void
  onSaved:   () => void
  course:    AdminCourse | null   // null → создание нового
}

export function EditCourseModal({ open, onClose, onSaved, course }: Props) {
  const isEdit = !!course
  const [submitting, setSubmitting] = useState(false)
  const [serverErr,  setServerErr]  = useState<string | null>(null)

  const {
    register, handleSubmit, reset, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      title: '', subject: 'physics', exam_type: 'ege', description: '',
      price: 0, duration_weeks: undefined,
      start_date: '', end_date: '', enrollment_open_until: '',
      is_active: true,
    },
  })

  useEffect(() => {
    if (!open) return
    if (course) {
      reset({
        title:                 course.title,
        subject:              (course.subject as any) || 'physics',
        exam_type:            (course.exam_type as any) || 'ege',
        description:           course.description || '',
        price:                 course.price || 0,
        duration_weeks:        course.duration_weeks ?? undefined,
        start_date:            course.start_date || '',
        end_date:              course.end_date || '',
        enrollment_open_until: course.enrollment_open_until || '',
        is_active:             course.is_active,
      })
    } else {
      reset({
        title: '', subject: 'physics', exam_type: 'ege', description: '',
        price: 0, duration_weeks: undefined,
        start_date: '', end_date: '', enrollment_open_until: '',
        is_active: true,
      })
    }
    setServerErr(null)
  }, [open, course, reset])

  if (!open) return null

  const sd = watch('start_date')
  const ed = watch('end_date')

  // Computed: human availability hint
  const availabilityHint = (() => {
    if (!sd && !ed) return null
    const today = new Date().toISOString().slice(0, 10)
    if (sd && today < sd) return { kind: 'info' as const, text: `Курс станет доступен ${formatDate(sd)}` }
    if (ed && today > ed) return { kind: 'warn' as const, text: `Курс завершился ${formatDate(ed)}` }
    return { kind: 'ok' as const, text: 'Курс активен прямо сейчас' }
  })()

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    setServerErr(null)

    const payload = {
      title:                 values.title.trim(),
      subject:               values.subject,
      exam_type:             values.exam_type,
      description:           values.description?.trim() || null,
      price:                 values.price,
      duration_weeks:        Number.isFinite(values.duration_weeks as number) ? values.duration_weeks : null,
      start_date:            values.start_date || null,
      end_date:              values.end_date || null,
      enrollment_open_until: values.enrollment_open_until || null,
      is_active:             values.is_active,
    }

    const { error } = isEdit
      ? await supabase.from('courses').update(payload).eq('id', course!.id)
      : await supabase.from('courses').insert(payload)

    setSubmitting(false)
    if (error) { setServerErr(error.message); return }
    onSaved()
    onClose()
  }

  async function handleDelete() {
    if (!course) return
    if (!confirm(`Удалить курс «${course.title}»? Это действие нельзя отменить.`)) return
    setSubmitting(true)
    const { error } = await supabase.from('courses').delete().eq('id', course.id)
    setSubmitting(false)
    if (error) { setServerErr(error.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {isEdit ? 'Редактировать курс' : 'Новый курс'}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">

          <Input
            label="Название курса"
            placeholder="Физика. ЕГЭ 2026. Углублённый"
            {...register('title')}
            error={errors.title?.message}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Предмет"
              {...register('subject')}
              options={[
                { value: 'physics', label: 'Физика' },
                { value: 'math',    label: 'Математика' },
              ]}
            />
            <Select
              label="Экзамен"
              {...register('exam_type')}
              options={[
                { value: 'ege', label: 'ЕГЭ' },
                { value: 'oge', label: 'ОГЭ' },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Описание</label>
            <textarea
              {...register('description')}
              rows={3}
              placeholder="Что включает курс, для кого, ожидаемый результат…"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
            {errors.description?.message && (
              <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Цена, ₽"
              type="number" min={0} step={100}
              icon={<DollarSign size={14} />}
              {...register('price')}
              error={errors.price?.message}
            />
            <Input
              label="Длительность, недель"
              type="number" min={1} max={104}
              placeholder="например, 32"
              {...register('duration_weeks')}
              error={errors.duration_weeks?.message}
            />
          </div>

          {/* ── Dates section ─────────────────────────────────────────────── */}
          <div className="pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-primary-600" />
              <h3 className="text-sm font-semibold text-gray-900">Сроки доступности</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Дата старта"
                type="date"
                {...register('start_date')}
                error={errors.start_date?.message}
              />
              <Input
                label="Дата окончания"
                type="date"
                {...register('end_date')}
                error={errors.end_date?.message}
              />
            </div>

            <div className="mt-4">
              <Input
                label="Дедлайн записи (необязательно)"
                type="date"
                {...register('enrollment_open_until')}
                error={errors.enrollment_open_until?.message}
              />
              <p className="text-xs text-gray-400 mt-1">
                После этой даты новые ученики не смогут записаться. Оставьте пустым, чтобы запись была всегда открыта.
              </p>
            </div>

            {availabilityHint && (
              <div className={
                'flex items-center gap-2 mt-3 px-3 py-2 rounded-lg text-sm font-medium ' +
                (availabilityHint.kind === 'ok'   ? 'bg-green-50 text-green-700'
                : availabilityHint.kind === 'warn' ? 'bg-gray-100 text-gray-600'
                                                   : 'bg-blue-50 text-blue-700')
              }>
                <Calendar size={14} />{availabilityHint.text}
              </div>
            )}
          </div>

          {/* ── Active flag ───────────────────────────────────────────────── */}
          <label className="flex items-center gap-3 pt-3 border-t border-gray-100 cursor-pointer select-none">
            <input
              type="checkbox"
              {...register('is_active')}
              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">Курс активен</div>
              <div className="text-xs text-gray-400">Неактивные курсы скрыты от учеников и в каталоге</div>
            </div>
          </label>

          {serverErr && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">
              <AlertCircle size={15} />{serverErr}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-3">
            <div>
              {isEdit && (
                <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={handleDelete} disabled={submitting}>
                  Удалить
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                Отмена
              </Button>
              <Button type="submit" loading={submitting}>
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? 'Сохранить' : 'Создать курс'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
