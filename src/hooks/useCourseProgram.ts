import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface Topic {
  id: string
  module_id: string
  title: string
  order_index: number
  max_score: number
  available_from: string | null
  /** Тумблер открытости: null — решает дата. См. src/lib/topicAvailability.ts */
  is_open: boolean | null
}

export interface Module {
  id: string
  course_id: string
  title: string
  order_index: number
  topics: Topic[]
}

export interface Course {
  id: string
  owner_id: string | null
  title: string
  subject: string
  exam_type: string
  description: string | null
  price: number
  duration_weeks: number
  is_active: boolean
  /** Черновик: ученики курс не видят и записаться не могут. */
  is_draft: boolean
  start_date: string | null
  end_date: string | null
  enrollment_open_until: string | null
}

function compareByOrderIndexThenId<T extends { order_index?: number | null; id: string }>(a: T, b: T) {
  const orderDiff = (a.order_index ?? 0) - (b.order_index ?? 0)
  if (orderDiff !== 0) return orderDiff
  return a.id.localeCompare(b.id)
}

export function useCourseProgram() {
  const profile = useAuthStore(s => s.profile)
  const [courses,  setCourses]  = useState<Course[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tick,     setTick]     = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    setLoading(true)
    async function load() {
      try {
        if (profile!.role === 'teacher') {
          const { data } = await supabase.from('courses').select('*').order('title')
          setCourses((data || []) as any)
        } else {
          const { data } = await supabase.from('courses').select('*').order('title')
          setCourses((data || []) as any)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile, tick])

  async function loadModules(courseId: string): Promise<Module[]> {
    const { data: mods, error: modsErr } = await supabase
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('order_index')

    if (modsErr) throw new Error(modsErr.message)
    if (!mods?.length) return []

    const sortedModules = [...mods].sort(compareByOrderIndexThenId)

    const { data: tops } = await supabase
      .from('topics')
      .select('*')
      .in('module_id', sortedModules.map(m => m.id))
      .order('order_index')

    const sortedTopics = [...(tops || [])].sort(compareByOrderIndexThenId)

    return sortedModules.map(m => ({
      ...m,
      topics: sortedTopics.filter(t => t.module_id === m.id),
    }))
  }

  async function saveCourse(id: string, values: Partial<Course>) {
    const { error } = await supabase.from('courses').update(values as any).eq('id', id)
    if (error) throw error
    reload()
  }

  async function createCourse(values: Omit<Course, 'id' | 'owner_id'>) {
    const { data, error } = await supabase.from('courses').insert(values as any).select('id').single()
    if (error) throw error
    reload()
    return data!.id as string
  }

  async function saveModule(id: string, title: string) {
    const { error } = await supabase.from('modules').update({ title }).eq('id', id)
    if (error) throw error
  }

  async function createModule(courseId: string, title: string) {
    const { data: lastModule, error: lastModuleError } = await supabase
      .from('modules')
      .select('order_index, id')
      .eq('course_id', courseId)
      .order('order_index', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastModuleError) throw lastModuleError

    const nextOrderIndex = (lastModule?.order_index ?? -1) + 1
    const { data, error } = await supabase
      .from('modules').insert({ course_id: courseId, title, order_index: nextOrderIndex })
      .select('id').single()
    if (error) throw error
    if (!data?.id) throw new Error('Недостаточно прав для создания модуля')
    return data!.id as string
  }

  async function deleteModule(id: string) {
    const { error } = await supabase.from('modules').delete().eq('id', id)
    if (error) throw error
  }

  async function saveTopic(id: string, values: Partial<Topic>) {
    const { error } = await supabase.from('topics').update(values).eq('id', id)
    if (error) throw error
  }

  async function createTopic(moduleId: string, title: string) {
    const { data: lastTopic, error: lastTopicError } = await supabase
      .from('topics')
      .select('order_index, id')
      .eq('module_id', moduleId)
      .order('order_index', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastTopicError) throw lastTopicError

    const nextOrderIndex = (lastTopic?.order_index ?? -1) + 1
    const { data, error } = await supabase
      .from('topics').insert({ module_id: moduleId, title, order_index: nextOrderIndex, max_score: 100 })
      .select('id').single()
    if (error) throw error
    if (!data?.id) throw new Error('Недостаточно прав для создания темы')
    return data!.id as string
  }

  async function deleteTopic(id: string) {
    const { data, error } = await supabase.from('topics').delete().eq('id', id).select('id')
    if (error) throw error
    return (data || []).length
  }

  return {
    courses, loading, reload,
    loadModules,
    saveCourse, createCourse,
    saveModule, createModule, deleteModule,
    saveTopic, createTopic, deleteTopic,
  }
}
