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
  title: string
  subject: string
  exam_type: string
  description: string | null
  price: number
  duration_weeks: number
  is_active: boolean
  start_date: string | null
  end_date: string | null
  enrollment_open_until: string | null
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
          const { data: tc } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (!tc) return
          const { data: gs } = await supabase
            .from('groups').select('course_id').eq('teacher_id', tc.id)
          const ids = [...new Set((gs || []).map((g: any) => g.course_id).filter(Boolean))]
          if (!ids.length) { setCourses([]); return }
          const { data } = await supabase.from('courses').select('*').in('id', ids).order('title')
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
    const { data: mods } = await supabase
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('order_index')

    if (!mods?.length) return []

    const { data: tops } = await supabase
      .from('topics')
      .select('*')
      .in('module_id', mods.map(m => m.id))
      .order('order_index')

    return mods.map(m => ({
      ...m,
      topics: (tops || []).filter(t => t.module_id === m.id),
    }))
  }

  async function saveCourse(id: string, values: Partial<Course>) {
    const { error } = await supabase.from('courses').update(values as any).eq('id', id)
    if (error) throw error
    reload()
  }

  async function createCourse(values: Omit<Course, 'id'>) {
    const { data, error } = await supabase.from('courses').insert(values as any).select('id').single()
    if (error) throw error
    reload()
    return data!.id as string
  }

  async function saveModule(id: string, title: string) {
    const { error } = await supabase.from('modules').update({ title }).eq('id', id)
    if (error) throw error
  }

  async function createModule(courseId: string, title: string, orderIndex: number) {
    const { data, error } = await supabase
      .from('modules').insert({ course_id: courseId, title, order_index: orderIndex })
      .select('id').single()
    if (error) throw error
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

  async function createTopic(moduleId: string, title: string, orderIndex: number) {
    const { data, error } = await supabase
      .from('topics').insert({ module_id: moduleId, title, order_index: orderIndex, max_score: 100 })
      .select('id').single()
    if (error) throw error
    return data!.id as string
  }

  async function deleteTopic(id: string) {
    const { error } = await supabase.from('topics').delete().eq('id', id)
    if (error) throw error
  }

  return {
    courses, loading, reload,
    loadModules,
    saveCourse, createCourse,
    saveModule, createModule, deleteModule,
    saveTopic, createTopic, deleteTopic,
  }
}
