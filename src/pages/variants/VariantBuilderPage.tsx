import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { VariantConstructor, type VariantConstructorInitialData, type VariantConstructorSubmitPayload } from '@/components/variant/VariantConstructor'
import { useVariantBuilder, useVariantDetail, type GeneratedTask } from '@/hooks/useVariants'
import { toast } from '@/store/toastStore'

export function VariantBuilderPage() {
  const { variantId } = useParams<{ variantId?: string }>()
  const navigate = useNavigate()
  const isEdit = Boolean(variantId)
  const { variant: existingVariant, items: existingItems, loading: loadingExisting } = useVariantDetail(variantId)
  const { saveVariant, saving, findReplacementTask } = useVariantBuilder()

  const initialData = useMemo<VariantConstructorInitialData | null>(() => {
    if (!existingVariant) return null
    return {
      subject: existingVariant.subject,
      examType: existingVariant.exam_type,
      title: existingVariant.title,
      description: existingVariant.description ?? '',
      settings: existingVariant.settings,
      tasks: existingItems.map(item => ({
        task_id: item.task_id,
        section_id: item.section_id ?? '',
        topic_id: item.topic_id ?? '',
        position: item.position,
        task: item.task,
      })) satisfies GeneratedTask[],
    }
  }, [existingVariant, existingItems])

  const save = async (payload: VariantConstructorSubmitPayload, status: 'draft' | 'ready') => {
    const id = await saveVariant({
      variantId: variantId ?? null,
      title: payload.title,
      description: payload.description,
      subject: payload.subject,
      examType: payload.examType,
      status,
      settings: payload.settings,
      items: payload.tasks,
    })
    toast.success('Вариант сохранён')
    navigate(`/variants/${id}`)
  }

  return (
    <VariantConstructor
      headerTitle={isEdit ? 'Редактировать вариант' : 'Конструктор варианта'}
      loading={isEdit && loadingExisting}
      initialData={initialData}
      saving={saving}
      showDescription={true}
      showDraftAction={true}
      completeActionLabel="Сохранить (готов)"
      completeStepLabel="Сохранение"
      onBack={() => navigate('/variants')}
      onComplete={payload => save(payload, 'ready')}
      onSaveDraft={payload => save(payload, 'draft')}
      onReplaceTask={async (task, excludeIds) => {
        return await findReplacementTask(task.section_id, task.topic_id, excludeIds)
      }}
    />
  )
}
