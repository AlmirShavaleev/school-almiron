import { useMemo } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { VariantConstructor, type VariantConstructorInitialData, type VariantConstructorSubmitPayload } from '@/components/variant/VariantConstructor'
import { useCreateSelfBuiltVariant, usePickReplacementTask } from '@/hooks/useVariants'

export function StudentVariantGeneratePage() {
  const navigate = useNavigate()
  const { create, saving } = useCreateSelfBuiltVariant()
  const { pick } = usePickReplacementTask()

  const initialData = useMemo<VariantConstructorInitialData>(() => ({
    subject: 'math',
    examType: 'ege',
    title: `Мой вариант от ${format(new Date(), 'd MMMM', { locale: ru })}`,
    description: '',
  }), [])

  const handleCreate = async (payload: VariantConstructorSubmitPayload) => {
    const studentAssignmentId = await create({
      title: payload.title,
      subject: payload.subject,
      examType: payload.examType,
      items: payload.tasks.map(task => ({
        task_id: task.task_id,
        section_id: task.section_id || null,
        topic_id: task.topic_id || null,
      })),
    })
    if (!studentAssignmentId) throw new Error('Не удалось создать вариант')
    navigate(`/student/variants/${studentAssignmentId}`)
  }

  return (
    <VariantConstructor
      headerTitle="Конструктор варианта"
      backLabel="К вариантам"
      initialData={initialData}
      saving={saving}
      previewMode="student"
      showDescription={false}
      showDraftAction={false}
      completeActionLabel="Начать вариант"
      completeStepLabel="Начало"
      onBack={() => navigate('/student/variants')}
      onComplete={handleCreate}
      onReplaceTask={async (task, excludeIds) => {
        return await pick({
          sectionId: task.section_id,
          topicId: task.topic_id || null,
          excludeIds,
          visibility: 'student_safe',
        })
      }}
    />
  )
}
