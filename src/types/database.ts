export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          condition_type: string
          condition_value: number
          created_at: string
          description: string | null
          icon: string
          id: string
          title: string
          xp_reward: number
        }
        Insert: {
          condition_type: string
          condition_value?: number
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          title: string
          xp_reward?: number
        }
        Update: {
          condition_type?: string
          condition_value?: number
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          title?: string
          xp_reward?: number
        }
        Relationships: []
      }
      attendance: {
        Row: {
          created_at: string | null
          id: string
          lesson_id: string
          note: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lesson_id: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lesson_id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          description: string | null
          duration_weeks: number | null
          end_date: string | null
          enrollment_open_until: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          is_active: boolean
          price: number
          start_date: string | null
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          end_date?: string | null
          enrollment_open_until?: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id?: string
          is_active?: boolean
          price?: number
          start_date?: string | null
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          end_date?: string | null
          enrollment_open_until?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          is_active?: boolean
          price?: number
          start_date?: string | null
          subject?: Database["public"]["Enums"]["subject_type"]
          title?: string
        }
        Relationships: []
      }
      curators: {
        Row: {
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_students: {
        Row: {
          group_id: string
          id: string
          joined_at: string
          student_id: string
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string
          student_id: string
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_students_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          course_id: string | null
          created_at: string
          curator_id: string | null
          id: string
          is_active: boolean
          max_students: number
          name: string
          schedule_days: string[] | null
          schedule_time: string | null
          teacher_id: string | null
          type: Database["public"]["Enums"]["group_type"]
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          curator_id?: string | null
          id?: string
          is_active?: boolean
          max_students?: number
          name: string
          schedule_days?: string[] | null
          schedule_time?: string | null
          teacher_id?: string | null
          type?: Database["public"]["Enums"]["group_type"]
        }
        Update: {
          course_id?: string | null
          created_at?: string
          curator_id?: string | null
          id?: string
          is_active?: boolean
          max_students?: number
          name?: string
          schedule_days?: string[] | null
          schedule_time?: string | null
          teacher_id?: string | null
          type?: Database["public"]["Enums"]["group_type"]
        }
        Relationships: [
          {
            foreignKeyName: "groups_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          answer_text: string | null
          checked_at: string | null
          checked_by: string | null
          feedback: string | null
          file_url: string | null
          homework_id: string
          id: string
          score: number | null
          status: Database["public"]["Enums"]["homework_status"]
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          answer_text?: string | null
          checked_at?: string | null
          checked_by?: string | null
          feedback?: string | null
          file_url?: string | null
          homework_id: string
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["homework_status"]
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          answer_text?: string | null
          checked_at?: string | null
          checked_by?: string | null
          feedback?: string | null
          file_url?: string | null
          homework_id?: string
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["homework_status"]
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "homeworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      homeworks: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          due_date: string
          file_url: string | null
          group_id: string
          id: string
          lesson_id: string | null
          max_score: number
          teacher_id: string
          title: string
          topic_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          due_date: string
          file_url?: string | null
          group_id: string
          id?: string
          lesson_id?: string | null
          max_score?: number
          teacher_id: string
          title: string
          topic_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string
          file_url?: string | null
          group_id?: string
          id?: string
          lesson_id?: string | null
          max_score?: number
          teacher_id?: string
          title?: string
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homeworks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeworks_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeworks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeworks_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeworks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      hw_subs_backup: {
        Row: {
          answer_text: string | null
          checked_at: string | null
          checked_by: string | null
          feedback: string | null
          file_url: string | null
          group_id: string | null
          homework_id: string | null
          id: string | null
          score: number | null
          status: Database["public"]["Enums"]["homework_status"] | null
          student_id: string | null
          submitted_at: string | null
          topic_id: string | null
        }
        Insert: {
          answer_text?: string | null
          checked_at?: string | null
          checked_by?: string | null
          feedback?: string | null
          file_url?: string | null
          group_id?: string | null
          homework_id?: string | null
          id?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["homework_status"] | null
          student_id?: string | null
          submitted_at?: string | null
          topic_id?: string | null
        }
        Update: {
          answer_text?: string | null
          checked_at?: string | null
          checked_by?: string | null
          feedback?: string | null
          file_url?: string | null
          group_id?: string | null
          homework_id?: string | null
          id?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["homework_status"] | null
          student_id?: string | null
          submitted_at?: string | null
          topic_id?: string | null
        }
        Relationships: []
      }
      leaderboard_points: {
        Row: {
          created_at: string
          id: string
          points: number
          reason: string
          reference_id: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          points: number
          reason: string
          reference_id?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          points?: number
          reason?: string
          reference_id?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_points_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_rates: {
        Row: {
          currency: string
          group_id: string | null
          id: string
          rate_per_lesson: number
          student_id: string | null
        }
        Insert: {
          currency?: string
          group_id?: string | null
          id?: string
          rate_per_lesson: number
          student_id?: string | null
        }
        Update: {
          currency?: string
          group_id?: string | null
          id?: string
          rate_per_lesson?: number
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_rates_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_rates_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          course_id: string | null
          created_at: string
          duration_minutes: number
          format: Database["public"]["Enums"]["lesson_format"]
          group_id: string | null
          id: string
          notes: string | null
          recording_url: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_id: string | null
          teacher_id: string
          title: string
          topic_id: string | null
          zoom_link: string | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          duration_minutes?: number
          format?: Database["public"]["Enums"]["lesson_format"]
          group_id?: string | null
          id?: string
          notes?: string | null
          recording_url?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string | null
          teacher_id: string
          title: string
          topic_id?: string | null
          zoom_link?: string | null
        }
        Update: {
          course_id?: string | null
          created_at?: string
          duration_minutes?: number
          format?: Database["public"]["Enums"]["lesson_format"]
          group_id?: string | null
          id?: string
          notes?: string | null
          recording_url?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string | null
          teacher_id?: string
          title?: string
          topic_id?: string | null
          zoom_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_results: {
        Row: {
          created_at: string
          id: string
          mock_exam_id: string
          notes: string | null
          part1_score: number | null
          part2_score: number | null
          score: number
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mock_exam_id: string
          notes?: string | null
          part1_score?: number | null
          part2_score?: number | null
          score: number
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mock_exam_id?: string
          notes?: string | null
          part1_score?: number | null
          part2_score?: number | null
          score?: number
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_results_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exams: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          exam_type: Database["public"]["Enums"]["exam_type"]
          group_id: string | null
          id: string
          max_score: number
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          exam_type: Database["public"]["Enums"]["exam_type"]
          group_id?: string | null
          id?: string
          max_score?: number
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          exam_type?: Database["public"]["Enums"]["exam_type"]
          group_id?: string | null
          id?: string
          max_score?: number
          subject?: Database["public"]["Enums"]["subject_type"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exams_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          id: string
          order_index: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          order_index?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          order_index?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          badge: boolean
          checked: boolean
          email: boolean
          homework: boolean
          lesson: boolean
          overdue: boolean
          payment: boolean
          telegram: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          badge?: boolean
          checked?: boolean
          email?: boolean
          homework?: boolean
          lesson?: boolean
          overdue?: boolean
          payment?: boolean
          telegram?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          badge?: boolean
          checked?: boolean
          email?: boolean
          homework?: boolean
          lesson?: boolean
          overdue?: boolean
          payment?: boolean
          telegram?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_plans: {
        Row: {
          amount: number
          billing_cycle: Database["public"]["Enums"]["billing_cycle"]
          created_at: string | null
          currency: string
          id: string
          is_active: boolean
          next_billing_date: string | null
          student_id: string
          yookassa_payment_method_id: string | null
        }
        Insert: {
          amount: number
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          created_at?: string | null
          currency?: string
          id?: string
          is_active?: boolean
          next_billing_date?: string | null
          student_id: string
          yookassa_payment_method_id?: string | null
        }
        Update: {
          amount?: number
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          created_at?: string | null
          currency?: string
          id?: string
          is_active?: boolean
          next_billing_date?: string | null
          student_id?: string
          yookassa_payment_method_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_plans_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          due_date: string
          id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          student_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          student_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          billing_period: string
          created_at: string | null
          currency: string | null
          description: string | null
          features: Json | null
          id: string
          is_active: boolean | null
          name: string
          price: number
          sort_order: number | null
          trial_days: number | null
        }
        Insert: {
          billing_period?: string
          created_at?: string | null
          currency?: string | null
          description?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          sort_order?: number | null
          trial_days?: number | null
        }
        Update: {
          billing_period?: string
          created_at?: string | null
          currency?: string | null
          description?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          sort_order?: number | null
          trial_days?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          student_id: string
          text: string
          topic_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          student_id: string
          text: string
          topic_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          student_id?: string
          text?: string
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      student_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          id: string
          student_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          id?: string
          student_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_achievements_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_balances: {
        Row: {
          balance: number
          currency: string
          student_id: string
          updated_at: string | null
        }
        Insert: {
          balance?: number
          currency?: string
          student_id: string
          updated_at?: string | null
        }
        Update: {
          balance?: number
          currency?: string
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_balances_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_courses: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          enrolled_at: string
          expires_at: string | null
          id: string
          notes: string | null
          source: Database["public"]["Enums"]["enrollment_source"]
          status: Database["public"]["Enums"]["enrollment_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          enrolled_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          source?: Database["public"]["Enums"]["enrollment_source"]
          status?: Database["public"]["Enums"]["enrollment_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          enrolled_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          source?: Database["public"]["Enums"]["enrollment_source"]
          status?: Database["public"]["Enums"]["enrollment_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_courses_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_curators: {
        Row: {
          created_at: string | null
          curator_id: string
          id: string
          student_id: string
        }
        Insert: {
          created_at?: string | null
          curator_id: string
          id?: string
          student_id: string
        }
        Update: {
          created_at?: string | null
          curator_id?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_curators_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_curators_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          created_at: string
          grade: number
          id: string
          is_active: boolean
          league: Database["public"]["Enums"]["league_type"]
          notes: string | null
          profile_id: string
          target_exam: Database["public"]["Enums"]["exam_type"]
          target_score: number | null
          target_subject: Database["public"]["Enums"]["subject_type"]
          xp_points: number
        }
        Insert: {
          created_at?: string
          grade?: number
          id?: string
          is_active?: boolean
          league?: Database["public"]["Enums"]["league_type"]
          notes?: string | null
          profile_id: string
          target_exam?: Database["public"]["Enums"]["exam_type"]
          target_score?: number | null
          target_subject?: Database["public"]["Enums"]["subject_type"]
          xp_points?: number
        }
        Update: {
          created_at?: string
          grade?: number
          id?: string
          is_active?: boolean
          league?: Database["public"]["Enums"]["league_type"]
          notes?: string | null
          profile_id?: string
          target_exam?: Database["public"]["Enums"]["exam_type"]
          target_score?: number | null
          target_subject?: Database["public"]["Enums"]["subject_type"]
          xp_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "students_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          status: string
          student_id: string
          updated_at: string | null
          yookassa_payment_method_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          status?: string
          student_id: string
          updated_at?: string | null
          yookassa_payment_method_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          status?: string
          student_id?: string
          updated_at?: string | null
          yookassa_payment_method_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          bio: string | null
          created_at: string
          hourly_rate: number | null
          id: string
          profile_id: string
          rating: number | null
          subjects: Database["public"]["Enums"]["subject_type"][]
        }
        Insert: {
          bio?: string | null
          created_at?: string
          hourly_rate?: number | null
          id?: string
          profile_id: string
          rating?: number | null
          subjects?: Database["public"]["Enums"]["subject_type"][]
        }
        Update: {
          bio?: string | null
          created_at?: string
          hourly_rate?: number | null
          id?: string
          profile_id?: string
          rating?: number | null
          subjects?: Database["public"]["Enums"]["subject_type"][]
        }
        Relationships: [
          {
            foreignKeyName: "teachers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_materials: {
        Row: {
          content: string | null
          file_url: string | null
          id: string
          link_url: string | null
          topic_id: string
          type: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          file_url?: string | null
          id?: string
          link_url?: string | null
          topic_id: string
          type: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          file_url?: string | null
          id?: string
          link_url?: string | null
          topic_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_materials_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          available_from: string | null
          created_at: string
          id: string
          max_score: number
          module_id: string
          order_index: number
          title: string
        }
        Insert: {
          available_from?: string | null
          created_at?: string
          id?: string
          max_score?: number
          module_id: string
          order_index?: number
          title: string
        }
        Update: {
          available_from?: string | null
          created_at?: string
          id?: string
          max_score?: number
          module_id?: string
          order_index?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          lesson_id: string | null
          student_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          yookassa_payment_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          id?: string
          lesson_id?: string | null
          student_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          yookassa_payment_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          lesson_id?: string | null
          student_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          yookassa_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          status: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          status?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      yookassa_payments: {
        Row: {
          amount: number
          created_at: string | null
          currency: string
          id: string
          metadata: Json | null
          payment_plan_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          student_id: string | null
          updated_at: string | null
          yookassa_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string
          id?: string
          metadata?: Json | null
          payment_plan_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          student_id?: string | null
          updated_at?: string | null
          yookassa_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string
          id?: string
          metadata?: Json | null
          payment_plan_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          student_id?: string | null
          updated_at?: string | null
          yookassa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "yookassa_payments_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yookassa_payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_is_curator_of_homework: { Args: { hw_id: string }; Returns: boolean }
      auth_is_student_in_group: { Args: { grp_id: string }; Returns: boolean }
      auth_is_student_of_submission: {
        Args: { stu_id: string }
        Returns: boolean
      }
      auth_is_teacher_of_group: { Args: { grp_id: string }; Returns: boolean }
      auth_is_teacher_of_homework: { Args: { hw_id: string }; Returns: boolean }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin_or_owner: { Args: never; Returns: boolean }
    }
    Enums: {
      attendance_status: "present" | "absent" | "late"
      billing_cycle: "per_lesson" | "biweekly" | "monthly"
      enrollment_source: "purchase" | "manual" | "trial" | "gift"
      enrollment_status: "active" | "expired" | "cancelled" | "trial"
      exam_type: "ege" | "oge"
      group_type: "individual" | "pair" | "group"
      homework_status: "not_submitted" | "submitted" | "checked" | "revision"
      league_type: "bronze" | "silver" | "gold" | "platinum" | "academic"
      lesson_format: "group" | "individual" | "pair" | "parallel"
      lesson_status: "scheduled" | "completed" | "cancelled"
      payment_status: "pending" | "paid" | "overdue" | "refunded"
      subject_type: "physics" | "math"
      transaction_type:
        | "deposit"
        | "lesson_charge"
        | "subscription_charge"
        | "refund"
        | "adjustment"
      user_role:
        | "student"
        | "parent"
        | "teacher"
        | "curator"
        | "admin"
        | "owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_status: ["present", "absent", "late"],
      billing_cycle: ["per_lesson", "biweekly", "monthly"],
      enrollment_source: ["purchase", "manual", "trial", "gift"],
      enrollment_status: ["active", "expired", "cancelled", "trial"],
      exam_type: ["ege", "oge"],
      group_type: ["individual", "pair", "group"],
      homework_status: ["not_submitted", "submitted", "checked", "revision"],
      league_type: ["bronze", "silver", "gold", "platinum", "academic"],
      lesson_format: ["group", "individual", "pair", "parallel"],
      lesson_status: ["scheduled", "completed", "cancelled"],
      payment_status: ["pending", "paid", "overdue", "refunded"],
      subject_type: ["physics", "math"],
      transaction_type: [
        "deposit",
        "lesson_charge",
        "subscription_charge",
        "refund",
        "adjustment",
      ],
      user_role: ["student", "parent", "teacher", "curator", "admin", "owner"],
    },
  },
} as const
