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
      admin_payment_notification_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: boolean
          recipient_profile_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: boolean
          recipient_profile_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: boolean
          recipient_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_payment_notification_settings_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_payment_notifications: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          payment_id: string
          recipient_profile_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          payment_id: string
          recipient_profile_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          payment_id?: string
          recipient_profile_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_payment_notifications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_payment_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_benchmark_results: {
        Row: {
          attempt_id: string
          cost_usd: number | null
          created_at: string
          error: string | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          meta: Json
          model: string
          output_tokens: number | null
          readable: boolean | null
          run_id: string
          status: string
          suggested_score: number | null
          tasks: Json | null
        }
        Insert: {
          attempt_id: string
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          meta?: Json
          model: string
          output_tokens?: number | null
          readable?: boolean | null
          run_id: string
          status: string
          suggested_score?: number | null
          tasks?: Json | null
        }
        Update: {
          attempt_id?: string
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          meta?: Json
          model?: string
          output_tokens?: number | null
          readable?: boolean | null
          run_id?: string
          status?: string
          suggested_score?: number | null
          tasks?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_benchmark_results_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      annotation_sets: {
        Row: {
          attempt_id: string | null
          author_id: string
          created_at: string
          data: Json
          file_path: string
          id: string
          page: number
          status: string
          submission_id: string | null
          updated_at: string
        }
        Insert: {
          attempt_id?: string | null
          author_id?: string
          created_at?: string
          data?: Json
          file_path: string
          id?: string
          page?: number
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Update: {
          attempt_id?: string | null
          author_id?: string
          created_at?: string
          data?: Json
          file_path?: string
          id?: string
          page?: number
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "annotation_sets_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annotation_sets_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annotation_sets_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "homework_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_feature_flags: {
        Row: {
          enabled: boolean
          key: string
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          key: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          key?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_visits: {
        Row: {
          profile_id: string
          visited_at: string | null
          visited_on: string
        }
        Insert: {
          profile_id: string
          visited_at?: string | null
          visited_on: string
        }
        Update: {
          profile_id?: string
          visited_at?: string | null
          visited_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_visits_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assigned_collection_members: {
        Row: {
          assigned_id: string
          created_at: string
          id: string
          student_id: string
        }
        Insert: {
          assigned_id: string
          created_at?: string
          id?: string
          student_id: string
        }
        Update: {
          assigned_id?: string
          created_at?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assigned_collection_members_assigned_id_fkey"
            columns: ["assigned_id"]
            isOneToOne: false
            referencedRelation: "assigned_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_collection_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      assigned_collections: {
        Row: {
          collection_id: string
          created_at: string
          due_date: string | null
          group_id: string | null
          id: string
          lesson_id: string | null
          status: string
          student_id: string | null
          teacher_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          due_date?: string | null
          group_id?: string | null
          id?: string
          lesson_id?: string | null
          status?: string
          student_id?: string | null
          teacher_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          due_date?: string | null
          group_id?: string | null
          id?: string
          lesson_id?: string | null
          status?: string
          student_id?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assigned_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "task_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_collections_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_collections_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_collections_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_collections_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string | null
          id: string
          lesson_id: string
          note: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lesson_id: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lesson_id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
          updated_at?: string | null
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
      bunny_video_stats_cache: {
        Row: {
          cache_key: string
          fetched_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          fetched_at?: string
          payload: Json
        }
        Update: {
          cache_key?: string
          fetched_at?: string
          payload?: Json
        }
        Relationships: []
      }
      catalog_sections: {
        Row: {
          created_at: string | null
          exam_number: number | null
          exam_type: string
          external_id: number
          id: string
          is_published: boolean
          position: number
          subject: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          exam_number?: number | null
          exam_type: string
          external_id: number
          id?: string
          is_published?: boolean
          position?: number
          subject: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          exam_number?: number | null
          exam_type?: string
          external_id?: number
          id?: string
          is_published?: boolean
          position?: number
          subject?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      catalog_task_assets: {
        Row: {
          alt: string | null
          id: string
          kind: string
          position: number
          size_bytes: number | null
          source_url: string | null
          storage_path: string
          task_id: string | null
          tex_session_id: number | null
        }
        Insert: {
          alt?: string | null
          id?: string
          kind: string
          position?: number
          size_bytes?: number | null
          source_url?: string | null
          storage_path: string
          task_id?: string | null
          tex_session_id?: number | null
        }
        Update: {
          alt?: string | null
          id?: string
          kind?: string
          position?: number
          size_bytes?: number | null
          source_url?: string | null
          storage_path?: string
          task_id?: string | null
          tex_session_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_task_assets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_task_attempts: {
        Row: {
          answer: string
          created_at: string
          id: string
          profile_id: string
          revealed_before: boolean
          task_id: string
          verdict: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          profile_id: string
          revealed_before?: boolean
          task_id: string
          verdict: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          profile_id?: string
          revealed_before?: boolean
          task_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_task_attempts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_task_attempts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_task_progress: {
        Row: {
          completed_at: string | null
          is_completed: boolean
          task_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          is_completed?: boolean
          task_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          is_completed?: boolean
          task_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_task_progress_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_task_reveals: {
        Row: {
          profile_id: string
          revealed_at: string
          task_id: string
        }
        Insert: {
          profile_id: string
          revealed_at?: string
          task_id: string
        }
        Update: {
          profile_id?: string
          revealed_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_task_reveals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_task_reveals_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_task_topics: {
        Row: {
          is_primary: boolean
          source: string | null
          task_id: string
          topic_id: string
        }
        Insert: {
          is_primary?: boolean
          source?: string | null
          task_id: string
          topic_id: string
        }
        Update: {
          is_primary?: boolean
          source?: string | null
          task_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_task_topics_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_task_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "catalog_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_task_topics_rehang_backup_20260803: {
        Row: {
          task_id: string
          topic_id_new: string
          topic_id_old: string
        }
        Insert: {
          task_id: string
          topic_id_new: string
          topic_id_old: string
        }
        Update: {
          task_id?: string
          topic_id_new?: string
          topic_id_old?: string
        }
        Relationships: []
      }
      catalog_tasks: {
        Row: {
          answer_html: string | null
          answer_spec: Json | null
          auto_checkable: boolean | null
          content_format: string
          created_at: string | null
          difficulty: string | null
          exam_part: number | null
          exam_type: string
          external_id: number
          grade_criteria_html: string | null
          has_answer: boolean
          has_solution: boolean
          id: string
          is_published: boolean
          max_points: number | null
          origin_external_id: number | null
          partial_type: string | null
          position: number
          replaced_by_task_id: string | null
          section_id: string
          solution_html: string | null
          solution_plan_html: string | null
          source_url: string | null
          statement_html: string
          subject: string
          updated_at: string | null
        }
        Insert: {
          answer_html?: string | null
          answer_spec?: Json | null
          auto_checkable?: boolean | null
          content_format?: string
          created_at?: string | null
          difficulty?: string | null
          exam_part?: number | null
          exam_type?: string
          external_id: number
          grade_criteria_html?: string | null
          has_answer?: boolean
          has_solution?: boolean
          id?: string
          is_published?: boolean
          max_points?: number | null
          origin_external_id?: number | null
          partial_type?: string | null
          position?: number
          replaced_by_task_id?: string | null
          section_id: string
          solution_html?: string | null
          solution_plan_html?: string | null
          source_url?: string | null
          statement_html: string
          subject?: string
          updated_at?: string | null
        }
        Update: {
          answer_html?: string | null
          answer_spec?: Json | null
          auto_checkable?: boolean | null
          content_format?: string
          created_at?: string | null
          difficulty?: string | null
          exam_part?: number | null
          exam_type?: string
          external_id?: number
          grade_criteria_html?: string | null
          has_answer?: boolean
          has_solution?: boolean
          id?: string
          is_published?: boolean
          max_points?: number | null
          origin_external_id?: number | null
          partial_type?: string | null
          position?: number
          replaced_by_task_id?: string | null
          section_id?: string
          solution_html?: string | null
          solution_plan_html?: string | null
          source_url?: string | null
          statement_html?: string
          subject?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_tasks_replaced_by_task_id_fkey"
            columns: ["replaced_by_task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_tasks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "catalog_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_tasks_multichoice_backup_20260805: {
        Row: {
          answer_html: string | null
          external_id: number | null
          id: string | null
          partial_type: string | null
        }
        Insert: {
          answer_html?: string | null
          external_id?: number | null
          id?: string | null
          partial_type?: string | null
        }
        Update: {
          answer_html?: string | null
          external_id?: number | null
          id?: string | null
          partial_type?: string | null
        }
        Relationships: []
      }
      catalog_topics: {
        Row: {
          created_at: string | null
          exam_type: string
          external_id: number
          id: string
          is_published: boolean
          parent_id: string | null
          position: number
          slug: string | null
          subject: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          exam_type?: string
          external_id: number
          id?: string
          is_published?: boolean
          parent_id?: string | null
          position?: number
          slug?: string | null
          subject?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          exam_type?: string
          external_id?: number
          id?: string
          is_published?: boolean
          parent_id?: string | null
          position?: number
          slug?: string | null
          subject?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_topics_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "catalog_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_topics_title_backup_20260803: {
        Row: {
          external_id: number | null
          id: string | null
          title: string | null
        }
        Insert: {
          external_id?: number | null
          id?: string | null
          title?: string | null
        }
        Update: {
          external_id?: number | null
          id?: string | null
          title?: string | null
        }
        Relationships: []
      }
      course_copy_jobs: {
        Row: {
          created_at: string
          files: Json
          id: string
          kind: string
          requested_by: string
          source_course_id: string | null
          source_topic_id: string | null
          status: string
          target_course_id: string | null
          target_topic_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          files?: Json
          id?: string
          kind: string
          requested_by: string
          source_course_id?: string | null
          source_topic_id?: string | null
          status?: string
          target_course_id?: string | null
          target_topic_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          files?: Json
          id?: string
          kind?: string
          requested_by?: string
          source_course_id?: string | null
          source_topic_id?: string | null
          status?: string
          target_course_id?: string | null
          target_topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_copy_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_copy_jobs_source_course_id_fkey"
            columns: ["source_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_copy_jobs_source_topic_id_fkey"
            columns: ["source_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_copy_jobs_target_course_id_fkey"
            columns: ["target_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_copy_jobs_target_topic_id_fkey"
            columns: ["target_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      course_curators: {
        Row: {
          course_id: string
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_curators_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_curators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_join_links: {
        Row: {
          course_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          link_role: string
          rotated_at: string | null
          short_code: string
          token: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          link_role?: string
          rotated_at?: string | null
          short_code: string
          token: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          link_role?: string
          rotated_at?: string | null
          short_code?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_join_links_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_join_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_lessons: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_published: boolean
          position: number
          summary: string | null
          title: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_published?: boolean
          position?: number
          summary?: string | null
          title: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_published?: boolean
          position?: number
          summary?: string | null
          title?: string
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_lessons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lessons_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      course_reminder_settings: {
        Row: {
          check_soon: boolean
          course_id: string
          hw_due_tomorrow: boolean
          hw_overdue: boolean
          mock_tomorrow: boolean
          no_photo: boolean
          streak: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          check_soon?: boolean
          course_id: string
          hw_due_tomorrow?: boolean
          hw_overdue?: boolean
          mock_tomorrow?: boolean
          no_photo?: boolean
          streak?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          check_soon?: boolean
          course_id?: string
          hw_due_tomorrow?: boolean
          hw_overdue?: boolean
          mock_tomorrow?: boolean
          no_photo?: boolean
          streak?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_reminder_settings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_reminder_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_showcase: {
        Row: {
          course_id: string | null
          created_at: string
          description: string | null
          id: string
          includes: string[]
          is_active: boolean
          slug: string
          sort_order: number
          status: string
          subject: string | null
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          includes?: string[]
          is_active?: boolean
          slug: string
          sort_order?: number
          status?: string
          subject?: string | null
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          includes?: string[]
          is_active?: boolean
          slug?: string
          sort_order?: number
          status?: string
          subject?: string | null
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_showcase_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_showcase_waitlist: {
        Row: {
          created_at: string
          profile_id: string
          showcase_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          showcase_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          showcase_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_showcase_waitlist_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_showcase_waitlist_showcase_id_fkey"
            columns: ["showcase_id"]
            isOneToOne: false
            referencedRelation: "course_showcase"
            referencedColumns: ["id"]
          },
        ]
      }
      course_study_plan_items: {
        Row: {
          course_id: string
          topic_id: string
          week_no: number
        }
        Insert: {
          course_id: string
          topic_id: string
          week_no: number
        }
        Update: {
          course_id?: string
          topic_id?: string
          week_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_study_plan_items_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_study_plans"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "course_study_plan_items_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      course_study_plan_overrides: {
        Row: {
          course_id: string
          created_by: string
          removed: boolean
          student_id: string
          topic_id: string
          updated_at: string
          week_no: number | null
        }
        Insert: {
          course_id: string
          created_by: string
          removed?: boolean
          student_id: string
          topic_id: string
          updated_at?: string
          week_no?: number | null
        }
        Update: {
          course_id?: string
          created_by?: string
          removed?: boolean
          student_id?: string
          topic_id?: string
          updated_at?: string
          week_no?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "course_study_plan_overrides_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "course_study_plans"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "course_study_plan_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_study_plan_overrides_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_study_plan_overrides_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      course_study_plans: {
        Row: {
          auto_open: boolean
          course_id: string
          created_at: string
          created_by: string
          start_date: string
          updated_at: string
        }
        Insert: {
          auto_open?: boolean
          course_id: string
          created_at?: string
          created_by: string
          start_date: string
          updated_at?: string
        }
        Update: {
          auto_open?: boolean
          course_id?: string
          created_at?: string
          created_by?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_study_plans_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_study_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_unlock_modes: {
        Row: {
          course_id: string
          mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          course_id: string
          mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          course_id?: string
          mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_unlock_modes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_unlock_modes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          copied_from_course_id: string | null
          created_at: string
          description: string | null
          duration_weeks: number | null
          end_date: string | null
          enrollment_open_until: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          is_active: boolean
          is_default_for_direction: boolean
          is_draft: boolean
          is_template: boolean
          owner_id: string | null
          price: number
          start_date: string | null
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
        }
        Insert: {
          copied_from_course_id?: string | null
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          end_date?: string | null
          enrollment_open_until?: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id?: string
          is_active?: boolean
          is_default_for_direction?: boolean
          is_draft?: boolean
          is_template?: boolean
          owner_id?: string | null
          price?: number
          start_date?: string | null
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
        }
        Update: {
          copied_from_course_id?: string | null
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          end_date?: string | null
          enrollment_open_until?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          is_active?: boolean
          is_default_for_direction?: boolean
          is_draft?: boolean
          is_template?: boolean
          owner_id?: string | null
          price?: number
          start_date?: string | null
          subject?: Database["public"]["Enums"]["subject_type"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_copied_from_course_id_fkey"
            columns: ["copied_from_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      curators: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
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
      demo_users: {
        Row: {
          label: string
          role: string
          sort: number
          user_id: string
        }
        Insert: {
          label: string
          role: string
          sort?: number
          user_id: string
        }
        Update: {
          label?: string
          role?: string
          sort?: number
          user_id?: string
        }
        Relationships: []
      }
      diagnostic_answers: {
        Row: {
          answer: string | null
          block: number
          created_at: string
          id: number
          level: string
          ms: number | null
          n: number
          profile_id: string
          score: number
          session_id: string
          step: number
          task_id: string
          verdict: string
        }
        Insert: {
          answer?: string | null
          block: number
          created_at?: string
          id?: never
          level: string
          ms?: number | null
          n: number
          profile_id: string
          score: number
          session_id: string
          step: number
          task_id: string
          verdict: string
        }
        Update: {
          answer?: string | null
          block?: number
          created_at?: string
          id?: never
          level?: string
          ms?: number | null
          n?: number
          profile_id?: string
          score?: number
          session_id?: string
          step?: number
          task_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_answers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_sessions: {
        Row: {
          current_block: number | null
          current_level: string | null
          current_n: number | null
          current_shown_at: string | null
          current_step: number | null
          current_task_id: string | null
          finished_at: string | null
          id: string
          profile_id: string
          set_id: string
          started_at: string
          status: string
          subject: string
        }
        Insert: {
          current_block?: number | null
          current_level?: string | null
          current_n?: number | null
          current_shown_at?: string | null
          current_step?: number | null
          current_task_id?: string | null
          finished_at?: string | null
          id?: string
          profile_id: string
          set_id: string
          started_at?: string
          status?: string
          subject: string
        }
        Update: {
          current_block?: number | null
          current_level?: string | null
          current_n?: number | null
          current_shown_at?: string | null
          current_step?: number | null
          current_task_id?: string | null
          finished_at?: string | null
          id?: string
          profile_id?: string
          set_id?: string
          started_at?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_sessions_current_task_id_fkey"
            columns: ["current_task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_sessions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_sets: {
        Row: {
          blocks: Json
          created_at: string
          exam: string
          id: string
          is_active: boolean
          subject: string
          tasks: Json
          version: string
        }
        Insert: {
          blocks?: Json
          created_at?: string
          exam?: string
          id?: string
          is_active?: boolean
          subject: string
          tasks: Json
          version: string
        }
        Update: {
          blocks?: Json
          created_at?: string
          exam?: string
          id?: string
          is_active?: boolean
          subject?: string
          tasks?: Json
          version?: string
        }
        Relationships: []
      }
      distribution_flow_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          join_request_id: string | null
          request_id: string
          result: Json | null
          status: string
          teacher_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          join_request_id?: string | null
          request_id: string
          result?: Json | null
          status?: string
          teacher_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          join_request_id?: string | null
          request_id?: string
          result?: Json | null
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_flow_requests_join_request_id_fkey"
            columns: ["join_request_id"]
            isOneToOne: false
            referencedRelation: "teacher_join_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_flow_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_invite_batches: {
        Row: {
          created_at: string
          group_id: string
          id: string
          invited_by: string
          rows_count: number
          title: string | null
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          invited_by: string
          rows_count: number
          title?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          invited_by?: string
          rows_count?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_invite_batches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_invite_batches_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          batch_id: string | null
          class_grade: string | null
          client_row_id: string | null
          created_at: string
          email: string | null
          email_normalized: string | null
          expires_at: string
          full_name: string
          group_id: string
          id: string
          invited_by: string
          phone: string | null
          phone_normalized: string | null
          revoked_at: string | null
          short_code_hash: string | null
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          batch_id?: string | null
          class_grade?: string | null
          client_row_id?: string | null
          created_at?: string
          email?: string | null
          email_normalized?: string | null
          expires_at?: string
          full_name: string
          group_id: string
          id?: string
          invited_by: string
          phone?: string | null
          phone_normalized?: string | null
          revoked_at?: string | null
          short_code_hash?: string | null
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          batch_id?: string | null
          class_grade?: string | null
          client_row_id?: string | null
          created_at?: string
          email?: string | null
          email_normalized?: string | null
          expires_at?: string
          full_name?: string
          group_id?: string
          id?: string
          invited_by?: string
          phone?: string | null
          phone_normalized?: string | null
          revoked_at?: string | null
          short_code_hash?: string | null
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_invites_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "enrollment_invite_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
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
          course_id: string
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
          course_id: string
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
          course_id?: string
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
      homework_action_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      homework_ai_item_evaluations: {
        Row: {
          confidence: number | null
          created_at: string
          detected_task_number: string | null
          evidence: Json
          extracted_answer: string | null
          feedback: string | null
          id: string
          job_id: string
          max_score: number | null
          recognized_work: string | null
          status: Database["public"]["Enums"]["homework_ai_evaluation_status"]
          suggested_score: number | null
          template_item_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          detected_task_number?: string | null
          evidence?: Json
          extracted_answer?: string | null
          feedback?: string | null
          id?: string
          job_id: string
          max_score?: number | null
          recognized_work?: string | null
          status?: Database["public"]["Enums"]["homework_ai_evaluation_status"]
          suggested_score?: number | null
          template_item_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          detected_task_number?: string | null
          evidence?: Json
          extracted_answer?: string | null
          feedback?: string | null
          id?: string
          job_id?: string
          max_score?: number | null
          recognized_work?: string | null
          status?: Database["public"]["Enums"]["homework_ai_evaluation_status"]
          suggested_score?: number | null
          template_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_ai_item_evaluations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "homework_ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_ai_item_evaluations_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "homework_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_ai_jobs: {
        Row: {
          attempt_id: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          model: string | null
          model_version: string | null
          provider: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["homework_ai_job_status"]
        }
        Insert: {
          attempt_id: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model?: string | null
          model_version?: string | null
          provider?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["homework_ai_job_status"]
        }
        Update: {
          attempt_id?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model?: string | null
          model_version?: string | null
          provider?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["homework_ai_job_status"]
        }
        Relationships: [
          {
            foreignKeyName: "homework_ai_jobs_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "homework_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignment_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          request_id: string
          result: Json | null
          status: string
          teacher_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          request_id: string
          result?: Json | null
          status?: string
          teacher_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          request_id?: string
          result?: Json | null
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignment_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignments: {
        Row: {
          allow_late_submission: boolean
          created_at: string
          due_at: string
          group_id: string
          id: string
          max_attempts: number | null
          publish_at: string
          status: Database["public"]["Enums"]["homework_assignment_status"]
          teacher_id: string
          template_version_id: string
          updated_at: string
        }
        Insert: {
          allow_late_submission?: boolean
          created_at?: string
          due_at: string
          group_id: string
          id?: string
          max_attempts?: number | null
          publish_at: string
          status?: Database["public"]["Enums"]["homework_assignment_status"]
          teacher_id: string
          template_version_id: string
          updated_at?: string
        }
        Update: {
          allow_late_submission?: boolean
          created_at?: string
          due_at?: string
          group_id?: string
          id?: string
          max_attempts?: number | null
          publish_at?: string
          status?: Database["public"]["Enums"]["homework_assignment_status"]
          teacher_id?: string
          template_version_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "homework_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_attempt_files: {
        Row: {
          attempt_id: string
          created_at: string
          file_name: string
          height: number | null
          id: string
          metadata: Json
          mime_type: string | null
          page_number: number | null
          rotation: number | null
          sha256: string | null
          size: number | null
          source_type: string | null
          storage_path: string
          width: number | null
        }
        Insert: {
          attempt_id: string
          created_at?: string
          file_name: string
          height?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          page_number?: number | null
          rotation?: number | null
          sha256?: string | null
          size?: number | null
          source_type?: string | null
          storage_path: string
          width?: number | null
        }
        Update: {
          attempt_id?: string
          created_at?: string
          file_name?: string
          height?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          page_number?: number | null
          rotation?: number | null
          sha256?: string | null
          size?: number | null
          source_type?: string | null
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_attempt_files_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "homework_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_attempts: {
        Row: {
          answer_text: string | null
          assignment_id: string
          attempt_number: number
          created_at: string
          id: string
          score: number | null
          status: Database["public"]["Enums"]["homework_attempt_status"]
          student_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          answer_text?: string | null
          assignment_id: string
          attempt_number: number
          created_at?: string
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["homework_attempt_status"]
          student_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          answer_text?: string | null
          assignment_id?: string
          attempt_number?: number
          created_at?: string
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["homework_attempt_status"]
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_attempts_assignment_id_student_id_fkey"
            columns: ["assignment_id", "student_id"]
            isOneToOne: false
            referencedRelation: "homework_recipients"
            referencedColumns: ["assignment_id", "student_id"]
          },
        ]
      }
      homework_recipients: {
        Row: {
          assigned_at: string
          assignment_id: string
          due_at_override: string | null
          excused_reason: string | null
          is_excused: boolean
          student_id: string
          viewed_at: string | null
        }
        Insert: {
          assigned_at?: string
          assignment_id: string
          due_at_override?: string | null
          excused_reason?: string | null
          is_excused?: boolean
          student_id: string
          viewed_at?: string | null
        }
        Update: {
          assigned_at?: string
          assignment_id?: string
          due_at_override?: string | null
          excused_reason?: string | null
          is_excused?: boolean
          student_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_recipients_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_recipients_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_reviews: {
        Row: {
          attempt_id: string
          comment: string | null
          created_at: string
          decision: Database["public"]["Enums"]["homework_review_decision"]
          id: string
          reviewer_id: string
          score: number | null
        }
        Insert: {
          attempt_id: string
          comment?: string | null
          created_at?: string
          decision: Database["public"]["Enums"]["homework_review_decision"]
          id?: string
          reviewer_id: string
          score?: number | null
        }
        Update: {
          attempt_id?: string
          comment?: string | null
          created_at?: string
          decision?: Database["public"]["Enums"]["homework_review_decision"]
          id?: string
          reviewer_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_reviews_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "homework_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submission_files: {
        Row: {
          attempt_number: number
          created_at: string
          id: string
          mime_type: string | null
          position: number
          storage_path: string
          submission_id: string
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          id?: string
          mime_type?: string | null
          position: number
          storage_path: string
          submission_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          id?: string
          mime_type?: string | null
          position?: number
          storage_path?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "homework_submissions"
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
      homework_template_files: {
        Row: {
          created_at: string
          id: string
          mime_type: string | null
          original_filename: string
          size_bytes: number | null
          storage_path: string
          template_version_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type?: string | null
          original_filename: string
          size_bytes?: number | null
          storage_path: string
          template_version_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string | null
          original_filename?: string
          size_bytes?: number | null
          storage_path?: string
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_template_files_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "homework_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_template_items: {
        Row: {
          ai_check_enabled: boolean
          catalog_task_id: string
          created_at: string
          custom_number: string | null
          grading_mode: Database["public"]["Enums"]["homework_grading_mode"]
          grading_spec: Json
          id: string
          max_score: number | null
          position: number
          template_version_id: string
        }
        Insert: {
          ai_check_enabled?: boolean
          catalog_task_id: string
          created_at?: string
          custom_number?: string | null
          grading_mode?: Database["public"]["Enums"]["homework_grading_mode"]
          grading_spec?: Json
          id?: string
          max_score?: number | null
          position: number
          template_version_id: string
        }
        Update: {
          ai_check_enabled?: boolean
          catalog_task_id?: string
          created_at?: string
          custom_number?: string | null
          grading_mode?: Database["public"]["Enums"]["homework_grading_mode"]
          grading_spec?: Json
          id?: string
          max_score?: number | null
          position?: number
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_template_items_catalog_task_id_fkey"
            columns: ["catalog_task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_template_items_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "homework_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_template_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          instructions: string | null
          max_score: number | null
          pdf_config: Json
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          instructions?: string | null
          max_score?: number | null
          pdf_config?: Json
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string | null
          max_score?: number | null
          pdf_config?: Json
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "homework_template_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "homework_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_templates: {
        Row: {
          course_id: string
          created_at: string
          created_by: string
          id: string
          status: Database["public"]["Enums"]["homework_template_status"]
          title: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by: string
          id?: string
          status?: Database["public"]["Enums"]["homework_template_status"]
          title: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string
          id?: string
          status?: Database["public"]["Enums"]["homework_template_status"]
          title?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_templates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_templates_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
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
          id: string
          is_archived: boolean
          lesson_id: string | null
          max_score: number
          source_template_id: string | null
          teacher_id: string
          title: string
          topic_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          due_date: string
          file_url?: string | null
          id?: string
          is_archived?: boolean
          lesson_id?: string | null
          max_score?: number
          source_template_id?: string | null
          teacher_id: string
          title: string
          topic_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string
          file_url?: string | null
          id?: string
          is_archived?: boolean
          lesson_id?: string | null
          max_score?: number
          source_template_id?: string | null
          teacher_id?: string
          title?: string
          topic_id?: string
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
            foreignKeyName: "homeworks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeworks_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "lesson_templates"
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
      invite_flow_requests: {
        Row: {
          completed_at: string | null
          course_id: string | null
          created_at: string
          group_id: string | null
          id: string
          invite_id: string | null
          request_id: string
          result: Json | null
          status: string
          teacher_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          invite_id?: string | null
          request_id: string
          result?: Json | null
          status?: string
          teacher_id: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          invite_id?: string | null
          request_id?: string
          result?: Json | null
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_flow_requests_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_flow_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_flow_requests_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "enrollment_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_flow_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
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
      leads: {
        Row: {
          comment: string | null
          created_at: string
          goal: string | null
          id: string
          name: string
          phone: string
          social: string | null
          source: string
          status: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          goal?: string | null
          id?: string
          name: string
          phone: string
          social?: string | null
          source?: string
          status?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          goal?: string | null
          id?: string
          name?: string
          phone?: string
          social?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      lesson_copy_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          manifest: Json
          requested_available_from: string | null
          requested_by: string
          requested_order_index: number | null
          status: string
          target_course_id: string
          target_group_id: string | null
          target_module_id: string
          template_id: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          manifest?: Json
          requested_available_from?: string | null
          requested_by: string
          requested_order_index?: number | null
          status?: string
          target_course_id: string
          target_group_id?: string | null
          target_module_id: string
          template_id: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          manifest?: Json
          requested_available_from?: string | null
          requested_by?: string
          requested_order_index?: number | null
          status?: string
          target_course_id?: string
          target_group_id?: string | null
          target_module_id?: string
          template_id?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_copy_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_copy_jobs_target_course_id_fkey"
            columns: ["target_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_copy_jobs_target_group_id_fkey"
            columns: ["target_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_copy_jobs_target_module_id_fkey"
            columns: ["target_module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_copy_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lesson_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_copy_jobs_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_materials: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_visible_to_student: boolean
          lesson_id: string
          material_type: string
          position: number
          storage_path: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_visible_to_student?: boolean
          lesson_id: string
          material_type: string
          position?: number
          storage_path?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_visible_to_student?: boolean
          lesson_id?: string
          material_type?: string
          position?: number
          storage_path?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_materials_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
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
      lesson_template_copies: {
        Row: {
          created_at: string
          created_by: string
          id: string
          target_course_id: string
          target_group_id: string | null
          template_id: string
          topic_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          target_course_id: string
          target_group_id?: string | null
          template_id: string
          topic_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          target_course_id?: string
          target_group_id?: string | null
          template_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_template_copies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_template_copies_target_course_id_fkey"
            columns: ["target_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_template_copies_target_group_id_fkey"
            columns: ["target_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_template_copies_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lesson_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_template_copies_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_template_materials: {
        Row: {
          content: string | null
          created_at: string
          file_path: string | null
          id: string
          link_url: string | null
          sort_order: number
          template_id: string
          type: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          link_url?: string | null
          sort_order?: number
          template_id: string
          type: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          link_url?: string | null
          sort_order?: number
          template_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_template_materials_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lesson_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_template_tasks: {
        Row: {
          catalog_task_id: string | null
          created_at: string
          id: string
          payload: Json
          sort_order: number
          task_kind: string
          template_id: string
          title: string | null
        }
        Insert: {
          catalog_task_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          sort_order?: number
          task_kind: string
          template_id: string
          title?: string | null
        }
        Update: {
          catalog_task_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          sort_order?: number
          task_kind?: string
          template_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_template_tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lesson_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_templates: {
        Row: {
          catalog_topic_id: string | null
          created_at: string
          description: string | null
          exam_type: Database["public"]["Enums"]["exam_type"] | null
          id: string
          is_shared: boolean
          owner_id: string
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
          updated_at: string
        }
        Insert: {
          catalog_topic_id?: string | null
          created_at?: string
          description?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"] | null
          id?: string
          is_shared?: boolean
          owner_id: string
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
          updated_at?: string
        }
        Update: {
          catalog_topic_id?: string | null
          created_at?: string
          description?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"] | null
          id?: string
          is_shared?: boolean
          owner_id?: string
          subject?: Database["public"]["Enums"]["subject_type"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_templates_catalog_topic_id_fkey"
            columns: ["catalog_topic_id"]
            isOneToOne: false
            referencedRelation: "catalog_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          actual_topic: string | null
          board_url: string | null
          completed_at: string | null
          course_id: string | null
          created_at: string
          duration_minutes: number
          format: Database["public"]["Enums"]["lesson_format"]
          group_id: string | null
          id: string
          lesson_summary: string | null
          notes: string | null
          planned_topic: string | null
          recommendations: string | null
          recording_url: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_feedback: string | null
          student_id: string | null
          teacher_id: string
          teacher_notes: string | null
          title: string
          topic_id: string | null
          zoom_link: string | null
        }
        Insert: {
          actual_topic?: string | null
          board_url?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          duration_minutes?: number
          format?: Database["public"]["Enums"]["lesson_format"]
          group_id?: string | null
          id?: string
          lesson_summary?: string | null
          notes?: string | null
          planned_topic?: string | null
          recommendations?: string | null
          recording_url?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_feedback?: string | null
          student_id?: string | null
          teacher_id: string
          teacher_notes?: string | null
          title: string
          topic_id?: string | null
          zoom_link?: string | null
        }
        Update: {
          actual_topic?: string | null
          board_url?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          duration_minutes?: number
          format?: Database["public"]["Enums"]["lesson_format"]
          group_id?: string | null
          id?: string
          lesson_summary?: string | null
          notes?: string | null
          planned_topic?: string | null
          recommendations?: string | null
          recording_url?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_feedback?: string | null
          student_id?: string | null
          teacher_id?: string
          teacher_notes?: string | null
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
      material_views: {
        Row: {
          item_id: string
          profile_id: string
          topic_id: string
          viewed_on: string
        }
        Insert: {
          item_id: string
          profile_id: string
          topic_id: string
          viewed_on: string
        }
        Update: {
          item_id?: string
          profile_id?: string
          topic_id?: string
          viewed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_views_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "topic_material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_views_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_views_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_ai_runs: {
        Row: {
          finished_at: string | null
          input_tokens: number | null
          last_error: string | null
          mock_exam_id: string
          model: string | null
          note: string | null
          output_tokens: number | null
          requested_at: string
          requested_by: string | null
          started_at: string | null
          status: string
          student_id: string
        }
        Insert: {
          finished_at?: string | null
          input_tokens?: number | null
          last_error?: string | null
          mock_exam_id: string
          model?: string | null
          note?: string | null
          output_tokens?: number | null
          requested_at?: string
          requested_by?: string | null
          started_at?: string | null
          status?: string
          student_id: string
        }
        Update: {
          finished_at?: string | null
          input_tokens?: number | null
          last_error?: string | null
          mock_exam_id?: string
          model?: string | null
          note?: string | null
          output_tokens?: number | null
          requested_at?: string
          requested_by?: string | null
          started_at?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_ai_runs_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_ai_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_ai_runs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_ai_suggestions: {
        Row: {
          comment: string | null
          confidence: string
          created_at: string
          id: string
          max_points: number
          mock_exam_id: string
          model: string | null
          points: number
          regions: Json
          student_id: string
          task_number: number
        }
        Insert: {
          comment?: string | null
          confidence: string
          created_at?: string
          id?: string
          max_points: number
          mock_exam_id: string
          model?: string | null
          points: number
          regions?: Json
          student_id: string
          task_number: number
        }
        Update: {
          comment?: string | null
          confidence?: string
          created_at?: string
          id?: string
          max_points?: number
          mock_exam_id?: string
          model?: string | null
          points?: number
          regions?: Json
          student_id?: string
          task_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_ai_suggestions_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_ai_suggestions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_answer_keys: {
        Row: {
          answers: string[]
          mock_exam_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answers: string[]
          mock_exam_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answers?: string[]
          mock_exam_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_answer_keys_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: true
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_answer_keys_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_file_text_cache: {
        Row: {
          chars: number | null
          created_at: string
          engine: string | null
          size_bytes: number
          storage_path: string
          text: string
        }
        Insert: {
          chars?: number | null
          created_at?: string
          engine?: string | null
          size_bytes: number
          storage_path: string
          text: string
        }
        Update: {
          chars?: number | null
          created_at?: string
          engine?: string | null
          size_bytes?: number
          storage_path?: string
          text?: string
        }
        Relationships: []
      }
      mock_exam_photos: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          mock_exam_id: string
          position: number
          size_bytes: number | null
          storage_path: string
          student_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          mock_exam_id: string
          position?: number
          size_bytes?: number | null
          storage_path: string
          student_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          mock_exam_id?: string
          position?: number
          size_bytes?: number | null
          storage_path?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_photos_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_photos_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          notified_at: string | null
          notified_part1_score: number | null
          notified_part2_score: number | null
          notified_score: number | null
          part1_score: number | null
          part2_score: number | null
          primary_score: number | null
          score: number
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mock_exam_id: string
          notes?: string | null
          notified_at?: string | null
          notified_part1_score?: number | null
          notified_part2_score?: number | null
          notified_score?: number | null
          part1_score?: number | null
          part2_score?: number | null
          primary_score?: number | null
          score: number
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mock_exam_id?: string
          notes?: string | null
          notified_at?: string | null
          notified_part1_score?: number | null
          notified_part2_score?: number | null
          notified_score?: number | null
          part1_score?: number | null
          part2_score?: number | null
          primary_score?: number | null
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
      mock_exam_sheets: {
        Row: {
          answers: string[]
          created_at: string
          last_seen_at: string | null
          mock_exam_id: string
          opened_at: string | null
          student_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          answers?: string[]
          created_at?: string
          last_seen_at?: string | null
          mock_exam_id: string
          opened_at?: string | null
          student_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          answers?: string[]
          created_at?: string
          last_seen_at?: string | null
          mock_exam_id?: string
          opened_at?: string | null
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_sheets_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_sheets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_task_scores: {
        Row: {
          auto_points: number | null
          comment: string | null
          id: string
          mock_exam_id: string
          points: number
          student_id: string
          task_number: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_points?: number | null
          comment?: string | null
          id?: string
          mock_exam_id: string
          points: number
          student_id: string
          task_number: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_points?: number | null
          comment?: string | null
          id?: string
          mock_exam_id?: string
          points?: number
          student_id?: string
          task_number?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_task_scores_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_task_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_task_scores_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_templates: {
        Row: {
          created_at: string
          created_by: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          max_points: number[]
          part1_last: number
          score_scale: number[] | null
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id?: string
          max_points: number[]
          part1_last: number
          score_scale?: number[] | null
          subject: Database["public"]["Enums"]["subject_type"]
          title: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          max_points?: number[]
          part1_last?: number
          score_scale?: number[] | null
          subject?: Database["public"]["Enums"]["subject_type"]
          title?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exam_variant_keys: {
        Row: {
          answers: string[]
          mock_exam_id: string
          updated_at: string
          updated_by: string | null
          variant_id: string
        }
        Insert: {
          answers: string[]
          mock_exam_id: string
          updated_at?: string
          updated_by?: string | null
          variant_id: string
        }
        Update: {
          answers?: string[]
          mock_exam_id?: string
          updated_at?: string
          updated_by?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_variant_keys_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_variant_keys_variant_id_mock_exam_id_fkey"
            columns: ["variant_id", "mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exam_variants"
            referencedColumns: ["id", "mock_exam_id"]
          },
        ]
      }
      mock_exam_variant_students: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          mock_exam_id: string
          student_id: string
          variant_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          mock_exam_id: string
          student_id: string
          variant_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          mock_exam_id?: string
          student_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_variant_students_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_variant_students_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_variant_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exam_variant_students_variant_id_mock_exam_id_fkey"
            columns: ["variant_id", "mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exam_variants"
            referencedColumns: ["id", "mock_exam_id"]
          },
        ]
      }
      mock_exam_variants: {
        Row: {
          condition_path: string | null
          created_at: string
          criteria_path: string | null
          id: string
          label: string | null
          mock_exam_id: string
          position: number
          solution_path: string | null
          updated_at: string
        }
        Insert: {
          condition_path?: string | null
          created_at?: string
          criteria_path?: string | null
          id?: string
          label?: string | null
          mock_exam_id: string
          position: number
          solution_path?: string | null
          updated_at?: string
        }
        Update: {
          condition_path?: string | null
          created_at?: string
          criteria_path?: string | null
          id?: string
          label?: string | null
          mock_exam_id?: string
          position?: number
          solution_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exam_variants_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_exams: {
        Row: {
          condition_path: string | null
          created_at: string
          created_by: string | null
          date: string
          duration_minutes: number
          exam_type: Database["public"]["Enums"]["exam_type"]
          group_id: string | null
          id: string
          max_score: number
          module_id: string | null
          module_position: number
          photo_grace_minutes: number
          solution_path: string | null
          starts_at: string | null
          subject: Database["public"]["Enums"]["subject_type"]
          template_id: string | null
          title: string
          variant_mode: string
        }
        Insert: {
          condition_path?: string | null
          created_at?: string
          created_by?: string | null
          date: string
          duration_minutes?: number
          exam_type: Database["public"]["Enums"]["exam_type"]
          group_id?: string | null
          id?: string
          max_score?: number
          module_id?: string | null
          module_position?: number
          photo_grace_minutes?: number
          solution_path?: string | null
          starts_at?: string | null
          subject: Database["public"]["Enums"]["subject_type"]
          template_id?: string | null
          title: string
          variant_mode?: string
        }
        Update: {
          condition_path?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          duration_minutes?: number
          exam_type?: Database["public"]["Enums"]["exam_type"]
          group_id?: string | null
          id?: string
          max_score?: number
          module_id?: string | null
          module_position?: number
          photo_grace_minutes?: number
          solution_path?: string | null
          starts_at?: string | null
          subject?: Database["public"]["Enums"]["subject_type"]
          template_id?: string | null
          title?: string
          variant_mode?: string
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
          {
            foreignKeyName: "mock_exams_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_exams_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "mock_exam_templates"
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
          source_module_id: string | null
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          order_index?: number
          source_module_id?: string | null
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          order_index?: number
          source_module_id?: string | null
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
          {
            foreignKeyName: "modules_source_module_id_fkey"
            columns: ["source_module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_errors: {
        Row: {
          created_at: string
          entity_id: string | null
          id: string
          message: string | null
          source: string
          sqlstate: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          id?: string
          message?: string | null
          source: string
          sqlstate?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          id?: string
          message?: string | null
          source?: string
          sqlstate?: string | null
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          badge: boolean
          checked: boolean
          email: boolean
          homework: boolean
          lesson: boolean
          lesson_changed: boolean
          overdue: boolean
          payment: boolean
          remind_check_soon: boolean
          remind_hw_due_tomorrow: boolean
          remind_hw_overdue: boolean
          remind_mock_tomorrow: boolean
          remind_no_photo: boolean
          remind_streak: boolean
          telegram: boolean
          telegram_variant_assignments: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          badge?: boolean
          checked?: boolean
          email?: boolean
          homework?: boolean
          lesson?: boolean
          lesson_changed?: boolean
          overdue?: boolean
          payment?: boolean
          remind_check_soon?: boolean
          remind_hw_due_tomorrow?: boolean
          remind_hw_overdue?: boolean
          remind_mock_tomorrow?: boolean
          remind_no_photo?: boolean
          remind_streak?: boolean
          telegram?: boolean
          telegram_variant_assignments?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          badge?: boolean
          checked?: boolean
          email?: boolean
          homework?: boolean
          lesson?: boolean
          lesson_changed?: boolean
          overdue?: boolean
          payment?: boolean
          remind_check_soon?: boolean
          remind_hw_due_tomorrow?: boolean
          remind_hw_overdue?: boolean
          remind_mock_tomorrow?: boolean
          remind_no_photo?: boolean
          remind_streak?: boolean
          telegram?: boolean
          telegram_variant_assignments?: boolean
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
      notification_queue: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          deduplication_key: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processing_at: string | null
          profile_id: string
          retry_count: number
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_queue_status"]
        }
        Insert: {
          attempts?: number
          channel?: string
          created_at?: string
          deduplication_key: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          payload?: Json
          processing_at?: string | null
          profile_id: string
          retry_count?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_queue_status"]
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          deduplication_key?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processing_at?: string | null
          profile_id?: string
          retry_count?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_queue_status"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          dedup_key: string | null
          id: string
          link: string | null
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          id?: string
          link?: string | null
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          id?: string
          link?: string | null
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
      perf_events: {
        Row: {
          at: string
          device: string
          id: number
          kind: string
          label: string
          ms: number
          profile_id: string
          role: string | null
          status: number | null
        }
        Insert: {
          at?: string
          device?: string
          id?: never
          kind: string
          label: string
          ms: number
          profile_id: string
          role?: string | null
          status?: number | null
        }
        Update: {
          at?: string
          device?: string
          id?: never
          kind?: string
          label?: string
          ms?: number
          profile_id?: string
          role?: string | null
          status?: number | null
        }
        Relationships: []
      }
      perf_hourly: {
        Row: {
          errors: number
          hour: string
          kind: string
          label: string
          max_ms: number
          n: number
          p50: number
          p95: number
          students: number
        }
        Insert: {
          errors?: number
          hour: string
          kind: string
          label: string
          max_ms: number
          n: number
          p50: number
          p95: number
          students?: number
        }
        Update: {
          errors?: number
          hour?: string
          kind?: string
          label?: string
          max_ms?: number
          n?: number
          p50?: number
          p95?: number
          students?: number
        }
        Relationships: []
      }
      perf_hourly_load: {
        Row: {
          events: number
          hour: string
          staff: number
          students: number
        }
        Insert: {
          events: number
          hour: string
          staff: number
          students: number
        }
        Update: {
          events?: number
          hour?: string
          staff?: number
          students?: number
        }
        Relationships: []
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
      school_presence: {
        Row: {
          profile_id: string
          role: string
          seen_at: string
        }
        Insert: {
          profile_id: string
          role?: string
          seen_at?: string
        }
        Update: {
          profile_id?: string
          role?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_presence_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_achievements: {
        Row: {
          created_at: string
          earned_at: string
          key: string
          profile_id: string
          seen_at: string | null
        }
        Insert: {
          created_at?: string
          earned_at?: string
          key: string
          profile_id: string
          seen_at?: string | null
        }
        Update: {
          created_at?: string
          earned_at?: string
          key?: string
          profile_id?: string
          seen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_achievements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      student_daily_tasks: {
        Row: {
          created_at: string
          day: string
          n: number
          profile_id: string
          subject: string
          task_id: string
        }
        Insert: {
          created_at?: string
          day: string
          n: number
          profile_id: string
          subject: string
          task_id: string
        }
        Update: {
          created_at?: string
          day?: string
          n?: number
          profile_id?: string
          subject?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_daily_tasks_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_daily_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      student_exam_goals: {
        Row: {
          goal: number
          profile_id: string
          subject: Database["public"]["Enums"]["subject_type"]
          updated_at: string
        }
        Insert: {
          goal: number
          profile_id: string
          subject: Database["public"]["Enums"]["subject_type"]
          updated_at?: string
        }
        Update: {
          goal?: number
          profile_id?: string
          subject?: Database["public"]["Enums"]["subject_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_exam_goals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_feedback_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          model: string | null
          student_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          model?: string | null
          student_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          model?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_feedback_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_feedback_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_forecast_marks: {
        Row: {
          first_at: string
          first_score: number
          goal_reached_at: string | null
          last_at: string
          last_score: number
          profile_id: string
          subject: string
        }
        Insert: {
          first_at?: string
          first_score: number
          goal_reached_at?: string | null
          last_at?: string
          last_score: number
          profile_id: string
          subject: string
        }
        Update: {
          first_at?: string
          first_score?: number
          goal_reached_at?: string | null
          last_at?: string
          last_score?: number
          profile_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_forecast_marks_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string
          diagnostic_status: string
          exam: string
          grade: number
          hours_per_week: number | null
          months_to_exam: number | null
          profile_id: string
          subject: string
          target_score: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          diagnostic_status?: string
          exam?: string
          grade: number
          hours_per_week?: number | null
          months_to_exam?: number | null
          profile_id: string
          subject: string
          target_score: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          diagnostic_status?: string
          exam?: string
          grade?: number
          hours_per_week?: number | null
          months_to_exam?: number | null
          profile_id?: string
          subject?: string
          target_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_onboarding_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_report_next_steps: {
        Row: {
          created_at: string
          id: string
          period_from: string
          period_to: string
          steps: string[]
          student_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          period_from: string
          period_to: string
          steps?: string[]
          student_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          period_from?: string
          period_to?: string
          steps?: string[]
          student_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_report_next_steps_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_report_next_steps_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_subject_targets: {
        Row: {
          created_at: string
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          student_id: string
          subject: Database["public"]["Enums"]["subject_type"]
          target_score: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          exam_type: Database["public"]["Enums"]["exam_type"]
          id?: string
          student_id: string
          subject: Database["public"]["Enums"]["subject_type"]
          target_score: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          student_id?: string
          subject?: Database["public"]["Enums"]["subject_type"]
          target_score?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_subject_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subject_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_subscriptions: {
        Row: {
          access_until: string | null
          auto_renew: boolean
          cancelled_at: string | null
          card_title: string | null
          charge_attempts: number
          course_id: string
          created_at: string
          current_period_end: string | null
          id: string
          last_charge_error: string | null
          next_charge_at: string | null
          receipt_email: string | null
          source: string
          status: string
          student_id: string
          tariff_id: string
          trial_used_at: string | null
          updated_at: string
        }
        Insert: {
          access_until?: string | null
          auto_renew?: boolean
          cancelled_at?: string | null
          card_title?: string | null
          charge_attempts?: number
          course_id: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_charge_error?: string | null
          next_charge_at?: string | null
          receipt_email?: string | null
          source?: string
          status?: string
          student_id: string
          tariff_id: string
          trial_used_at?: string | null
          updated_at?: string
        }
        Update: {
          access_until?: string | null
          auto_renew?: boolean
          cancelled_at?: string | null
          card_title?: string | null
          charge_attempts?: number
          course_id?: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_charge_error?: string | null
          next_charge_at?: string | null
          receipt_email?: string | null
          source?: string
          status?: string
          student_id?: string
          tariff_id?: string
          trial_used_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_subscriptions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subscriptions_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "subscription_tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      student_topic_override_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: number
          new_state: string | null
          note: string | null
          old_state: string | null
          student_id: string
          topic_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: never
          new_state?: string | null
          note?: string | null
          old_state?: string | null
          student_id: string
          topic_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: never
          new_state?: string | null
          note?: string | null
          old_state?: string | null
          student_id?: string
          topic_id?: string
        }
        Relationships: []
      }
      student_topic_overrides: {
        Row: {
          note: string | null
          set_at: string
          set_by: string | null
          state: string
          student_id: string
          topic_id: string
        }
        Insert: {
          note?: string | null
          set_at?: string
          set_by?: string | null
          state: string
          student_id: string
          topic_id: string
        }
        Update: {
          note?: string | null
          set_at?: string
          set_by?: string | null
          state?: string
          student_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_topic_overrides_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_topic_overrides_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_topic_overrides_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      student_weekly_goals: {
        Row: {
          created_at: string
          numbers: number[]
          profile_id: string
          subject: string
          target: number
          week_start: string
        }
        Insert: {
          created_at?: string
          numbers: number[]
          profile_id: string
          subject: string
          target?: number
          week_start: string
        }
        Update: {
          created_at?: string
          numbers?: number[]
          profile_id?: string
          subject?: string
          target?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_weekly_goals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      subscription_consents: {
        Row: {
          accepted_offer: boolean
          created_at: string
          id: string
          is_minor: boolean
          offer_url: string | null
          parent_consent: boolean
          privacy_url: string | null
          profile_id: string
          receipt_email: string | null
          save_card: boolean
          student_id: string
          subscription_id: string
        }
        Insert: {
          accepted_offer: boolean
          created_at?: string
          id?: string
          is_minor: boolean
          offer_url?: string | null
          parent_consent?: boolean
          privacy_url?: string | null
          profile_id: string
          receipt_email?: string | null
          save_card?: boolean
          student_id: string
          subscription_id: string
        }
        Update: {
          accepted_offer?: boolean
          created_at?: string
          id?: string
          is_minor?: boolean
          offer_url?: string | null
          parent_consent?: boolean
          privacy_url?: string | null
          profile_id?: string
          receipt_email?: string | null
          save_card?: boolean
          student_id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_consents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_consents_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_consents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "student_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_log: {
        Row: {
          actor: string | null
          created_at: string
          details: Json
          event: string
          id: number
          payment_id: string | null
          subscription_id: string | null
          yookassa_object_id: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          details?: Json
          event: string
          id?: never
          payment_id?: string | null
          subscription_id?: string | null
          yookassa_object_id?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          details?: Json
          event?: string
          id?: never
          payment_id?: string | null
          subscription_id?: string | null
          yookassa_object_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_log_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_log_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "student_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_mail_outbox: {
        Row: {
          attempts: number
          created_at: string
          dedup_key: string
          id: number
          kind: string
          last_error: string | null
          sent_at: string | null
          skipped_reason: string | null
          subscription_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedup_key: string
          id?: never
          kind: string
          last_error?: string | null
          sent_at?: string | null
          skipped_reason?: string | null
          subscription_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedup_key?: string
          id?: never
          kind?: string
          last_error?: string | null
          sent_at?: string | null
          skipped_reason?: string | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_mail_outbox_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "student_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payment_methods: {
        Row: {
          saved_at: string
          subscription_id: string
          yookassa_method_id: string
        }
        Insert: {
          saved_at?: string
          subscription_id: string
          yookassa_method_id: string
        }
        Update: {
          saved_at?: string
          subscription_id?: string
          yookassa_method_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payment_methods_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "student_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount_rub: number
          cancellation_reason: string | null
          confirmation_url: string | null
          created_at: string
          discount_rub: number
          finance_verified_at: string | null
          id: string
          is_test: boolean | null
          kind: string
          paid_at: string | null
          period_months: number
          promo_redemption_id: string | null
          receipt_email: string | null
          refunded_at: string | null
          save_method_requested: boolean
          status: string
          student_id: string
          subscription_id: string
          tariff_id: string | null
          updated_at: string
          yookassa_payment_id: string | null
        }
        Insert: {
          amount_rub: number
          cancellation_reason?: string | null
          confirmation_url?: string | null
          created_at?: string
          discount_rub?: number
          finance_verified_at?: string | null
          id?: string
          is_test?: boolean | null
          kind: string
          paid_at?: string | null
          period_months: number
          promo_redemption_id?: string | null
          receipt_email?: string | null
          refunded_at?: string | null
          save_method_requested?: boolean
          status?: string
          student_id: string
          subscription_id: string
          tariff_id?: string | null
          updated_at?: string
          yookassa_payment_id?: string | null
        }
        Update: {
          amount_rub?: number
          cancellation_reason?: string | null
          confirmation_url?: string | null
          created_at?: string
          discount_rub?: number
          finance_verified_at?: string | null
          id?: string
          is_test?: boolean | null
          kind?: string
          paid_at?: string | null
          period_months?: number
          promo_redemption_id?: string | null
          receipt_email?: string | null
          refunded_at?: string | null
          save_method_requested?: boolean
          status?: string
          student_id?: string
          subscription_id?: string
          tariff_id?: string | null
          updated_at?: string
          yookassa_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_promo_redemption_id_fkey"
            columns: ["promo_redemption_id"]
            isOneToOne: false
            referencedRelation: "subscription_promo_redemptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "student_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "subscription_tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_promo_attempts: {
        Row: {
          created_at: string
          id: number
          ok: boolean
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          ok: boolean
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: never
          ok?: boolean
          profile_id?: string
        }
        Relationships: []
      }
      subscription_promo_codes: {
        Row: {
          batch: string | null
          code: string
          course_id: string | null
          created_at: string
          created_by: string | null
          discount_payments: number
          free_days: number | null
          free_months: number | null
          id: string
          is_active: boolean
          kind: string
          max_uses: number | null
          note: string | null
          percent: number | null
          tariff_id: string | null
          updated_at: string
          used_count: number
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          batch?: string | null
          code: string
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_payments?: number
          free_days?: number | null
          free_months?: number | null
          id?: string
          is_active?: boolean
          kind: string
          max_uses?: number | null
          note?: string | null
          percent?: number | null
          tariff_id?: string | null
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          batch?: string | null
          code?: string
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_payments?: number
          free_days?: number | null
          free_months?: number | null
          id?: string
          is_active?: boolean
          kind?: string
          max_uses?: number | null
          note?: string | null
          percent?: number | null
          tariff_id?: string | null
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_promo_codes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_promo_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_promo_codes_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "subscription_tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_promo_redemptions: {
        Row: {
          applied_at: string | null
          code_id: string
          created_at: string
          id: string
          kind: string
          payments_left: number
          payments_total: number
          percent: number | null
          profile_id: string
          saved_rub: number
          status: string
          student_id: string
          subscription_id: string | null
          tariff_id: string | null
        }
        Insert: {
          applied_at?: string | null
          code_id: string
          created_at?: string
          id?: string
          kind: string
          payments_left?: number
          payments_total?: number
          percent?: number | null
          profile_id: string
          saved_rub?: number
          status?: string
          student_id: string
          subscription_id?: string | null
          tariff_id?: string | null
        }
        Update: {
          applied_at?: string | null
          code_id?: string
          created_at?: string
          id?: string
          kind?: string
          payments_left?: number
          payments_total?: number
          percent?: number | null
          profile_id?: string
          saved_rub?: number
          status?: string
          student_id?: string
          subscription_id?: string | null
          tariff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_promo_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "subscription_promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_promo_redemptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_promo_redemptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_promo_redemptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "student_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_promo_redemptions_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "subscription_tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_settings: {
        Row: {
          audience: string
          id: boolean
          offer_url: string | null
          parent_consent_url: string | null
          privacy_url: string | null
          retry_days: number[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          audience?: string
          id?: boolean
          offer_url?: string | null
          parent_consent_url?: string | null
          privacy_url?: string | null
          retry_days?: number[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          audience?: string
          id?: boolean
          offer_url?: string | null
          parent_consent_url?: string | null
          privacy_url?: string | null
          retry_days?: number[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_tariffs: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          period_months: number
          price_rub: number
          receipt_vat_code: number | null
          sort_order: number
          title: string
          trial_days: number
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          period_months?: number
          price_rub: number
          receipt_vat_code?: number | null
          sort_order?: number
          title: string
          trial_days?: number
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          period_months?: number
          price_rub?: number
          receipt_vat_code?: number | null
          sort_order?: number
          title?: string
          trial_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_tariffs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_tariffs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_testers: {
        Row: {
          added_at: string
          added_by: string | null
          note: string | null
          profile_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          note?: string | null
          profile_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          note?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_testers_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_testers_profile_id_fkey"
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
      support_requests: {
        Row: {
          attachments: string[]
          author_id: string
          author_name: string | null
          author_role: Database["public"]["Enums"]["user_role"] | null
          created_at: string
          id: string
          message: string
          page_path: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string | null
        }
        Insert: {
          attachments?: string[]
          author_id: string
          author_name?: string | null
          author_role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string
          id?: string
          message: string
          page_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          attachments?: string[]
          author_id?: string
          author_name?: string | null
          author_role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string
          id?: string
          message?: string
          page_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_collection_items: {
        Row: {
          catalog_task_id: string
          collection_id: string
          created_at: string
          custom_number: string | null
          id: string
          position: number
        }
        Insert: {
          catalog_task_id: string
          collection_id: string
          created_at?: string
          custom_number?: string | null
          id?: string
          position: number
        }
        Update: {
          catalog_task_id?: string
          collection_id?: string
          created_at?: string
          custom_number?: string | null
          id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_collection_items_catalog_task_id_fkey"
            columns: ["catalog_task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collection_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "task_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      task_collections: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_archived: boolean
          pdf_config: Json
          subject: string
          title: string
          updated_at: string
          work_type: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_archived?: boolean
          pdf_config?: Json
          subject: string
          title: string
          updated_at?: string
          work_type?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          pdf_config?: Json
          subject?: string
          title?: string
          updated_at?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_collections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_submissions: {
        Row: {
          answers: Json
          assigned_id: string
          created_at: string
          files: string[]
          id: string
          reviewed_at: string | null
          score: number | null
          status: string
          student_id: string
          submitted_at: string
          teacher_comment: string | null
          updated_at: string
        }
        Insert: {
          answers?: Json
          assigned_id: string
          created_at?: string
          files?: string[]
          id?: string
          reviewed_at?: string | null
          score?: number | null
          status?: string
          student_id: string
          submitted_at?: string
          teacher_comment?: string | null
          updated_at?: string
        }
        Update: {
          answers?: Json
          assigned_id?: string
          created_at?: string
          files?: string[]
          id?: string
          reviewed_at?: string | null
          score?: number | null
          status?: string
          student_id?: string
          submitted_at?: string
          teacher_comment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_submissions_assigned_id_fkey"
            columns: ["assigned_id"]
            isOneToOne: false
            referencedRelation: "assigned_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_join_links: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          public_token: string
          revoked_at: string | null
          rotated_from_id: string | null
          teacher_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          public_token: string
          revoked_at?: string | null
          rotated_from_id?: string | null
          teacher_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          public_token?: string
          revoked_at?: string | null
          rotated_from_id?: string | null
          teacher_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_join_links_rotated_from_id_fkey"
            columns: ["rotated_from_id"]
            isOneToOne: false
            referencedRelation: "teacher_join_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_join_links_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_join_requests: {
        Row: {
          created_at: string
          id: string
          join_link_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          join_link_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          join_link_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_join_requests_join_link_id_fkey"
            columns: ["join_link_id"]
            isOneToOne: false
            referencedRelation: "teacher_join_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_join_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_join_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_join_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_students: {
        Row: {
          created_at: string
          id: string
          source_invite_id: string | null
          status: string
          student_id: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_invite_id?: string | null
          status?: string
          student_id: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          source_invite_id?: string | null
          status?: string
          student_id?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_students_source_invite_id_fkey"
            columns: ["source_invite_id"]
            isOneToOne: false
            referencedRelation: "enrollment_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_students_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
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
          is_active: boolean
          profile_id: string
          rating: number | null
          subjects: Database["public"]["Enums"]["subject_type"][]
        }
        Insert: {
          bio?: string | null
          created_at?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          profile_id: string
          rating?: number | null
          subjects?: Database["public"]["Enums"]["subject_type"][]
        }
        Update: {
          bio?: string | null
          created_at?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
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
      telegram_connections: {
        Row: {
          connected_at: string
          created_at: string
          disconnect_reason: string | null
          disconnected_at: string | null
          id: string
          is_enabled: boolean
          profile_id: string
          telegram_chat_id: number
          telegram_username: string | null
          updated_at: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          disconnect_reason?: string | null
          disconnected_at?: string | null
          id?: string
          is_enabled?: boolean
          profile_id: string
          telegram_chat_id: number
          telegram_username?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          disconnect_reason?: string | null
          disconnected_at?: string | null
          id?: string
          is_enabled?: boolean
          profile_id?: string
          telegram_chat_id?: number
          telegram_username?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          profile_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          profile_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          profile_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      template_sync_issues: {
        Row: {
          copy_topic_id: string
          created_at: string
          detail: string | null
          id: string
          kind: string
          template_topic_id: string | null
        }
        Insert: {
          copy_topic_id: string
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          template_topic_id?: string | null
        }
        Update: {
          copy_topic_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          template_topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_sync_issues_copy_topic_id_fkey"
            columns: ["copy_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_sync_issues_template_topic_id_fkey"
            columns: ["template_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      test_variant_answer_attachments: {
        Row: {
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          student_assignment_id: string
          uploaded_at: string
          variant_item_id: string
        }
        Insert: {
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          student_assignment_id: string
          uploaded_at?: string
          variant_item_id: string
        }
        Update: {
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          student_assignment_id?: string
          uploaded_at?: string
          variant_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_variant_answer_attachments_student_assignment_id_fkey"
            columns: ["student_assignment_id"]
            isOneToOne: false
            referencedRelation: "test_variant_student_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_answer_attachments_variant_item_id_fkey"
            columns: ["variant_item_id"]
            isOneToOne: false
            referencedRelation: "test_variant_items"
            referencedColumns: ["id"]
          },
        ]
      }
      test_variant_answers: {
        Row: {
          answer_normalized: string
          answer_raw: string
          attempts_count: number
          closed_by: string | null
          created_at: string
          first_answered_at: string
          graded_at: string | null
          graded_by: string | null
          grading_status: string
          has_attachment: boolean
          id: string
          is_correct: boolean | null
          last_changed_at: string
          manual_points: number | null
          points_earned: number | null
          points_max: number
          solution_shown_at: string | null
          student_assignment_id: string
          submitted_at: string | null
          teacher_comment: string | null
          variant_item_id: string
        }
        Insert: {
          answer_normalized?: string
          answer_raw?: string
          attempts_count?: number
          closed_by?: string | null
          created_at?: string
          first_answered_at?: string
          graded_at?: string | null
          graded_by?: string | null
          grading_status?: string
          has_attachment?: boolean
          id?: string
          is_correct?: boolean | null
          last_changed_at?: string
          manual_points?: number | null
          points_earned?: number | null
          points_max?: number
          solution_shown_at?: string | null
          student_assignment_id: string
          submitted_at?: string | null
          teacher_comment?: string | null
          variant_item_id: string
        }
        Update: {
          answer_normalized?: string
          answer_raw?: string
          attempts_count?: number
          closed_by?: string | null
          created_at?: string
          first_answered_at?: string
          graded_at?: string | null
          graded_by?: string | null
          grading_status?: string
          has_attachment?: boolean
          id?: string
          is_correct?: boolean | null
          last_changed_at?: string
          manual_points?: number | null
          points_earned?: number | null
          points_max?: number
          solution_shown_at?: string | null
          student_assignment_id?: string
          submitted_at?: string | null
          teacher_comment?: string | null
          variant_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tva_student_assignment_fk"
            columns: ["student_assignment_id"]
            isOneToOne: false
            referencedRelation: "test_variant_student_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tva_variant_item_fk"
            columns: ["variant_item_id"]
            isOneToOne: false
            referencedRelation: "test_variant_items"
            referencedColumns: ["id"]
          },
        ]
      }
      test_variant_assignments: {
        Row: {
          allow_retry: boolean
          assigned_by: string
          available_from: string | null
          created_at: string
          due_at: string | null
          group_id: string | null
          id: string
          max_attempts: number
          show_answers_after_submit: boolean
          show_solutions_after_submit: boolean
          status: string
          student_id: string | null
          topic_id: string | null
          updated_at: string
          variant_id: string
        }
        Insert: {
          allow_retry?: boolean
          assigned_by: string
          available_from?: string | null
          created_at?: string
          due_at?: string | null
          group_id?: string | null
          id?: string
          max_attempts?: number
          show_answers_after_submit?: boolean
          show_solutions_after_submit?: boolean
          status?: string
          student_id?: string | null
          topic_id?: string | null
          updated_at?: string
          variant_id: string
        }
        Update: {
          allow_retry?: boolean
          assigned_by?: string
          available_from?: string | null
          created_at?: string
          due_at?: string | null
          group_id?: string | null
          id?: string
          max_attempts?: number
          show_answers_after_submit?: boolean
          show_solutions_after_submit?: boolean
          status?: string
          student_id?: string | null
          topic_id?: string | null
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_variant_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_assignments_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_assignments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "test_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      test_variant_items: {
        Row: {
          created_at: string
          grading_type: string
          id: string
          points: number
          position: number
          section_id: string | null
          task_id: string
          topic_id: string | null
          variant_id: string
        }
        Insert: {
          created_at?: string
          grading_type?: string
          id?: string
          points?: number
          position: number
          section_id?: string | null
          task_id: string
          topic_id?: string | null
          variant_id: string
        }
        Update: {
          created_at?: string
          grading_type?: string
          id?: string
          points?: number
          position?: number
          section_id?: string | null
          task_id?: string
          topic_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_variant_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "catalog_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_items_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "catalog_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "test_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      test_variant_student_assignments: {
        Row: {
          answered_count: number | null
          assignment_id: string
          attempts_used: number
          auto_score: number | null
          available_from: string | null
          completed_at: string | null
          correct_count: number | null
          created_at: string
          due_at: string | null
          grading_status: string
          id: string
          manual_review_count: number
          max_attempts: number
          max_score: number | null
          percentage: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          started_at: string | null
          status: string
          student_id: string
          submitted_at: string | null
          updated_at: string
          variant_id: string
        }
        Insert: {
          answered_count?: number | null
          assignment_id: string
          attempts_used?: number
          auto_score?: number | null
          available_from?: string | null
          completed_at?: string | null
          correct_count?: number | null
          created_at?: string
          due_at?: string | null
          grading_status?: string
          id?: string
          manual_review_count?: number
          max_attempts?: number
          max_score?: number | null
          percentage?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          started_at?: string | null
          status?: string
          student_id: string
          submitted_at?: string | null
          updated_at?: string
          variant_id: string
        }
        Update: {
          answered_count?: number | null
          assignment_id?: string
          attempts_used?: number
          auto_score?: number | null
          available_from?: string | null
          completed_at?: string | null
          correct_count?: number | null
          created_at?: string
          due_at?: string | null
          grading_status?: string
          id?: string
          manual_review_count?: number
          max_attempts?: number
          max_score?: number | null
          percentage?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          started_at?: string | null
          status?: string
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_variant_student_assignments_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "test_variant_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_student_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variant_student_assignments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "test_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      test_variants: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          exam_type: string
          id: string
          settings: Json
          source_type: string
          status: string
          subject: string
          tasks_count: number
          title: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          exam_type: string
          id?: string
          settings?: Json
          source_type?: string
          status?: string
          subject: string
          tasks_count?: number
          title: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          exam_type?: string
          id?: string
          settings?: Json
          source_type?: string
          status?: string
          subject?: string
          tasks_count?: number
          title?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_variants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_variants_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_autocheck_answers: {
        Row: {
          answer_raw: string
          attempt_no: number
          created_at: string
          id: string
          is_correct: boolean
          profile_id: string
          task_id: string
        }
        Insert: {
          answer_raw: string
          attempt_no: number
          created_at?: string
          id?: string
          is_correct: boolean
          profile_id: string
          task_id: string
        }
        Update: {
          answer_raw?: string
          attempt_no?: number
          created_at?: string
          id?: string
          is_correct?: boolean
          profile_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_autocheck_answers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_autocheck_answers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "topic_autocheck_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_autocheck_tasks: {
        Row: {
          answer_text: string | null
          answer_tol: number
          answer_type: string
          answer_value: number | null
          code: string
          created_at: string
          digits_any_order: boolean
          id: string
          position: number
          solution_md: string | null
          solution_path: string | null
          source_task_id: string | null
          statement_md: string | null
          statement_path: string
          topic_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          answer_text?: string | null
          answer_tol?: number
          answer_type: string
          answer_value?: number | null
          code: string
          created_at?: string
          digits_any_order?: boolean
          id?: string
          position?: number
          solution_md?: string | null
          solution_path?: string | null
          source_task_id?: string | null
          statement_md?: string | null
          statement_path: string
          topic_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          answer_text?: string | null
          answer_tol?: number
          answer_type?: string
          answer_value?: number | null
          code?: string
          created_at?: string
          digits_any_order?: boolean
          id?: string
          position?: number
          solution_md?: string | null
          solution_path?: string | null
          source_task_id?: string | null
          statement_md?: string | null
          statement_path?: string
          topic_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_autocheck_tasks_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "topic_autocheck_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_autocheck_tasks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_catalog_topics: {
        Row: {
          catalog_topic_id: string
          created_at: string
          created_by: string | null
          id: string
          source: string | null
          topic_id: string
        }
        Insert: {
          catalog_topic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          source?: string | null
          topic_id: string
        }
        Update: {
          catalog_topic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          source?: string | null
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_catalog_topics_catalog_topic_id_fkey"
            columns: ["catalog_topic_id"]
            isOneToOne: false
            referencedRelation: "catalog_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_catalog_topics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_catalog_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework: {
        Row: {
          autocheck: boolean
          closes_at: string | null
          created_at: string
          created_by: string
          due_at: string | null
          grade_scale: string
          id: string
          instructions: string | null
          is_published: boolean
          opens_at: string | null
          published_at: string | null
          published_via: string | null
          source_homework_id: string | null
          title: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          autocheck?: boolean
          closes_at?: string | null
          created_at?: string
          created_by: string
          due_at?: string | null
          grade_scale: string
          id?: string
          instructions?: string | null
          is_published?: boolean
          opens_at?: string | null
          published_at?: string | null
          published_via?: string | null
          source_homework_id?: string | null
          title: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          autocheck?: boolean
          closes_at?: string | null
          created_at?: string
          created_by?: string
          due_at?: string | null
          grade_scale?: string
          id?: string
          instructions?: string | null
          is_published?: boolean
          opens_at?: string | null
          published_at?: string | null
          published_via?: string | null
          source_homework_id?: string | null
          title?: string
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_source_homework_id_fkey"
            columns: ["source_homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: true
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_ai_findings: {
        Row: {
          category: string
          file_id: string
          id: string
          job_id: string
          page: number
          position: number
          rect_h: number
          rect_w: number
          rect_x: number
          rect_y: number
          task: string | null
          text: string
        }
        Insert: {
          category: string
          file_id: string
          id?: string
          job_id: string
          page?: number
          position?: number
          rect_h: number
          rect_w: number
          rect_x: number
          rect_y: number
          task?: string | null
          text: string
        }
        Update: {
          category?: string
          file_id?: string
          id?: string
          job_id?: string
          page?: number
          position?: number
          rect_h?: number
          rect_w?: number
          rect_x?: number
          rect_y?: number
          task?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_ai_findings_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempt_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_ai_findings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_ai_jobs: {
        Row: {
          accepted_at: string | null
          attempt_id: string
          attempts: number
          completed_at: string | null
          confidence: string | null
          created_at: string
          dropped_findings: number | null
          grade_table: Json | null
          grading: string | null
          id: string
          input_tokens: number | null
          last_error: string | null
          model: string | null
          output_tokens: number | null
          points_max: number | null
          points_total: number | null
          provider: string | null
          readable: boolean | null
          reference_chars: number | null
          reference_state: string | null
          requested_by: string | null
          started_at: string | null
          status: string
          suggested_score: number | null
          summary: string | null
          tasks: Json | null
          worksheet_chars: number | null
          worksheet_state: string | null
        }
        Insert: {
          accepted_at?: string | null
          attempt_id: string
          attempts?: number
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          dropped_findings?: number | null
          grade_table?: Json | null
          grading?: string | null
          id?: string
          input_tokens?: number | null
          last_error?: string | null
          model?: string | null
          output_tokens?: number | null
          points_max?: number | null
          points_total?: number | null
          provider?: string | null
          readable?: boolean | null
          reference_chars?: number | null
          reference_state?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          suggested_score?: number | null
          summary?: string | null
          tasks?: Json | null
          worksheet_chars?: number | null
          worksheet_state?: string | null
        }
        Update: {
          accepted_at?: string | null
          attempt_id?: string
          attempts?: number
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          dropped_findings?: number | null
          grade_table?: Json | null
          grading?: string | null
          id?: string
          input_tokens?: number | null
          last_error?: string | null
          model?: string | null
          output_tokens?: number | null
          points_max?: number | null
          points_total?: number | null
          provider?: string | null
          readable?: boolean | null
          reference_chars?: number | null
          reference_state?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          suggested_score?: number | null
          summary?: string | null
          tasks?: Json | null
          worksheet_chars?: number | null
          worksheet_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_ai_jobs_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_ai_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_attempt_files: {
        Row: {
          attempt_id: string
          created_at: string
          file_name: string
          height: number | null
          id: string
          metadata: Json
          mime_type: string | null
          page_number: number | null
          position: number
          rotation: number | null
          sha256: string | null
          size_bytes: number | null
          storage_path: string
          width: number | null
        }
        Insert: {
          attempt_id: string
          created_at?: string
          file_name: string
          height?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          page_number?: number | null
          position?: number
          rotation?: number | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path: string
          width?: number | null
        }
        Update: {
          attempt_id?: string
          created_at?: string
          file_name?: string
          height?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          page_number?: number | null
          position?: number
          rotation?: number | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_attempt_files_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_attempts: {
        Row: {
          attempt_number: number
          auto_submitted: boolean
          created_at: string
          homework_id: string
          id: string
          status: Database["public"]["Enums"]["topic_homework_attempt_status"]
          student_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          attempt_number: number
          auto_submitted?: boolean
          created_at?: string
          homework_id: string
          id?: string
          status?: Database["public"]["Enums"]["topic_homework_attempt_status"]
          student_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt_number?: number
          auto_submitted?: boolean
          created_at?: string
          homework_id?: string
          id?: string
          status?: Database["public"]["Enums"]["topic_homework_attempt_status"]
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_attempts_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_digest: {
        Row: {
          drop_reason: string | null
          dropped_at: string | null
          homework_id: string
          profile_id: string
          queue_key: string | null
          queued_at: string
          sent_at: string | null
          student_id: string
        }
        Insert: {
          drop_reason?: string | null
          dropped_at?: string | null
          homework_id: string
          profile_id: string
          queue_key?: string | null
          queued_at?: string
          sent_at?: string | null
          student_id: string
        }
        Update: {
          drop_reason?: string | null
          dropped_at?: string | null
          homework_id?: string
          profile_id?: string
          queue_key?: string | null
          queued_at?: string
          sent_at?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_digest_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_digest_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_digest_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_files: {
        Row: {
          created_at: string
          homework_id: string
          id: string
          mime_type: string | null
          original_filename: string
          position: number
          size_bytes: number | null
          source_file_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          homework_id: string
          id?: string
          mime_type?: string | null
          original_filename: string
          position?: number
          size_bytes?: number | null
          source_file_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          homework_id?: string
          id?: string
          mime_type?: string | null
          original_filename?: string
          position?: number
          size_bytes?: number | null
          source_file_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_files_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_files_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_files"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_personal_windows: {
        Row: {
          closes_at: string
          created_at: string
          created_by: string | null
          homework_id: string
          opens_at: string
          student_id: string
          updated_at: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          created_by?: string | null
          homework_id: string
          opens_at: string
          student_id: string
          updated_at?: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          created_by?: string | null
          homework_id?: string
          opens_at?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_personal_windows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_personal_windows_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_personal_windows_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_reminders: {
        Row: {
          homework_id: string
          id: string
          queue_key: string | null
          sent_at: string
          sent_by: string | null
          student_id: string
        }
        Insert: {
          homework_id: string
          id?: string
          queue_key?: string | null
          sent_at?: string
          sent_by?: string | null
          student_id: string
        }
        Update: {
          homework_id?: string
          id?: string
          queue_key?: string | null
          sent_at?: string
          sent_by?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_reminders_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_reminders_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_reminders_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_review_tasks: {
        Row: {
          attempt_id: string
          expected_answer: string | null
          id: string
          max_points: number | null
          no: string
          note: string | null
          points: number | null
          position: number
          student_answer: string | null
          updated_at: string
          updated_by: string | null
          verdict: string
        }
        Insert: {
          attempt_id: string
          expected_answer?: string | null
          id?: string
          max_points?: number | null
          no: string
          note?: string | null
          points?: number | null
          position?: number
          student_answer?: string | null
          updated_at?: string
          updated_by?: string | null
          verdict?: string
        }
        Update: {
          attempt_id?: string
          expected_answer?: string | null
          id?: string
          max_points?: number | null
          no?: string
          note?: string | null
          points?: number | null
          position?: number
          student_answer?: string | null
          updated_at?: string
          updated_by?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_review_tasks_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_review_tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_homework_reviews: {
        Row: {
          attempt_id: string
          comment: string | null
          created_at: string
          decision: Database["public"]["Enums"]["topic_homework_review_decision"]
          id: string
          reviewer_id: string
          score: number | null
        }
        Insert: {
          attempt_id: string
          comment?: string | null
          created_at?: string
          decision: Database["public"]["Enums"]["topic_homework_review_decision"]
          id?: string
          reviewer_id: string
          score?: number | null
        }
        Update: {
          attempt_id?: string
          comment?: string | null
          created_at?: string
          decision?: Database["public"]["Enums"]["topic_homework_review_decision"]
          id?: string
          reviewer_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_homework_reviews_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_homework_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_homework_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_material_items: {
        Row: {
          content: string | null
          created_at: string
          created_by: string
          file_name: string | null
          id: string
          is_visible: boolean
          kind: Database["public"]["Enums"]["course_material_kind"]
          lesson_id: string | null
          mime_type: string | null
          position: number
          section: string | null
          size_bytes: number | null
          source_item_id: string | null
          source_topic_material_id: string | null
          storage_path: string | null
          subtopic_code: string | null
          subtopic_title: string | null
          title: string | null
          topic_id: string
          track: string
          updated_at: string
          url: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by: string
          file_name?: string | null
          id?: string
          is_visible?: boolean
          kind: Database["public"]["Enums"]["course_material_kind"]
          lesson_id?: string | null
          mime_type?: string | null
          position?: number
          section?: string | null
          size_bytes?: number | null
          source_item_id?: string | null
          source_topic_material_id?: string | null
          storage_path?: string | null
          subtopic_code?: string | null
          subtopic_title?: string | null
          title?: string | null
          topic_id: string
          track?: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string
          file_name?: string | null
          id?: string
          is_visible?: boolean
          kind?: Database["public"]["Enums"]["course_material_kind"]
          lesson_id?: string | null
          mime_type?: string | null
          position?: number
          section?: string | null
          size_bytes?: number | null
          source_item_id?: string | null
          source_topic_material_id?: string | null
          storage_path?: string | null
          subtopic_code?: string | null
          subtopic_title?: string | null
          title?: string | null
          topic_id?: string
          track?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_lesson_materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lesson_materials_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_material_items_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "topic_material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_material_items_source_topic_material_id_fkey"
            columns: ["source_topic_material_id"]
            isOneToOne: false
            referencedRelation: "topic_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_material_items_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_material_text_cache: {
        Row: {
          chars: number
          created_at: string
          engine: string
          material_id: string
          size_bytes: number | null
          storage_path: string
          text: string
        }
        Insert: {
          chars: number
          created_at?: string
          engine: string
          material_id: string
          size_bytes?: number | null
          storage_path: string
          text: string
        }
        Update: {
          chars?: number
          created_at?: string
          engine?: string
          material_id?: string
          size_bytes?: number | null
          storage_path?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_material_text_cache_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "topic_material_items"
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
          source_template_material_id: string | null
          topic_id: string
          type: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          file_url?: string | null
          id?: string
          link_url?: string | null
          source_template_material_id?: string | null
          topic_id: string
          type: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          file_url?: string | null
          id?: string
          link_url?: string | null
          source_template_material_id?: string | null
          topic_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_materials_source_template_material_id_fkey"
            columns: ["source_template_material_id"]
            isOneToOne: false
            referencedRelation: "lesson_template_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_materials_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_ratings: {
        Row: {
          created_at: string
          id: string
          rating: number
          student_id: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: number
          student_id: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: number
          student_id?: string
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_ratings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_ratings_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_section_marks: {
        Row: {
          group_key: string
          marked_at: string
          student_id: string
          topic_id: string
        }
        Insert: {
          group_key: string
          marked_at?: string
          student_id: string
          topic_id: string
        }
        Update: {
          group_key?: string
          marked_at?: string
          student_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_section_marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_section_marks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_subtopic_hidden: {
        Row: {
          created_at: string
          hidden_by: string | null
          subtopic_code: string
          topic_id: string
        }
        Insert: {
          created_at?: string
          hidden_by?: string | null
          subtopic_code: string
          topic_id: string
        }
        Update: {
          created_at?: string
          hidden_by?: string | null
          subtopic_code?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_subtopic_hidden_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_subtopic_hidden_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_test_answers: {
        Row: {
          answer_text: string
          attempt_id: string
          awarded_points: number | null
          id: string
          is_correct: boolean | null
          item_id: string
          updated_at: string
        }
        Insert: {
          answer_text?: string
          attempt_id: string
          awarded_points?: number | null
          id?: string
          is_correct?: boolean | null
          item_id: string
          updated_at?: string
        }
        Update: {
          answer_text?: string
          attempt_id?: string
          awarded_points?: number | null
          id?: string
          is_correct?: boolean | null
          item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_test_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "topic_test_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_test_answers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "topic_test_items"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_test_assignments: {
        Row: {
          assigned_by: string
          created_at: string
          id: string
          test_id: string
          topic_id: string
        }
        Insert: {
          assigned_by: string
          created_at?: string
          id?: string
          test_id: string
          topic_id: string
        }
        Update: {
          assigned_by?: string
          created_at?: string
          id?: string
          test_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_test_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_test_assignments_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "topic_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_test_assignments_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: true
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_test_attempts: {
        Row: {
          assignment_id: string
          completed_at: string | null
          id: string
          max_points: number | null
          started_at: string
          status: Database["public"]["Enums"]["topic_test_attempt_status"]
          student_id: string
          test_id: string
          total_points: number | null
        }
        Insert: {
          assignment_id: string
          completed_at?: string | null
          id?: string
          max_points?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["topic_test_attempt_status"]
          student_id: string
          test_id: string
          total_points?: number | null
        }
        Update: {
          assignment_id?: string
          completed_at?: string | null
          id?: string
          max_points?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["topic_test_attempt_status"]
          student_id?: string
          test_id?: string
          total_points?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_test_attempts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "topic_test_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_test_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_test_attempts_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "topic_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_test_items: {
        Row: {
          answer_html: string
          answer_text: string
          assets: Json
          created_at: string
          exam_part: number | null
          id: string
          max_points: number
          partial_type: string | null
          position: number
          solution_html: string | null
          statement_html: string
          task_id: string | null
          test_id: string
        }
        Insert: {
          answer_html: string
          answer_text: string
          assets?: Json
          created_at?: string
          exam_part?: number | null
          id?: string
          max_points: number
          partial_type?: string | null
          position?: number
          solution_html?: string | null
          statement_html: string
          task_id?: string | null
          test_id: string
        }
        Update: {
          answer_html?: string
          answer_text?: string
          assets?: Json
          created_at?: string
          exam_part?: number | null
          id?: string
          max_points?: number
          partial_type?: string | null
          position?: number
          solution_html?: string | null
          statement_html?: string
          task_id?: string | null
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_test_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "catalog_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_test_items_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "topic_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_tests: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_published: boolean
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_published?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_published?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_tests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_unlock_events: {
        Row: {
          notified_at: string | null
          opened_at: string
          reason: string
          student_id: string
          topic_id: string
        }
        Insert: {
          notified_at?: string | null
          opened_at?: string
          reason: string
          student_id: string
          topic_id: string
        }
        Update: {
          notified_at?: string | null
          opened_at?: string
          reason?: string
          student_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_unlock_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_unlock_events_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          autocheck_solutions_after_finish: boolean
          available_from: string | null
          created_at: string
          ege_task_numbers: number[]
          id: string
          is_open: boolean | null
          kind: string
          lesson_format: string | null
          max_score: number
          module_id: string
          order_index: number
          source_template_id: string | null
          source_topic_id: string | null
          title: string
        }
        Insert: {
          autocheck_solutions_after_finish?: boolean
          available_from?: string | null
          created_at?: string
          ege_task_numbers?: number[]
          id?: string
          is_open?: boolean | null
          kind?: string
          lesson_format?: string | null
          max_score?: number
          module_id: string
          order_index?: number
          source_template_id?: string | null
          source_topic_id?: string | null
          title: string
        }
        Update: {
          autocheck_solutions_after_finish?: boolean
          available_from?: string | null
          created_at?: string
          ege_task_numbers?: number[]
          id?: string
          is_open?: boolean | null
          kind?: string
          lesson_format?: string | null
          max_score?: number
          module_id?: string
          order_index?: number
          source_template_id?: string | null
          source_topic_id?: string | null
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
          {
            foreignKeyName: "topics_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "lesson_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_source_topic_id_fkey"
            columns: ["source_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
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
      vercel_analytics_cache: {
        Row: {
          fetched_at: string
          id: number
          payload: Json
        }
        Insert: {
          fetched_at?: string
          id?: number
          payload: Json
        }
        Update: {
          fetched_at?: string
          id?: number
          payload?: Json
        }
        Relationships: []
      }
      video_watch_daily: {
        Row: {
          day: string
          duration_seconds: number | null
          item_id: string
          max_position: number
          seconds: number
          student_id: string
          updated_at: string
        }
        Insert: {
          day: string
          duration_seconds?: number | null
          item_id: string
          max_position?: number
          seconds?: number
          student_id: string
          updated_at?: string
        }
        Update: {
          day?: string
          duration_seconds?: number | null
          item_id?: string
          max_position?: number
          seconds?: number
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_watch_daily_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "topic_material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_watch_daily_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      work_activity: {
        Row: {
          away_count: number
          away_seconds: number
          created_at: string
          homework_id: string | null
          id: string
          last_away_at: string | null
          mock_exam_id: string | null
          opened_at: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          away_count?: number
          away_seconds?: number
          created_at?: string
          homework_id?: string | null
          id?: string
          last_away_at?: string | null
          mock_exam_id?: string | null
          opened_at?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          away_count?: number
          away_seconds?: number
          created_at?: string
          homework_id?: string | null
          id?: string
          last_away_at?: string | null
          mock_exam_id?: string | null
          opened_at?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_activity_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "topic_homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_activity_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_activity_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
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
      _accept_invite_core: {
        Args: { p_invite_id: string }
        Returns: {
          group_id: string
          invite_id: string
          student_id: string
        }[]
      }
      _course_student_ids: { Args: { p_course_id: string }; Returns: string[] }
      _current_teacher_id: { Args: never; Returns: string }
      _diag_advance: {
        Args: {
          p_block: number
          p_session: string
          p_step: number
          p_verdict: string
        }
        Returns: boolean
      }
      _diag_apply_opens: { Args: { p_student_id: string }; Returns: number }
      _diag_payload: { Args: { p_session: string }; Returns: Json }
      _diag_pick: {
        Args: {
          p_block: number
          p_prev: string
          p_session: string
          p_step: number
        }
        Returns: {
          level: string
          n: number
          task_id: string
        }[]
      }
      _diag_result: {
        Args: { p_profile_id: string; p_subject: string }
        Returns: Json
      }
      _diag_staff_of: { Args: { p_student_id: string }; Returns: boolean }
      _direction_label: {
        Args: {
          p_exam: Database["public"]["Enums"]["exam_type"]
          p_subject: Database["public"]["Enums"]["subject_type"]
        }
        Returns: string
      }
      _dispatch_admin_payment_notifications: { Args: never; Returns: number }
      _enforce_homework_rate_limit: {
        Args: {
          p_action: string
          p_actor: string
          p_max_per_hour: number
          p_max_per_minute: number
        }
        Returns: undefined
      }
      _gen_invite_token: {
        Args: never
        Returns: {
          raw_token: string
          token_hash: string
        }[]
      }
      _gen_short_code: {
        Args: never
        Returns: {
          code_hash: string
          raw_code: string
        }[]
      }
      _homework_v2_base: {
        Args: {
          p_assignment_id: string
          p_group_id: string
          p_student_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["homework_v2_row"][]
        SetofOptions: {
          from: "*"
          to: "homework_v2_row"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _profile_is_school_student: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      _progress_state: {
        Args: { p_course_id: string; p_student_ids: string[] }
        Returns: {
          autocheck_left: number
          autocheck_total: number
          closed: boolean
          closed_at: string
          hw_state: string
          module_id: string
          open: boolean
          open_reason: string
          override_state: string
          percent: number
          rn: number
          student_id: string
          topic_id: string
        }[]
      }
      _promo_active_for: {
        Args: { p_subscription_id: string; p_tariff_id: string }
        Returns: {
          applied_at: string | null
          code_id: string
          created_at: string
          id: string
          kind: string
          payments_left: number
          payments_total: number
          percent: number | null
          profile_id: string
          saved_rub: number
          status: string
          student_id: string
          subscription_id: string | null
          tariff_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "subscription_promo_redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _promo_normalize: { Args: { p_code: string }; Returns: string }
      _promo_payment_released: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      _promo_payment_succeeded: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      _promo_price: {
        Args: { p_percent: number; p_price: number }
        Returns: number
      }
      _promo_random_code: { Args: { p_prefix: string }; Returns: string }
      _promo_rate_limited: { Args: { p_profile_id: string }; Returns: boolean }
      _promo_reject: {
        Args: {
          p_code: string
          p_profile_id: string
          p_reason: string
          p_stage: string
          p_tariff_id: string
        }
        Returns: Json
      }
      _promo_sweep_stale: { Args: never; Returns: number }
      _promo_unfit_reason: {
        Args: {
          p_code: Database["public"]["Tables"]["subscription_promo_codes"]["Row"]
          p_student_id: string
          p_tariff: Database["public"]["Tables"]["subscription_tariffs"]["Row"]
        }
        Returns: string
      }
      _prune_homework_action_log: { Args: never; Returns: undefined }
      _random_base32: { Args: { n: number }; Returns: string }
      _review_queue_base: {
        Args: {
          p_course_id: string
          p_due_after: string
          p_due_before: string
          p_group_id: string
          p_source_type: string
          p_status: string[]
          p_student_id: string
        }
        Returns: {
          assignment_id: string
          course_id: string
          course_title: string
          due_at: string
          group_ids: string[]
          group_titles: string[]
          has_files: boolean
          is_overdue: boolean
          lesson_id: string
          reviewed_at: string
          score: number
          source: string
          status: string
          student_id: string
          student_name: string
          submission_id: string
          submitted_at: string
          title: string
          topic_id: string
          topic_title: string
        }[]
      }
      _subscription_enroll: {
        Args: { p_subscription_id: string }
        Returns: boolean
      }
      _subscription_mail_enqueue: {
        Args: { p_dedup: string; p_kind: string; p_subscription_id: string }
        Returns: undefined
      }
      _subscription_notify: {
        Args: {
          p_dedup: string
          p_message: string
          p_subscription_id: string
          p_title: string
        }
        Returns: undefined
      }
      _subscription_promo_grant: {
        Args: {
          p_interval: string
          p_redemption_id: string
          p_saved: number
          p_status: string
          p_sub_id: string
        }
        Returns: Json
      }
      _subscription_renewal_failed: {
        Args: { p_reason: string; p_subscription_id: string }
        Returns: string
      }
      _subscription_students_row: {
        Args: { p_profile_id: string }
        Returns: string
      }
      _topic_autocheck_ensure_homework: {
        Args: { p_topic_id: string }
        Returns: string
      }
      _topic_autocheck_finish: {
        Args: { p_profile_id: string; p_topic_id: string }
        Returns: number
      }
      _topic_autocheck_regrade: {
        Args: { p_topic_id: string }
        Returns: number
      }
      _topic_autocheck_student_of: {
        Args: { p_profile_id: string; p_topic_id: string }
        Returns: string
      }
      _topic_homework_autopublish: {
        Args: { p_homework_ids: string[]; p_via: string }
        Returns: number
      }
      _topic_homework_course_staff: {
        Args: { p_course_id: string }
        Returns: {
          profile_id: string
        }[]
      }
      _topic_homework_digest_enqueue: {
        Args: { p_at: string; p_homework_ids: string[] }
        Returns: number
      }
      _topic_homework_ru_day: {
        Args: { p_day: string; p_now: string }
        Returns: string
      }
      _topic_unlock_events_for: {
        Args: { p_student_id: string; p_topic_id: string }
        Returns: undefined
      }
      accept_student_invite: {
        Args: { p_token: string }
        Returns: {
          group_id: string
          invite_id: string
          student_id: string
        }[]
      }
      accept_student_invite_by_code: {
        Args: { p_short_code: string }
        Returns: {
          group_id: string
          invite_id: string
          student_id: string
        }[]
      }
      achievement_rules: {
        Args: never
        Returns: {
          category: string
          key: string
          ord: number
          points: number
          threshold: number
          tier: number
        }[]
      }
      add_mock_exam_photo: {
        Args: {
          p_file_name: string
          p_mime_type: string
          p_mock_exam_id: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: Json
      }
      admin_course_unlock_mode_set: {
        Args: { p_course_id: string; p_mode: string }
        Returns: string
      }
      admin_diagnostic_set_load: {
        Args: {
          p_activate?: boolean
          p_numbers: Json
          p_subject: string
          p_version: string
        }
        Returns: Json
      }
      admin_finance_snapshot: { Args: { p_month: string }; Returns: Json }
      admin_live_feed: {
        Args: { p_limit?: number }
        Returns: {
          actor_name: string
          at: string
          detail: string
          kind: string
        }[]
      }
      admin_live_pulse: { Args: never; Returns: Json }
      admin_perf_hourly: {
        Args: { p_from: string; p_kind: string; p_label: string; p_to: string }
        Returns: Json
      }
      admin_perf_people: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_perf_recent: {
        Args: { p_limit?: number; p_profile_id: string }
        Returns: Json
      }
      admin_perf_summary: {
        Args: {
          p_from: string
          p_kind: string
          p_profile_id?: string
          p_to: string
        }
        Returns: Json
      }
      admin_promo_codes: { Args: never; Returns: Json }
      admin_promo_create: { Args: { p: Json }; Returns: Json }
      admin_promo_redemptions: { Args: { p_code_id?: string }; Returns: Json }
      admin_promo_set_active: {
        Args: { p_id: string; p_on: boolean }
        Returns: undefined
      }
      admin_school_stats: { Args: never; Returns: Json }
      admin_subscription_cancel: {
        Args: { p_reason: string; p_subscription_id: string }
        Returns: Json
      }
      admin_subscription_extend: {
        Args: { p_days: number; p_reason: string; p_subscription_id: string }
        Returns: Json
      }
      admin_subscription_grant: {
        Args: {
          p_days: number
          p_reason: string
          p_student_id: string
          p_tariff_id: string
        }
        Returns: Json
      }
      admin_subscriptions: { Args: { p_status?: string }; Returns: Json }
      ai_benchmark_candidates: {
        Args: never
        Returns: {
          attempt_id: string
          files: number
          grade_scale: string
          homework_id: string
          homework_title: string
          review_tasks: number
          review_tasks_checked: number
          status: string
          submitted_at: string
          teacher_score: number
        }[]
      }
      ai_benchmark_five: {
        Args: { p_scale: string; p_score: number }
        Returns: number
      }
      ai_benchmark_report: {
        Args: { p_run_id: string }
        Returns: {
          avg_cost_usd: number
          avg_input_tokens: number
          avg_latency_ms: number
          avg_output_tokens: number
          grade_match_pct: number
          grade_matched: number
          grade_off_2plus: number
          grade_pairs: number
          model: string
          task_ai_unchecked: number
          task_dangerous: number
          task_match_pct: number
          task_match_seeded_pct: number
          task_matched: number
          task_matched_seeded: number
          task_pairs: number
          task_stricter: number
          teacher_tasks_missed: number
          total_cost_usd: number
          works: number
          works_all_matched: number
          works_all_matched_pct: number
          works_compared: number
          works_error: number
          works_no_dangerous: number
          works_no_dangerous_pct: number
          works_ok: number
          works_unreadable: number
        }[]
      }
      ai_benchmark_task_key: { Args: { p_no: string }; Returns: string }
      ai_check_accuracy: {
        Args: { p_since?: string }
        Returns: {
          ai_verdict: string
          answer_match: boolean
          changed: number
          tasks: number
          works: number
        }[]
      }
      ai_check_normalize_answer: { Args: { p_raw: string }; Returns: string }
      ai_physics_topics_list: {
        Args: { p_limit?: number; p_search?: string }
        Returns: {
          available: number
          catalog_topic_id: string
          title: string
        }[]
      }
      answer_topic_task: {
        Args: { p_answer_raw: string; p_item_id: string; p_topic_id: string }
        Returns: Json
      }
      app_flag: { Args: { p_key: string }; Returns: boolean }
      app_server_now: { Args: never; Returns: string }
      assign_homework: {
        Args: {
          p_allow_late: boolean
          p_due_at: string
          p_group_id: string
          p_max_attempts: number
          p_publish_at: string
          p_publish_now: boolean
          p_request_id?: string
          p_student_ids: string[]
          p_template_version_id: string
        }
        Returns: Json
      }
      assign_lesson_homework: {
        Args: {
          p_collection_id: string
          p_confirm_dup?: boolean
          p_due_date?: string
          p_lesson_id: string
        }
        Returns: {
          collection_id: string
          created_at: string
          due_date: string | null
          group_id: string | null
          id: string
          lesson_id: string | null
          status: string
          student_id: string | null
          teacher_id: string
        }
        SetofOptions: {
          from: "*"
          to: "assigned_collections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_test_variant: {
        Args: {
          p_allow_retry?: boolean
          p_available_from?: string
          p_due_at?: string
          p_group_ids?: string[]
          p_max_attempts?: number
          p_show_answers_after_submit?: boolean
          p_show_solutions_after_submit?: boolean
          p_student_ids?: string[]
          p_variant_id: string
        }
        Returns: Json
      }
      attach_catalog_tasks_to_topic: {
        Args: { p_task_ids: string[]; p_topic_id: string }
        Returns: Json
      }
      attach_variant_to_topic: {
        Args: {
          p_due_at?: string
          p_group_ids: string[]
          p_topic_id: string
          p_variant_id: string
        }
        Returns: number
      }
      auth_can_copy_to_group_course: {
        Args: { p_course_id?: string; p_group_id?: string }
        Returns: boolean
      }
      auth_can_edit_submission_files: {
        Args: { p_assigned_id: string; p_student_id: string }
        Returns: boolean
      }
      auth_can_manage_lesson_template: {
        Args: { p_template_id: string }
        Returns: boolean
      }
      auth_can_review_submission: {
        Args: { sub_homework_id: string; sub_student_id: string }
        Returns: boolean
      }
      auth_can_review_task_submission: {
        Args: { p_assigned_id: string }
        Returns: boolean
      }
      auth_can_see_topic: { Args: { p_topic_id: string }; Returns: boolean }
      auth_can_view_lesson: { Args: { p_lesson_id: string }; Returns: boolean }
      auth_can_view_lesson_material_object: {
        Args: { p_lesson_id: string; p_storage_path: string }
        Returns: boolean
      }
      auth_can_view_lesson_materials: {
        Args: { p_lesson_id: string }
        Returns: boolean
      }
      auth_can_view_student_number_stats: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      auth_current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      auth_is_assigned_student: {
        Args: { p_assigned_id: string }
        Returns: boolean
      }
      auth_is_assigner: { Args: { p_assignment_id: string }; Returns: boolean }
      auth_is_course_owner: { Args: { p_course_id: string }; Returns: boolean }
      auth_is_curator_of_group: { Args: { grp_id: string }; Returns: boolean }
      auth_is_curator_of_homework: { Args: { hw_id: string }; Returns: boolean }
      auth_is_group_staff_of_assignment: {
        Args: { p_assigned_id: string }
        Returns: boolean
      }
      auth_is_group_staff_of_collection: {
        Args: { p_collection_id: string }
        Returns: boolean
      }
      auth_is_my_group_curator: { Args: { cid: string }; Returns: boolean }
      auth_is_my_group_staff_profile: {
        Args: { pid: string }
        Returns: boolean
      }
      auth_is_my_group_teacher: { Args: { tid: string }; Returns: boolean }
      auth_is_recipient_of_assignment: {
        Args: { p_assignment_id: string }
        Returns: boolean
      }
      auth_is_staff_of_homework_course: {
        Args: { hw_id: string }
        Returns: boolean
      }
      auth_is_staff_of_lesson: { Args: { les_id: string }; Returns: boolean }
      auth_is_staff_of_profile: { Args: { pid: string }; Returns: boolean }
      auth_is_staff_of_student: { Args: { stu_id: string }; Returns: boolean }
      auth_is_staff_of_topic: { Args: { p_topic_id: string }; Returns: boolean }
      auth_is_student_in_group: { Args: { grp_id: string }; Returns: boolean }
      auth_is_student_of_submission: {
        Args: { stu_id: string }
        Returns: boolean
      }
      auth_is_student_of_topic: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      auth_is_teacher_of_group: { Args: { grp_id: string }; Returns: boolean }
      auth_is_teacher_of_homework: { Args: { hw_id: string }; Returns: boolean }
      auth_owns_assignment: {
        Args: { p_assigned_id: string }
        Returns: boolean
      }
      auth_owns_lesson: { Args: { p_lesson_id: string }; Returns: boolean }
      auth_student_can_read_collection: {
        Args: { p_collection_id: string }
        Returns: boolean
      }
      auth_student_can_see_homework: {
        Args: { hw_id: string }
        Returns: boolean
      }
      auth_student_id: { Args: never; Returns: string }
      auth_teacher_has_student: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      autocheck_answer_correct: {
        Args: {
          p_any_order: boolean
          p_raw: string
          p_text: string
          p_tol: number
          p_type: string
          p_value: number
        }
        Returns: boolean
      }
      autocheck_digits_of: { Args: { p_raw: string }; Returns: string }
      autocheck_number_of: { Args: { p_raw: string }; Returns: number }
      autocheck_sorted_chars: { Args: { p: string }; Returns: string }
      build_topic_tests_for_course: {
        Args: { p_count?: number; p_course_id: string; p_rebuild?: boolean }
        Returns: {
          built: number
          note: string
          status: string
          topic_id: string
          topic_title: string
        }[]
      }
      cancel_variant_assignment: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      catalog_access_ok: { Args: never; Returns: boolean }
      catalog_answer_reasons: {
        Args: { p_task_ids: string[]; p_uid: string }
        Returns: {
          reason: string
          task_id: string
        }[]
      }
      catalog_answer_spec_valid: { Args: { p: Json }; Returns: boolean }
      catalog_answer_spec_verdict: {
        Args: { p_raw: string; p_spec: Json }
        Returns: boolean
      }
      catalog_answer_text_key: { Args: { p_raw: string }; Returns: string }
      catalog_archived_task_ids: { Args: never; Returns: string[] }
      catalog_check_answer: {
        Args: { p_answer: string; p_task_id: string }
        Returns: Json
      }
      catalog_counted_solutions: {
        Args: { p_profile_id: string }
        Returns: {
          at: string
          attempt_id: string
          n: number
          section_id: string
          subject: string
          task_id: string
        }[]
      }
      catalog_my_overview: { Args: never; Returns: Json }
      catalog_practice_state: {
        Args: { p_section_id: string; p_task_ids?: string[] }
        Returns: Json
      }
      catalog_replace_task_v2: {
        Args: { p_content: Json; p_old_task_id: string }
        Returns: Json
      }
      catalog_reveal_answer: { Args: { p_task_id: string }; Returns: Json }
      catalog_reveal_answers: {
        Args: { p_task_ids: string[] }
        Returns: {
          allowed: boolean
          answer_html: string
          grade_criteria_html: string
          has_criteria: boolean
          has_plan: boolean
          reason: string
          solution_html: string
          solution_plan_html: string
          task_id: string
        }[]
      }
      catalog_reward_rules: { Args: never; Returns: Json }
      catalog_subject_key: {
        Args: { p_exam_type: string; p_subject: string }
        Returns: string
      }
      catalog_subscription_directions: { Args: never; Returns: string[] }
      catalog_task_answer_specs: {
        Args: { p_task_ids: string[] }
        Returns: {
          answer_spec: Json
          task_id: string
        }[]
      }
      catalog_task_checkable: {
        Args: {
          p_answer_html: string
          p_exam_part: number
          p_partial_type: string
        }
        Returns: boolean
      }
      catalog_task_text: { Args: { p_task_id: string }; Returns: Json }
      catalog_task_texts: {
        Args: { p_task_ids: string[] }
        Returns: {
          allowed: boolean
          answer_html: string
          grade_criteria_html: string
          has_criteria: boolean
          has_plan: boolean
          reason: string
          solution_html: string
          solution_plan_html: string
          task_id: string
        }[]
      }
      catalog_task_verdict: {
        Args: {
          p_answer_html: string
          p_answer_raw: string
          p_partial_type: string
        }
        Returns: boolean
      }
      catalog_tasks_attach_preview: {
        Args: { p_task_ids: string[] }
        Returns: Json
      }
      catalog_zone_milestone: {
        Args: { p_count: number; p_zone: string }
        Returns: number
      }
      catalog_zone_of: { Args: { p_share: number }; Returns: string }
      catalog_zone_points: { Args: { p_zone: string }; Returns: number }
      claim_admin_payment_notifications: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          id: string
          payment_id: string
          recipient_profile_id: string
        }[]
      }
      claim_forecast_achievement: {
        Args: {
          p_current_score: number
          p_first_score: number
          p_subject: string
        }
        Returns: Json
      }
      claim_notification_queue: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          channel: string
          created_at: string
          deduplication_key: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processing_at: string | null
          profile_id: string
          retry_count: number
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_queue_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_topic_homework_ai_jobs: {
        Args: { batch_size?: number }
        Returns: {
          accepted_at: string | null
          attempt_id: string
          attempts: number
          completed_at: string | null
          confidence: string | null
          created_at: string
          dropped_findings: number | null
          grade_table: Json | null
          grading: string | null
          id: string
          input_tokens: number | null
          last_error: string | null
          model: string | null
          output_tokens: number | null
          points_max: number | null
          points_total: number | null
          provider: string | null
          readable: boolean | null
          reference_chars: number | null
          reference_state: string | null
          requested_by: string | null
          started_at: string | null
          status: string
          suggested_score: number | null
          summary: string | null
          tasks: Json | null
          worksheet_chars: number | null
          worksheet_state: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "topic_homework_ai_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_telegram_tokens: { Args: never; Returns: undefined }
      close_topic_task_self: {
        Args: { p_item_id: string; p_topic_id: string }
        Returns: Json
      }
      course_assessment_grades: { Args: { p_course_id: string }; Returns: Json }
      course_assessments_summary: {
        Args: { p_course_id: string }
        Returns: Json
      }
      course_can_assign_curator: {
        Args: { p_course_id: string }
        Returns: boolean
      }
      course_copy_finalize: { Args: { p_job_id: string }; Returns: Json }
      course_copy_rollback: { Args: { p_job_id: string }; Returns: Json }
      course_copy_shift_date: {
        Args: { p_date: string; p_mode: string; p_shift_days: number }
        Returns: string
      }
      course_copy_stage: {
        Args: {
          p_mode?: string
          p_shift_days?: number
          p_source_course_id: string
          p_title?: string
        }
        Returns: Json
      }
      course_copy_topic_content: {
        Args: {
          p_mode: string
          p_shift_days: number
          p_source_topic_id: string
          p_target_topic_id: string
        }
        Returns: Json
      }
      course_curator_assign: {
        Args: { p_course_id: string; p_profile_id: string }
        Returns: string
      }
      course_curator_candidates: {
        Args: { p_course_id: string; p_query: string }
        Returns: {
          email: string
          full_name: string
          profile_id: string
          role: string
        }[]
      }
      course_curator_remove: {
        Args: { p_course_id: string; p_profile_id: string }
        Returns: undefined
      }
      course_default_module: { Args: { p_course_id: string }; Returns: string }
      course_delete_execute: { Args: { p_course_id: string }; Returns: Json }
      course_delete_preview: { Args: { p_course_id: string }; Returns: Json }
      course_diagnostics: { Args: { p_course_id: string }; Returns: Json }
      course_homework_grades: { Args: { p_course_id: string }; Returns: Json }
      course_is_admin: { Args: never; Returns: boolean }
      course_is_lesson_staff: {
        Args: { p_lesson_id: string }
        Returns: boolean
      }
      course_is_progress: { Args: { p_course_id: string }; Returns: boolean }
      course_is_staff: { Args: { p_course_id: string }; Returns: boolean }
      course_is_teacher_staff: {
        Args: { p_course_id: string }
        Returns: boolean
      }
      course_join_accept: {
        Args: { p_value: string }
        Returns: {
          course_id: string
          course_title: string
          group_id: string
          joined_as: string
        }[]
      }
      course_join_gen_code: { Args: never; Returns: string }
      course_join_gen_token: { Args: never; Returns: string }
      course_join_info: {
        Args: { p_value: string }
        Returns: {
          course_title: string
          is_active: boolean
        }[]
      }
      course_join_link_get: {
        Args: { p_course_id: string; p_role?: string }
        Returns: {
          is_active: boolean
          short_code: string
          token: string
        }[]
      }
      course_join_link_rotate: {
        Args: { p_course_id: string; p_role?: string }
        Returns: {
          is_active: boolean
          short_code: string
          token: string
        }[]
      }
      course_join_link_set_active: {
        Args: { p_active: boolean; p_course_id: string; p_role?: string }
        Returns: undefined
      }
      course_lesson_view: {
        Args: { p_lesson_id: string }
        Returns: {
          content: string
          file_name: string
          is_published: boolean
          kind: Database["public"]["Enums"]["course_material_kind"]
          lesson_id: string
          material_id: string
          material_position: number
          material_title: string
          storage_path: string
          summary: string
          title: string
          url: string
        }[]
      }
      course_member_remove: {
        Args: { p_course_id: string; p_student_id: string }
        Returns: undefined
      }
      course_member_rename: {
        Args: { p_full_name: string; p_student_id: string }
        Returns: undefined
      }
      course_of_topic: { Args: { p_topic_id: string }; Returns: string }
      course_progress_matrix: { Args: { p_course_id: string }; Returns: Json }
      course_showcase_notify: {
        Args: { p_showcase_id: string }
        Returns: boolean
      }
      course_staff_profiles: {
        Args: { p_course_id: string }
        Returns: {
          profile_id: string
        }[]
      }
      course_stats_activity_internal: {
        Args: { p_course_id: string }
        Returns: {
          day: string
          student_id: string
        }[]
      }
      course_stats_attempts_internal: {
        Args: { p_course_id: string }
        Returns: {
          attempt_id: string
          attempt_number: number
          created_day: string
          decision: string
          grade_scale: string
          homework_id: string
          score: number
          status: string
          student_id: string
          submitted_at: string
          submitted_day: string
          topic_id: string
        }[]
      }
      course_stats_bounds_internal: {
        Args: { p_period: string }
        Returns: {
          d_from: string
          d_to: string
          prev_from: string
          prev_to: string
        }[]
      }
      course_stats_files_internal: {
        Args: { p_course_id: string }
        Returns: {
          item_id: string
          student_id: string
          topic_id: string
        }[]
      }
      course_stats_roster_internal: {
        Args: { p_course_id: string }
        Returns: {
          full_name: string
          profile_id: string
          student_id: string
        }[]
      }
      course_stats_students: {
        Args: { p_course_id: string; p_period?: string }
        Returns: Json
      }
      course_stats_summary: {
        Args: { p_course_id: string; p_period?: string }
        Returns: Json
      }
      course_stats_topic_students: {
        Args: { p_course_id: string; p_period?: string; p_topic_id: string }
        Returns: Json
      }
      course_stats_topics: {
        Args: { p_course_id: string; p_period?: string }
        Returns: Json
      }
      course_storage_files: { Args: { p_course_id: string }; Returns: Json }
      course_student_can_see_lesson: {
        Args: { p_lesson_id: string }
        Returns: boolean
      }
      course_student_can_see_topic: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      course_student_has_access: {
        Args: { p_course_id: string }
        Returns: boolean
      }
      course_summary_for_staff: { Args: { p_course_id: string }; Returns: Json }
      course_topic_match_text: { Args: { p_title: string }; Returns: string }
      course_topic_tasks_matrix: {
        Args: { p_course_id: string }
        Returns: {
          closed_auto: number
          closed_self: number
          full_name: string
          module_order: number
          student_id: string
          tasks_total: number
          topic_id: string
          topic_order: number
          topic_title: string
          touched: number
        }[]
      }
      course_topic_tasks_progress_for_student: {
        Args: { p_course_id: string }
        Returns: {
          closed: number
          tasks_total: number
          topic_id: string
        }[]
      }
      course_topic_test_kind: { Args: { p_title: string }; Returns: string }
      course_topic_test_overview: {
        Args: { p_course_id: string }
        Returns: {
          available: number
          has_test: boolean
          kind: string
          linked_count: number
          module_title: string
          order_key: number
          topic_id: string
          topic_title: string
        }[]
      }
      courses_showcase: { Args: never; Returns: Json }
      create_assignment: {
        Args: {
          p_collection_id: string
          p_due_date?: string
          p_group_id?: string
          p_student_id?: string
        }
        Returns: {
          collection_id: string
          created_at: string
          due_date: string | null
          group_id: string | null
          id: string
          lesson_id: string | null
          status: string
          student_id: string | null
          teacher_id: string
        }
        SetofOptions: {
          from: "*"
          to: "assigned_collections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_or_get_teacher_join_link: { Args: never; Returns: Json }
      create_or_update_template_draft: {
        Args: {
          p_course_id: string
          p_files: Json
          p_instructions: string
          p_items: Json
          p_max_score: number
          p_pdf_config: Json
          p_template_id: string
          p_title: string
          p_topic_id: string
        }
        Returns: Json
      }
      create_self_built_variant: {
        Args: {
          p_exam_type: string
          p_items: Database["public"]["CompositeTypes"]["variant_item_input"][]
          p_subject: string
          p_title: string
        }
        Returns: string
      }
      create_student_invite: {
        Args: {
          p_class_grade?: string
          p_email?: string
          p_full_name: string
          p_group_id: string
          p_phone?: string
        }
        Returns: {
          expires_at: string
          invite_id: string
          short_code: string
          token: string
        }[]
      }
      create_student_invite_batch: {
        Args: { p_group_id: string; p_rows: Json; p_title?: string }
        Returns: Json
      }
      current_user_role: { Args: never; Returns: string }
      delete_answer_attachment: {
        Args: { p_attachment_id: string; p_student_assignment_id: string }
        Returns: Json
      }
      delete_lesson_material: {
        Args: { p_material_id: string }
        Returns: {
          deleted_storage_path: string
        }[]
      }
      delete_my_variant: {
        Args: { p_student_assignment_id: string }
        Returns: undefined
      }
      detach_variant_from_topic: {
        Args: { p_topic_id: string; p_variant_id: string }
        Returns: number
      }
      diagnostic_answer: {
        Args: {
          p_answer: string
          p_dont_know?: boolean
          p_session: string
          p_task: string
        }
        Returns: Json
      }
      diagnostic_done_subjects: {
        Args: { p_profile_id: string }
        Returns: {
          subject: string
        }[]
      }
      diagnostic_evidence_rows: {
        Args: { p_from: string; p_profile_id: string }
        Returns: {
          at: string
          item: string
          kim_total: number
          ns: number[]
          score: number
          source: string
          subject: string
        }[]
      }
      diagnostic_reset: { Args: { p_student_id: string }; Returns: boolean }
      diagnostic_result: { Args: { p_subject?: string }; Returns: Json }
      diagnostic_result_for: {
        Args: { p_student_id: string; p_subject?: string }
        Returns: Json
      }
      diagnostic_start: { Args: { p_subject?: string }; Returns: Json }
      disable_teacher_join_link: { Args: never; Returns: undefined }
      distribute_join_request: {
        Args: {
          p_assignments: Json
          p_join_request_id: string
          p_request_id?: string
        }
        Returns: Json
      }
      distribute_student_courses: {
        Args: {
          p_assignments: Json
          p_request_id?: string
          p_student_id: string
        }
        Returns: Json
      }
      ege_numbers_from_title: { Args: { p_title: string }; Returns: number[] }
      ensure_topic_task_rows: { Args: { p_topic_id: string }; Returns: string }
      finalize_grading: {
        Args: { p_student_assignment_id: string }
        Returns: Json
      }
      finalize_homework_attempt: {
        Args: {
          p_answer_text: string
          p_attempt_id: string
          p_storage_paths: Json
        }
        Returns: Json
      }
      finalize_lesson_copy: {
        Args: { p_job_id: string; p_material_results: Json }
        Returns: Json
      }
      fn_check_lesson_deletable: {
        Args: { p_lesson_id: string }
        Returns: Json
      }
      fn_safe_delete_lesson: {
        Args: { p_lesson_id: string }
        Returns: undefined
      }
      generate_variant_tasks: {
        Args: {
          p_sections: Database["public"]["CompositeTypes"]["variant_section_input"][]
        }
        Returns: {
          out_position: number
          out_section_id: string
          out_task_id: string
          out_topic_id: string
        }[]
      }
      generate_variant_tasks_by_topic: {
        Args: {
          p_exam_type: string
          p_levels: Json
          p_subject: string
          p_topic_ids: string[]
          p_topic_source?: string
        }
        Returns: {
          out_level: string
          out_position: number
          out_section_id: string
          out_task_id: string
          out_topic_id: string
        }[]
      }
      get_assignment_roster: {
        Args: { p_assignment_id: string }
        Returns: {
          full_name: string
          score: number
          status: string
          student_id: string
          submission_id: string
          submitted_at: string
        }[]
      }
      get_catalog_direction_counts: {
        Args: never
        Returns: {
          math_ege: number
          math_oge: number
          physics_ege: number
          physics_oge: number
        }[]
      }
      get_catalog_section_counts: {
        Args: { p_exam_type?: string; p_subject?: string }
        Returns: {
          part1_count: number
          part2_count: number
          section_id: string
          task_count: number
        }[]
      }
      get_catalog_section_task_counts_by_source: {
        Args: { p_exam_type: string; p_source: string; p_subject: string }
        Returns: {
          completed_count: number
          section_id: string
          task_count: number
        }[]
      }
      get_catalog_section_topic_tree: {
        Args: { p_section_id: string }
        Returns: {
          completed_count: number
          external_id: number
          id: string
          parent_id: string
          position: number
          slug: string
          task_count: number
          title: string
        }[]
      }
      get_catalog_topic_counts: {
        Args: { p_section_id: string }
        Returns: {
          task_count: number
          topic_id: string
        }[]
      }
      get_catalog_topic_counts_by_source: {
        Args: { p_exam_type: string; p_source: string; p_subject: string }
        Returns: {
          completed_count: number
          task_count: number
          topic_id: string
        }[]
      }
      get_catalog_topic_ids: {
        Args: { p_section_id: string }
        Returns: {
          topic_id: string
        }[]
      }
      get_course_homework_summary: {
        Args: { p_course_id: string; p_topic_id?: string }
        Returns: Json
      }
      get_homework_assignment_stats: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      get_homework_review_queue_v2: {
        Args: {
          p_course_id?: string
          p_group_id?: string
          p_limit?: number
          p_mode?: string
        }
        Returns: Json
      }
      get_lesson_summary: {
        Args: { p_lesson_id: string }
        Returns: {
          actual_topic: string
          board_url: string
          completed_at: string
          lesson_summary: string
          meeting_url: string
          planned_topic: string
          recommendations: string
          student_feedback: string
          teacher_notes: string
        }[]
      }
      get_my_homework_assignments: {
        Args: { p_group_id?: string; p_student_id?: string }
        Returns: Database["public"]["CompositeTypes"]["homework_v2_row"][]
        SetofOptions: {
          from: "*"
          to: "homework_v2_row"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_join_requests: {
        Args: { p_status?: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          reviewed_at: string
          status: string
          student_id: string
          teacher_id: string
        }[]
      }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_my_student_invites: {
        Args: { p_batch_id?: string; p_group_id?: string; p_status?: string }
        Returns: {
          accepted_at: string
          accepted_by: string
          batch_id: string
          class_grade: string
          client_row_id: string
          created_at: string
          email: string
          expires_at: string
          full_name: string
          group_id: string
          id: string
          invited_by: string
          phone: string
          revoked_at: string
          status: string
          updated_at: string
        }[]
      }
      get_my_students: {
        Args: never
        Returns: {
          added_at: string
          class_grade: string
          courses: Json
          full_name: string
          groups: Json
          profile_id: string
          relation_status: string
          student_id: string
        }[]
      }
      get_my_variant_assignments: {
        Args: never
        Returns: {
          answered_count: number
          assignment_id: string
          assignment_status: string
          attempts_used: number
          available_from: string
          completed_at: string
          correct_count: number
          created_at: string
          due_at: string
          grading_status: string
          group_name: string
          id: string
          manual_review_count: number
          max_attempts: number
          max_score: number
          percentage: number
          score: number
          started_at: string
          status: string
          student_id: string
          submitted_at: string
          teacher_name: string
          updated_at: string
          variant_description: string
          variant_exam_type: string
          variant_id: string
          variant_source_type: string
          variant_status: string
          variant_subject: string
          variant_tasks_count: number
          variant_title: string
        }[]
      }
      get_review_queue: {
        Args: {
          p_course_id?: string
          p_cursor?: Json
          p_due_after?: string
          p_due_before?: string
          p_group_id?: string
          p_limit?: number
          p_mode?: string
          p_source_type?: string
          p_status?: string[]
          p_student_id?: string
        }
        Returns: Json
      }
      get_review_queue_counts: {
        Args: {
          p_course_id?: string
          p_group_id?: string
          p_source_type?: string
          p_student_id?: string
        }
        Returns: Json
      }
      get_student_assignment_tasks: {
        Args: { p_assignment_id: string }
        Returns: {
          assets: Json
          catalog_task_id: string
          custom_number: string
          exam_type: string
          external_id: number
          has_answer: boolean
          has_solution: boolean
          item_id: string
          item_position: number
          statement_html: string
          subject: string
        }[]
      }
      get_student_homework_journal: {
        Args: { p_student_id: string }
        Returns: {
          assignment_id: string
          course_id: string
          course_title: string
          effective_due_at: string
          group_id: string
          group_title: string
          is_overdue: boolean
          latest_attempt_id: string
          latest_attempt_number: number
          latest_attempt_status: Database["public"]["Enums"]["homework_attempt_status"]
          latest_review_comment: string
          latest_review_decision: Database["public"]["Enums"]["homework_review_decision"]
          latest_score: number
          submitted_at: string
          template_id: string
          template_version_id: string
          title: string
          ui_category: string
          viewed_at: string
        }[]
      }
      get_student_homework_summary: { Args: never; Returns: Json }
      get_student_journal: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_student_id: string
          p_subject?: string
        }
        Returns: Json
      }
      get_student_number_stats:
        | {
            Args: {
              p_exam_type: string
              p_student_id: string
              p_subject: string
            }
            Returns: {
              earned_points: number
              exam_number: number
              exam_type: string
              fully_correct_count: number
              last_solved_at: string
              max_points: number
              partial_count: number
              section_id: string
              section_title: string
              solved_count: number
              subject: string
              success_ratio: number
              wrong_count: number
            }[]
          }
        | {
            Args: {
              p_exam_part?: number
              p_exam_type: string
              p_student_id: string
              p_subject: string
            }
            Returns: {
              earned_points: number
              exam_number: number
              exam_type: string
              fully_correct_count: number
              last_solved_at: string
              max_points: number
              partial_count: number
              section_id: string
              section_title: string
              solved_count: number
              subject: string
              success_ratio: number
              wrong_count: number
            }[]
          }
      get_student_topic_journal: {
        Args: { p_course_id?: string; p_student_id: string }
        Returns: Json
      }
      get_student_work_detail: {
        Args: { p_student_assignment_id: string }
        Returns: Json
      }
      get_teacher_homework_summary: { Args: never; Returns: Json }
      get_variant_items_for_student: {
        Args: { p_student_assignment_id: string }
        Returns: {
          answer_html: string
          exam_part: number
          exam_type: string
          grade_criteria_html: string
          grading_type: string
          has_answer: boolean
          has_solution: boolean
          item_id: string
          item_position: number
          max_points: number
          partial_type: string
          points: number
          solution_html: string
          solution_plan_html: string
          source_type: string
          statement_html: string
          subject: string
          task_ext_id: number
          task_id: string
          variant_id: string
        }[]
      }
      get_variant_results: {
        Args: { p_variant_id: string }
        Returns: {
          answered_count: number
          assignment_id: string
          attempts_used: number
          auto_score: number
          available_from: string
          completed_at: string
          correct_count: number
          due_at: string
          grading_status: string
          group_id: string
          group_name: string
          manual_review_count: number
          max_score: number
          percentage: number
          score: number
          started_at: string
          status: string
          student_id: string
          student_name: string
          submitted_at: string
          tvsa_id: string
          variant_tasks_count: number
        }[]
      }
      grade_mock_exam_part1: { Args: { p_mock_exam_id: string }; Returns: Json }
      grade_task_submission: {
        Args: {
          p_comment?: string
          p_score?: number
          p_status: string
          p_submission_id: string
        }
        Returns: {
          answers: Json
          assigned_id: string
          created_at: string
          files: string[]
          id: string
          reviewed_at: string | null
          score: number | null
          status: string
          student_id: string
          submitted_at: string
          teacher_comment: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      grade_variant_answer: {
        Args: {
          p_comment?: string
          p_points: number
          p_student_assignment_id: string
          p_variant_item_id: string
        }
        Returns: Json
      }
      hw_grade_equiv: {
        Args: { p_scale: string; p_score: number }
        Returns: number
      }
      invite_student_flow: {
        Args: {
          p_class_grade?: string
          p_course_id?: string
          p_email?: string
          p_exam_type?: Database["public"]["Enums"]["exam_type"]
          p_format: string
          p_full_name: string
          p_group_id?: string
          p_phone?: string
          p_request_id?: string
          p_subject?: Database["public"]["Enums"]["subject_type"]
        }
        Returns: Json
      }
      is_admin_or_owner: { Args: never; Returns: boolean }
      mark_achievements_seen: { Args: never; Returns: number }
      mock_exam_ai_request_check: {
        Args: { p_mock_exam_id: string; p_student_ids?: string[] }
        Returns: Json
      }
      mock_exam_away: { Args: { p_mock_exam_id: string }; Returns: Json }
      mock_exam_can_manage: {
        Args: { p_mock_exam_id: string }
        Returns: boolean
      }
      mock_exam_ensure_variant: {
        Args: { p_mock_exam_id: string; p_student_id: string }
        Returns: string
      }
      mock_exam_file_readable: { Args: { p_name: string }; Returns: boolean }
      mock_exam_file_writable: { Args: { p_name: string }; Returns: boolean }
      mock_exam_group_can_manage: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      mock_exam_group_is_staff: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      mock_exam_is_my_teacher: {
        Args: { p_teacher_id: string }
        Returns: boolean
      }
      mock_exam_is_staff: { Args: { p_mock_exam_id: string }; Returns: boolean }
      mock_exam_live: { Args: { p_mock_exam_id: string }; Returns: Json }
      mock_exam_my_student_id: {
        Args: { p_mock_exam_id: string }
        Returns: string
      }
      mock_exam_ping: { Args: { p_mock_exam_id: string }; Returns: Json }
      mock_exam_student_gate: {
        Args: { p_mock_exam_id: string; p_until: string }
        Returns: string
      }
      mock_exam_student_has_work: {
        Args: { p_mock_exam_id: string; p_student_id: string }
        Returns: boolean
      }
      mock_exam_student_variant: {
        Args: { p_mock_exam_id: string; p_student_id: string }
        Returns: string
      }
      mock_exam_template_max_score: {
        Args: { p_template_id: string }
        Returns: number
      }
      mock_exam_template_scale_ok: {
        Args: { p_max_points: number[]; p_scale: number[] }
        Returns: boolean
      }
      mock_exam_test_score: {
        Args: { p_primary: number; p_scale: number[] }
        Returns: number
      }
      mock_exam_window: {
        Args: { p_mock_exam_id: string }
        Returns: {
          ends_at: string
          photos_until: string
          starts_at: string
        }[]
      }
      my_course_access: { Args: { p_course_id: string }; Returns: Json }
      my_course_assessments: { Args: { p_group_id: string }; Returns: Json }
      my_course_demo: { Args: { p_course_id: string }; Returns: Json }
      my_course_topic_locks: { Args: { p_course_id: string }; Returns: Json }
      my_live_timed_works: { Args: never; Returns: Json }
      my_mock_exam: { Args: { p_mock_exam_id: string }; Returns: Json }
      my_mock_exam_result: { Args: { p_mock_exam_id: string }; Returns: Json }
      my_mock_exams: { Args: { p_group_id: string }; Returns: Json }
      my_staff_course_ids: { Args: never; Returns: string[] }
      my_subscriptions: { Args: never; Returns: Json }
      my_topic_rating: { Args: { p_topic_id: string }; Returns: number }
      my_variant_answer_flags: {
        Args: { p_student_assignment_id: string }
        Returns: Json
      }
      my_work_mode: { Args: never; Returns: Json }
      normalize_answer_digits: { Args: { p_value: string }; Returns: string }
      normalize_email: { Args: { p: string }; Returns: string }
      normalize_phone: { Args: { p: string }; Returns: string }
      normalize_short_code: { Args: { p: string }; Returns: string }
      normalize_variant_answer: { Args: { raw: string }; Returns: string }
      notification_log_dispatch_error: {
        Args: {
          p_entity_id: string
          p_message: string
          p_source: string
          p_sqlstate: string
        }
        Returns: undefined
      }
      notify_homework_submitted: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      notify_mock_exam_results: {
        Args: { p_mock_exam_id: string; p_student_ids?: string[] }
        Returns: Json
      }
      onboarding_save: { Args: { p: Json }; Returns: Json }
      onboarding_skip_diagnostic: { Args: never; Returns: Json }
      onboarding_state: { Args: never; Returns: Json }
      perf_cleanup: { Args: never; Returns: number }
      perf_ingest: { Args: { p_events: Json }; Returns: number }
      perf_rollup: { Args: { p_hours?: number }; Returns: number }
      pick_replacement_task: {
        Args: {
          p_exclude?: string[]
          p_section_id: string
          p_topic_id?: string
        }
        Returns: string
      }
      prepare_topic_link_material: {
        Args: { p_title: string; p_topic_id: string; p_url: string }
        Returns: {
          metadata: Json
          normalized_title: string
          normalized_url: string
          object_path: string
        }[]
      }
      preview_task_verdict: {
        Args: { p_answer_raw: string; p_task_id: string }
        Returns: boolean
      }
      progress_open_any: { Args: { p_course_ids: string[] }; Returns: Json }
      progress_open_by_student: {
        Args: { p_course_ids: string[]; p_student_ids: string[] }
        Returns: Json
      }
      queue_collection_notification: {
        Args: {
          p_assigned_id: string
          p_deduplication_key: string
          p_event_type: string
          p_payload: Json
          p_profile_id: string
          p_submission_id: string
        }
        Returns: string
      }
      queue_variant_telegram_notification: {
        Args: {
          p_assignment_id: string
          p_deduplication_key: string
          p_event_type: string
          p_payload: Json
          p_profile_id: string
          p_student_assignment_id: string
          p_variant_id: string
        }
        Returns: string
      }
      rate_topic: {
        Args: { p_rating: number; p_topic_id: string }
        Returns: Json
      }
      realtime_review_topic_course: { Args: { topic: string }; Returns: string }
      record_app_visit: { Args: never; Returns: undefined }
      record_material_view: { Args: { p_item_id: string }; Returns: undefined }
      reissue_student_invite: {
        Args: { p_invite_id: string }
        Returns: {
          expires_at: string
          invite_id: string
          short_code: string
          token: string
        }[]
      }
      reissue_student_invite_batch: {
        Args: { p_batch_id: string }
        Returns: {
          client_row_id: string
          error: string
          expires_at: string
          invite_id: string
          short_code: string
          status: string
          token: string
        }[]
      }
      reject_teacher_join_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      remind_overdue_homework: {
        Args: { p_course_ids?: string[]; p_student_ids?: string[] }
        Returns: Json
      }
      remove_mock_exam_photo: { Args: { p_photo_id: string }; Returns: string }
      reorder_course_topics: {
        Args: { p_course_id: string; p_layout: Json }
        Returns: undefined
      }
      replace_variant_task: {
        Args: {
          p_old_task_id: string
          p_section_id: string
          p_topic_id: string
          p_variant_id: string
        }
        Returns: string
      }
      restore_teacher_join_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      retry_notification: { Args: { queue_id: string }; Returns: undefined }
      reveal_topic_task_solution: {
        Args: { p_item_id: string; p_topic_id: string }
        Returns: Json
      }
      revoke_student_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      rollback_lesson_copy: { Args: { p_job_id: string }; Returns: Json }
      rotate_teacher_join_link: { Args: never; Returns: Json }
      rpc_batch: { Args: { p_calls: Json }; Returns: Json }
      save_answer_attachment: {
        Args: {
          p_file_name: string
          p_file_size?: number
          p_mime_type?: string
          p_storage_path: string
          p_student_assignment_id: string
          p_variant_item_id: string
        }
        Returns: Json
      }
      save_collection_atomic: {
        Args: {
          p_collection_id: string
          p_description: string
          p_items: Database["public"]["CompositeTypes"]["collection_item_input"][]
          p_subject: string
          p_title: string
          p_work_type: string
        }
        Returns: string
      }
      save_lesson_summary: {
        Args: {
          p_actual_topic?: string
          p_board_url?: string
          p_lesson_id: string
          p_lesson_summary?: string
          p_meeting_url?: string
          p_planned_topic?: string
          p_recommendations?: string
          p_student_feedback?: string
          p_teacher_notes?: string
        }
        Returns: undefined
      }
      save_mock_exam_answer: {
        Args: { p_answer: string; p_mock_exam_id: string; p_task: number }
        Returns: Json
      }
      save_mock_exam_grid: {
        Args: { p_mock_exam_id: string; p_rows: Json }
        Returns: Json
      }
      save_mock_exam_key: {
        Args: { p_answers: string[]; p_mock_exam_id: string }
        Returns: Json
      }
      save_mock_exam_task_comments: {
        Args: { p_comments: Json; p_mock_exam_id: string; p_student_id: string }
        Returns: Json
      }
      save_mock_exam_variant_key: {
        Args: { p_answers: string[]; p_variant_id: string }
        Returns: Json
      }
      save_variant_answer: {
        Args: {
          p_answer_raw: string
          p_student_assignment_id: string
          p_variant_item_id: string
        }
        Returns: Json
      }
      save_variant_atomic: {
        Args: {
          p_description: string
          p_exam_type: string
          p_items: Database["public"]["CompositeTypes"]["variant_item_input"][]
          p_settings: Json
          p_status: string
          p_subject: string
          p_title: string
          p_variant_id: string
        }
        Returns: string
      }
      school_activity_daily: {
        Args: { p_days?: number }
        Returns: {
          day: string
          people: number
        }[]
      }
      school_dormant_students: {
        Args: { p_days?: number }
        Returns: {
          course_titles: string
          days_silent: number
          full_name: string
          last_active: string
          never_active: boolean
          profile_id: string
          student_id: string
        }[]
      }
      school_homework_funnel: {
        Args: never
        Returns: {
          accepted: number
          course_id: string
          course_title: string
          expected: number
          submitted: number
        }[]
      }
      school_material_view_health: {
        Args: never
        Returns: {
          first_day: string
          views_7d: number
          views_total: number
        }[]
      }
      school_presence_online: {
        Args: { p_seconds?: number }
        Returns: {
          profile_id: string
          role: string
          seen_at: string
        }[]
      }
      school_presence_touch: { Args: never; Returns: undefined }
      school_unopened_materials: {
        Args: { p_limit?: number }
        Returns: {
          course_title: string
          has_data: boolean
          topic_id: string
          topic_title: string
          total_items: number
          unopened: number
        }[]
      }
      score_auto_answer: {
        Args: {
          p_correct_raw: string
          p_partial_type: string
          p_student_raw: string
        }
        Returns: number
      }
      score_partial_matching: {
        Args: { p_correct_raw: string; p_student_raw: string }
        Returns: number
      }
      score_partial_multi_choice: {
        Args: { p_correct_raw: string; p_student_raw: string }
        Returns: number
      }
      set_my_exam_goal: {
        Args: { p_goal: number; p_subject: string }
        Returns: number
      }
      staff_manageable_topics: { Args: never; Returns: string[] }
      staff_module_open_for_student: {
        Args: { p_module_id: string; p_note?: string; p_student_id: string }
        Returns: number
      }
      staff_topic_open_for_course: {
        Args: { p_note?: string; p_topic_id: string }
        Returns: number
      }
      staff_topic_override_set: {
        Args: {
          p_note?: string
          p_state: string
          p_student_id: string
          p_topic_id: string
        }
        Returns: Json
      }
      stage_lesson_copy: {
        Args: {
          p_available_from?: string
          p_order_index?: number
          p_target_course_id?: string
          p_target_group_id?: string
          p_target_module_id?: string
          p_template_id: string
        }
        Returns: Json
      }
      start_homework_attempt: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      start_variant_attempt: {
        Args: { p_student_assignment_id: string }
        Returns: Json
      }
      storage_path_refs: {
        Args: { p_bucket: string; p_path: string }
        Returns: number
      }
      strip_html_simple: { Args: { html: string }; Returns: string }
      student_access_courses: { Args: never; Returns: string[] }
      student_achievement_progress: {
        Args: { p_profile_id: string }
        Returns: {
          have: number
          key: string
          need: number
          reached_at: string
        }[]
      }
      student_achievements_for_staff: {
        Args: { p_student_id: string }
        Returns: Json
      }
      student_achievements_sync: { Args: never; Returns: Json }
      student_active_works: {
        Args: { p_student_id: string }
        Returns: {
          closes_at: string
          course_id: string
          group_id: string
          homework_id: string
          kind: string
          mock_exam_id: string
          opens_at: string
          personal: boolean
          title: string
          topic_id: string
          work_kind: string
        }[]
      }
      student_candidate_topics: { Args: never; Returns: string[] }
      student_catalog_week_for_staff: {
        Args: { p_student_id: string }
        Returns: Json
      }
      student_daily_task: { Args: { p_subject: string }; Returns: Json }
      student_exam_evidence_rows: {
        Args: { p_from: string; p_profile_id: string }
        Returns: {
          at: string
          item: string
          kim_total: number
          ns: number[]
          score: number
          source: string
          subject: string
        }[]
      }
      student_exam_forecast_evidence: { Args: never; Returns: Json }
      student_forecast_evidence_of: {
        Args: { p_as_of: string; p_profile_id: string }
        Returns: Json
      }
      student_home_activity: { Args: { p_days?: number }; Returns: Json }
      student_home_courses: { Args: never; Returns: Json }
      student_kim_zone_shares: {
        Args: {
          p_ats: string[]
          p_ns: number[]
          p_profile_id: string
          p_subjects: string[]
        }
        Returns: {
          idx: number
          share: number
          weight: number
          zone: string
        }[]
      }
      student_overview_for_staff: {
        Args: { p_student_id: string; p_subject?: string }
        Returns: Json
      }
      student_path_home: { Args: never; Returns: Json }
      student_progress_open_topics: { Args: never; Returns: string[] }
      student_progress_report: {
        Args: { p_from: string; p_student_id: string; p_to: string }
        Returns: Json
      }
      student_reminder_candidates: {
        Args: { p_kinds?: string[]; p_now?: string }
        Returns: Json
      }
      student_school_points: { Args: never; Returns: Json }
      student_school_points_of: {
        Args: { p_profile_id: string }
        Returns: Json
      }
      student_solve_days: {
        Args: { p_profile_id: string }
        Returns: {
          day: string
        }[]
      }
      student_solve_streak: {
        Args: { p_profile_id: string; p_today: string }
        Returns: {
          record: number
          solved_today: boolean
          streak: number
        }[]
      }
      student_solved_task_days: {
        Args: { p_from: string; p_profile_id: string }
        Returns: {
          day: string
          n: number
          source: string
        }[]
      }
      student_tmi_condition_topics: { Args: never; Returns: string[] }
      student_tmi_solution_topics: { Args: never; Returns: string[] }
      student_tmi_visible_topics: { Args: never; Returns: string[] }
      student_visible_homework: { Args: never; Returns: string[] }
      student_visible_tests: { Args: never; Returns: string[] }
      student_visible_topics: { Args: never; Returns: string[] }
      student_visit_streak: {
        Args: { p_profile_id: string; p_today: string }
        Returns: {
          record: number
          streak: number
          visited_today: boolean
        }[]
      }
      student_weak_numbers: {
        Args: { p_profile_id: string; p_subject: string }
        Returns: {
          n: number
          ord: number
          share: number
          untried: number
          weight: number
          zone: string
        }[]
      }
      student_week_plan: { Args: never; Returns: Json }
      student_weekly_goal: { Args: { p_subject: string }; Returns: Json }
      student_work_rows: {
        Args: { p_student_id: string }
        Returns: {
          class_avg: number
          class_graded: number
          class_size: number
          course_id: string
          due_at: string
          exam_type: string
          first_submitted_at: string
          grade_scale: string
          grp: string
          homework_id: string
          kind: string
          opens_at: string
          points: number
          points_max: number
          score: number
          status: string
          subject: string
          title: string
          topic_id: string
          work_date: string
        }[]
      }
      students_telegram_flags: {
        Args: { p_student_ids: string[] }
        Returns: {
          student_id: string
          telegram_linked: boolean
        }[]
      }
      study_plan_apply_opening: {
        Args: { p_course_id: string }
        Returns: number
      }
      study_plan_apply_opening_internal: {
        Args: { p_course_id: string; p_topic_id?: string }
        Returns: number
      }
      study_plan_board: { Args: { p_course_id: string }; Returns: Json }
      study_plan_current_week: { Args: { p_start: string }; Returns: number }
      study_plan_freeze_topic_internal: {
        Args: { p_topic_id: string }
        Returns: undefined
      }
      study_plan_save: {
        Args: {
          p_auto_open?: boolean
          p_course_id: string
          p_start_date: string
        }
        Returns: undefined
      }
      study_plan_set_override: {
        Args: {
          p_course_id: string
          p_removed?: boolean
          p_student_id: string
          p_topic_id: string
          p_week_no?: number
        }
        Returns: undefined
      }
      study_plan_set_topic_week: {
        Args: { p_course_id: string; p_topic_id: string; p_week_no: number }
        Returns: undefined
      }
      study_plan_spread: {
        Args: { p_course_id: string; p_per_week: number }
        Returns: number
      }
      study_plan_topic_states: {
        Args: { p_course_id: string }
        Returns: {
          done: boolean
          hw_published: boolean
          hw_status: string
          lesson_marked: boolean
          marked: boolean
          student_id: string
          submitted_at: string
          theory_marked: boolean
          topic_id: string
        }[]
      }
      study_plan_week_deadline: {
        Args: { p_start: string; p_week: number }
        Returns: string
      }
      study_plan_week_start: {
        Args: { p_start: string; p_week: number }
        Returns: string
      }
      submit_homework_review: {
        Args: {
          p_attempt_id: string
          p_comment: string
          p_decision: Database["public"]["Enums"]["homework_review_decision"]
          p_score: number
        }
        Returns: Json
      }
      submit_mock_exam: { Args: { p_mock_exam_id: string }; Returns: Json }
      submit_support_request: {
        Args: {
          p_attachments?: string[]
          p_message: string
          p_page_path?: string
          p_subject: string
        }
        Returns: string
      }
      submit_task_solution: {
        Args: { p_answers: Json; p_assigned_id: string; p_files: string[] }
        Returns: {
          answers: Json
          assigned_id: string
          created_at: string
          files: string[]
          id: string
          reviewed_at: string | null
          score: number | null
          status: string
          student_id: string
          submitted_at: string
          teacher_comment: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_teacher_join_request: { Args: { p_token: string }; Returns: Json }
      submit_variant: {
        Args: { p_student_assignment_id: string }
        Returns: Json
      }
      subscription_access_ok: {
        Args: { p_course_id: string; p_student_id: string }
        Returns: boolean
      }
      subscription_apply_payment: {
        Args: {
          p_amount_rub: number
          p_cancel_reason: string
          p_card_title: string
          p_method_id: string
          p_method_saved: boolean
          p_our_payment_id: string
          p_paid_at: string
          p_status: string
          p_yookassa_id: string
        }
        Returns: string
      }
      subscription_apply_refund:
        | {
            Args: { p_refund_id: string; p_yookassa_payment_id: string }
            Returns: string
          }
        | {
            Args: {
              p_refund_id: string
              p_refund_rub: number
              p_yookassa_payment_id: string
            }
            Returns: string
          }
      subscription_checkout_begin:
        | {
            Args: {
              p_accepted_offer: boolean
              p_is_minor: boolean
              p_parent_consent: boolean
              p_profile_id: string
              p_receipt_email: string
              p_save_card: boolean
              p_tariff_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_accepted_offer: boolean
              p_is_minor: boolean
              p_parent_consent: boolean
              p_profile_id: string
              p_promo_code: string
              p_receipt_email: string
              p_save_card: boolean
              p_tariff_id: string
            }
            Returns: Json
          }
      subscription_course_is_paid: {
        Args: { p_course_id: string }
        Returns: boolean
      }
      subscription_enabled: { Args: never; Returns: boolean }
      subscription_enabled_for: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      subscription_ending_soon_tick: { Args: never; Returns: number }
      subscription_expire_tick: { Args: never; Returns: number }
      subscription_mail_claim: {
        Args: { p_limit?: number }
        Returns: {
          access_until: string
          course_title: string
          email: string
          full_name: string
          id: number
          kind: string
          last_charge_error: string
          next_charge_at: string
          source: string
          status: string
        }[]
      }
      subscription_mail_done: {
        Args: {
          p_error: string
          p_id: number
          p_ok: boolean
          p_skipped: string
        }
        Returns: undefined
      }
      subscription_payment_attach: {
        Args: {
          p_confirmation_url: string
          p_payment_id: string
          p_status: string
          p_yookassa_id: string
        }
        Returns: undefined
      }
      subscription_payment_failed: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: string
      }
      subscription_promo_check: {
        Args: { p_code: string; p_tariff_id: string }
        Returns: Json
      }
      subscription_renewal_begin: {
        Args: { p_subscription_id: string }
        Returns: Json
      }
      subscription_renewal_due: {
        Args: { p_limit?: number }
        Returns: {
          subscription_id: string
        }[]
      }
      subscription_set_auto_renew: {
        Args: { p_on: boolean; p_subscription_id: string }
        Returns: Json
      }
      subscription_start_trial: {
        Args: {
          p_accepted_offer: boolean
          p_is_minor: boolean
          p_parent_consent: boolean
          p_tariff_id: string
        }
        Returns: Json
      }
      subscription_tariffs_public: { Args: never; Returns: Json }
      support_request_recipients: {
        Args: never
        Returns: {
          profile_id: string
        }[]
      }
      sync_group_assignment: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      teacher_courses_overview: {
        Args: { p_course_ids?: string[] }
        Returns: {
          course_id: string
          modules: number
          next_open: string
          next_open_count: number
          open_topics: number
          pending: number
          student_ids: string[]
          students: number
          subs_7d: number
          topics: number
        }[]
      }
      teacher_home: { Args: { p_course_ids?: string[] }; Returns: Json }
      teacher_home_overdue: {
        Args: { p_course_ids: string[] }
        Returns: {
          card_title: string
          course_id: string
          course_title: string
          due_date: string
          group_id: string
          group_name: string
          homework_id: string
          profile_id: string
          reminded_at: string
          student_id: string
          student_name: string
          telegram: string
          topic_id: string
          topic_title: string
        }[]
      }
      teacher_home_scope: {
        Args: { p_course_ids: string[] }
        Returns: {
          course_id: string
          course_title: string
          group_id: string
          group_name: string
        }[]
      }
      template_sync_course_apply: {
        Args: { p_template_course_id: string }
        Returns: Json
      }
      template_sync_homework: {
        Args: { p_copy_topic_id: string; p_template_topic_id: string }
        Returns: undefined
      }
      template_sync_module_apply: {
        Args: { p_template_module_id: string }
        Returns: Json
      }
      template_sync_topic: {
        Args: { p_template_topic_id: string }
        Returns: Json
      }
      template_sync_topic_apply: {
        Args: { p_template_topic_id: string }
        Returns: Json
      }
      timed_work_live: { Args: { p_homework_id: string }; Returns: Json }
      topic_attached_variants: {
        Args: { p_topic_id: string }
        Returns: {
          assigned_count: number
          exam_type: string
          group_count: number
          passed_count: number
          subject: string
          tasks_count: number
          title: string
          variant_id: string
        }[]
      }
      topic_autocheck_check: {
        Args: { p_answer: string; p_task_id: string }
        Returns: Json
      }
      topic_autocheck_import: {
        Args: { p_tasks: Json; p_topic_id: string }
        Returns: Json
      }
      topic_autocheck_object_visible: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      topic_autocheck_reorder: {
        Args: { p_task_ids: string[]; p_topic_id: string }
        Returns: number
      }
      topic_autocheck_results: { Args: { p_topic_id: string }; Returns: Json }
      topic_autocheck_set_text: {
        Args: { p_items: Json; p_topic_id: string }
        Returns: Json
      }
      topic_autocheck_solutions_unlocked: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_autocheck_state: { Args: { p_topic_id: string }; Returns: Json }
      topic_autocheck_task_can_manage: {
        Args: { p_task_id: string }
        Returns: boolean
      }
      topic_autocheck_task_closed: {
        Args: { p_profile_id: string; p_task_id: string }
        Returns: boolean
      }
      topic_autocheck_task_topic: {
        Args: { p_task_id: string }
        Returns: string
      }
      topic_catalog_part1_task_count: {
        Args: { p_catalog_topic_ids: string[]; p_source?: string }
        Returns: number
      }
      topic_catalog_suggestions: {
        Args: { p_limit?: number; p_topic_id: string }
        Returns: {
          available: number
          catalog_topic_id: string
          score: number
          title: string
        }[]
      }
      topic_condition_visible: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_copy_stage: {
        Args: {
          p_mode?: string
          p_shift_days?: number
          p_source_topic_id: string
          p_target_module_id: string
        }
        Returns: Json
      }
      topic_done_events:
        | {
            Args: never
            Returns: {
              done_at: string
              student_id: string
              topic_id: string
            }[]
          }
        | {
            Args: { p_student_ids: string[] }
            Returns: {
              done_at: string
              student_id: string
              topic_id: string
            }[]
          }
      topic_has_student_traces: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_homework_ai_expire_stale_jobs: {
        Args: { p_attempt_ids?: string[] }
        Returns: number
      }
      topic_homework_ai_mark_accepted: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      topic_homework_ai_request_check: {
        Args: { p_attempt_id: string }
        Returns: string
      }
      topic_homework_attempt_can_review: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      topic_homework_attempt_has_verdict: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      topic_homework_attempt_is_own: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      topic_homework_attempt_is_own_draft: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      topic_homework_autopublish_tick: { Args: never; Returns: Json }
      topic_homework_autosubmit_due: { Args: never; Returns: number }
      topic_homework_can_edit: {
        Args: { p_homework_id: string }
        Returns: boolean
      }
      topic_homework_can_manage: {
        Args: { p_homework_id: string }
        Returns: boolean
      }
      topic_homework_card_title: {
        Args: { p_hw_title: string; p_topic_title: string }
        Returns: string
      }
      topic_homework_clear_marks: {
        Args: { p_attempt_id: string; p_dry_run?: boolean }
        Returns: {
          ai_findings: number
          teacher_regions: number
        }[]
      }
      topic_homework_clear_personal_window: {
        Args: { p_homework_id: string; p_student_id: string }
        Returns: undefined
      }
      topic_homework_condition_open: {
        Args: { p_homework_id: string; p_student_id: string }
        Returns: boolean
      }
      topic_homework_default_scale: {
        Args: { p_kind: string }
        Returns: string
      }
      topic_homework_digest_due_at: {
        Args: { p_first: string; p_last: string }
        Returns: string
      }
      topic_homework_digest_eta: {
        Args: { p_homework_id: string }
        Returns: Json
      }
      topic_homework_digest_flush: { Args: { p_now?: string }; Returns: Json }
      topic_homework_enqueue_reviewed: {
        Args: { p_review_id: string }
        Returns: number
      }
      topic_homework_is_timed: {
        Args: { p_homework_id: string }
        Returns: boolean
      }
      topic_homework_my_window: {
        Args: { p_homework_id: string }
        Returns: Json
      }
      topic_homework_notify_students: {
        Args: { p_homework_id: string; p_profile_ids?: string[] }
        Returns: number
      }
      topic_homework_notify_targets: {
        Args: { p_homework_id: string }
        Returns: {
          full_name: string
          pending: boolean
          profile_id: string
          telegram_linked: boolean
        }[]
      }
      topic_homework_object_visible: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      topic_homework_review_attempt: {
        Args: {
          p_attempt_id: string
          p_comment?: string
          p_decision: Database["public"]["Enums"]["topic_homework_review_decision"]
          p_score?: number
        }
        Returns: string
      }
      topic_homework_review_tasks_seed: {
        Args: { p_attempt_id: string }
        Returns: number
      }
      topic_homework_set_personal_window: {
        Args: {
          p_closes_at: string
          p_homework_id: string
          p_opens_at: string
          p_student_id: string
        }
        Returns: undefined
      }
      topic_homework_start_attempt: {
        Args: { p_homework_id: string }
        Returns: string
      }
      topic_homework_student_can_see: {
        Args: { p_homework_id: string }
        Returns: boolean
      }
      topic_homework_student_window: {
        Args: { p_homework_id: string; p_student_id: string }
        Returns: {
          closes_at: string
          opens_at: string
          personal: boolean
        }[]
      }
      topic_homework_submit_attempt: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      topic_homework_timed_summary: {
        Args: { p_homework_id: string }
        Returns: Json
      }
      topic_homework_topic: { Args: { p_homework_id: string }; Returns: string }
      topic_homework_window_message: {
        Args: { p_homework_id: string; p_student_id: string }
        Returns: string
      }
      topic_homework_window_open: {
        Args: { p_homework_id: string; p_student_id: string }
        Returns: boolean
      }
      topic_is_in_template: { Args: { p_topic_id: string }; Returns: boolean }
      topic_is_timed: { Args: { p_topic_id: string }; Returns: boolean }
      topic_material_can_edit: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_material_can_manage: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_material_file_locked: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      topic_material_object_visible: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      topic_open_now: {
        Args: { p_available_from: string; p_is_open: boolean }
        Returns: boolean
      }
      topic_open_with: {
        Args: {
          p_available_from: string
          p_flags: Json
          p_is_open: boolean
          p_key: string
        }
        Returns: boolean
      }
      topic_ratings_summary: {
        Args: { p_course_id: string }
        Returns: {
          avg_rating: number
          dist: number[]
          last_at: string
          ratings: number
          topic_id: string
        }[]
      }
      topic_solution_state: { Args: { p_topic_id: string }; Returns: Json }
      topic_solution_unlocked: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_student_variants: {
        Args: { p_topic_id: string }
        Returns: {
          due_at: string
          exam_type: string
          grading_status: string
          max_score: number
          percentage: number
          score: number
          status: string
          student_assignment_id: string
          subject: string
          tasks_count: number
          title: string
          variant_id: string
        }[]
      }
      topic_subtopic_is_hidden: {
        Args: { p_code: string; p_topic_id: string }
        Returns: boolean
      }
      topic_task_detach_item: {
        Args: { p_force?: boolean; p_item_id: string; p_topic_id: string }
        Returns: Json
      }
      topic_task_move_item: {
        Args: { p_delta: number; p_item_id: string; p_topic_id: string }
        Returns: undefined
      }
      topic_task_progress_for_staff: {
        Args: { p_topic_id: string }
        Returns: {
          closed_auto: number
          closed_self: number
          students_done: number
          students_started: number
          students_total: number
          tasks_total: number
        }[]
      }
      topic_tasks_for_staff: {
        Args: { p_topic_id: string }
        Returns: {
          answers_count: number
          auto_checkable: boolean
          closed_count: number
          exam_part: number
          external_id: string
          item_id: string
          item_position: number
          max_points: number
          statement_html: string
          task_id: string
        }[]
      }
      topic_tasks_for_student: {
        Args: { p_topic_id: string }
        Returns: {
          answer_html: string
          answer_raw: string
          assets: Json
          attempts_count: number
          auto_checkable: boolean
          closed_by: string
          is_correct: boolean
          item_id: string
          item_position: number
          max_points: number
          solution_html: string
          solution_shown_at: string
          statement_html: string
          student_assignment_id: string
          task_id: string
        }[]
      }
      topic_template_link: { Args: { p_topic_id: string }; Returns: Json }
      topic_test_add_item: {
        Args: { p_task_id: string; p_test_id: string }
        Returns: string
      }
      topic_test_assignment_can_view: {
        Args: { p_assignment_id: string }
        Returns: boolean
      }
      topic_test_assignment_items: {
        Args: { p_assignment_id: string }
        Returns: {
          answer_html: string
          answer_text: string
          assets: Json
          exam_part: number
          id: string
          max_points: number
          partial_type: string
          position: number
          solution_html: string
          statement_html: string
        }[]
      }
      topic_test_attempt_can_view: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      topic_test_attempt_is_own: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      topic_test_bank_can_manage: {
        Args: { p_test_id: string }
        Returns: boolean
      }
      topic_test_bank_is_staff: { Args: never; Returns: boolean }
      topic_test_can_manage: { Args: { p_test_id: string }; Returns: boolean }
      topic_test_save_answer: {
        Args: { p_answer: string; p_attempt_id: string; p_item_id: string }
        Returns: undefined
      }
      topic_test_score_item: {
        Args: {
          p_correct: string
          p_max_points: number
          p_partial_type: string
          p_student: string
        }
        Returns: number
      }
      topic_test_start_attempt: {
        Args: { p_assignment_id: string }
        Returns: string
      }
      topic_test_strip_html: { Args: { p_html: string }; Returns: string }
      topic_test_student_can_see: {
        Args: { p_test_id: string }
        Returns: boolean
      }
      topic_test_student_can_see_assignment: {
        Args: { p_assignment_id: string }
        Returns: boolean
      }
      topic_test_submit_attempt: {
        Args: { p_attempt_id: string }
        Returns: {
          max_points: number
          total_points: number
        }[]
      }
      topics_open_until: { Args: { p_topic_id: string }; Returns: number }
      update_variant_assignment: {
        Args: {
          p_allow_retry?: boolean
          p_assignment_id: string
          p_available_from?: string
          p_clear_available_from?: boolean
          p_clear_due_at?: boolean
          p_due_at?: string
          p_max_attempts?: number
          p_show_answers_after_submit?: boolean
          p_show_solutions_after_submit?: boolean
        }
        Returns: Json
      }
      variant_answer_alternatives: {
        Args: { p_correct_norm: string }
        Returns: number[]
      }
      variant_answer_can_auto_check: {
        Args: { p_correct_norm: string }
        Returns: boolean
      }
      variant_answer_is_auto_checkable: {
        Args: { p_answer_html: string; p_partial_type: string }
        Returns: boolean
      }
      variant_answer_required_set: {
        Args: { p_correct_norm: string }
        Returns: number[]
      }
      variant_answer_student_set: {
        Args: { p_student_norm: string }
        Returns: number[]
      }
      variant_answer_value_error_pair: {
        Args: { p_correct_norm: string }
        Returns: number[]
      }
      variant_answer_verdict: {
        Args: { p_correct_norm: string; p_student_norm: string }
        Returns: boolean
      }
      variant_level_scale: {
        Args: { p_exam_type: string; p_subject: string }
        Returns: string
      }
      variant_pass_counts: {
        Args: { p_variant_ids: string[] }
        Returns: {
          assigned_count: number
          passed_count: number
          variant_id: string
        }[]
      }
      variant_section_available_counts: {
        Args: { p_exam_type: string; p_subject: string }
        Returns: {
          available: number
          available_p1: number
          available_p2: number
          section_id: string
          total: number
        }[]
      }
      variant_selection_availability: {
        Args: {
          p_exam_type: string
          p_subject: string
          p_topic_ids: string[]
          p_topic_source?: string
        }
        Returns: {
          available: number
          level: string
        }[]
      }
      variant_task_eligible: {
        Args: {
          p_answer_html: string
          p_exam_part: number
          p_grade_criteria_html: string
          p_max_points: number
          p_partial_type: string
        }
        Returns: boolean
      }
      variant_task_level: {
        Args: {
          p_difficulty: string
          p_exam_part: number
          p_exam_type: string
          p_subject: string
        }
        Returns: string
      }
      variant_topic_availability: {
        Args: {
          p_exam_type: string
          p_subject: string
          p_topic_ids?: string[]
          p_topic_source?: string
        }
        Returns: {
          available: number
          exam_number: number
          level: string
          section_id: string
          section_position: number
          section_title: string
          topic_id: string
          topic_title: string
        }[]
      }
      variant_topic_groups: {
        Args: { p_topic_id: string }
        Returns: {
          group_id: string
          group_name: string
          student_count: number
        }[]
      }
      video_watch_add: {
        Args: {
          p_duration?: number
          p_item_id: string
          p_position: number
          p_seconds: number
        }
        Returns: undefined
      }
      video_watch_item_is_staff: {
        Args: { p_item_id: string }
        Returns: boolean
      }
      work_mark_opened: { Args: { p_homework_id: string }; Returns: Json }
      work_mode_active: { Args: never; Returns: boolean }
      work_mode_active_for_profile: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      work_mode_condition_topics: { Args: never; Returns: string[] }
      work_mode_material_open: {
        Args: { p_section: string; p_topic_id: string }
        Returns: boolean
      }
      work_report_away: {
        Args: {
          p_away_seconds: number
          p_homework_id: string
          p_leaves: number
          p_mock_exam_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      attendance_status: "present" | "absent" | "late" | "excused"
      billing_cycle: "per_lesson" | "biweekly" | "monthly"
      course_material_kind: "text" | "video" | "link" | "file"
      enrollment_source: "purchase" | "manual" | "trial" | "gift"
      enrollment_status: "active" | "expired" | "cancelled" | "trial"
      exam_type:
        | "ege"
        | "oge"
        | "grade_7"
        | "grade_8"
        | "grade_9"
        | "grade_10"
        | "grade_11"
      group_type: "individual" | "pair" | "group"
      homework_ai_evaluation_status:
        | "confident"
        | "needs_review"
        | "unreadable"
        | "not_found"
      homework_ai_job_status:
        | "queued"
        | "preprocessing"
        | "extracting"
        | "evaluating"
        | "awaiting_teacher"
        | "completed"
        | "failed"
      homework_assignment_status: "draft" | "published" | "closed" | "cancelled"
      homework_attempt_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "returned_for_revision"
        | "accepted"
        | "rejected"
      homework_grading_mode:
        | "manual"
        | "exact_answer"
        | "numeric_tolerance"
        | "multiple_choice"
        | "formula"
        | "rubric"
        | "ai_assisted"
      homework_review_decision:
        | "accepted"
        | "returned_for_revision"
        | "rejected"
      homework_status: "not_submitted" | "submitted" | "checked" | "revision"
      homework_template_status: "draft" | "active" | "archived"
      league_type: "bronze" | "silver" | "gold" | "platinum" | "academic"
      lesson_format: "group" | "individual" | "pair" | "parallel"
      lesson_status: "scheduled" | "completed" | "cancelled" | "missed"
      notification_queue_status:
        | "pending"
        | "processing"
        | "sent"
        | "failed"
        | "cancelled"
      payment_status: "pending" | "paid" | "overdue" | "refunded"
      subject_type:
        | "physics"
        | "math"
        | "algebra"
        | "geometry"
        | "probability_statistics"
      topic_homework_attempt_status:
        | "draft"
        | "submitted"
        | "accepted"
        | "returned_for_revision"
      topic_homework_review_decision: "accepted" | "returned_for_revision"
      topic_test_attempt_status: "in_progress" | "completed"
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
      collection_item_input: {
        catalog_task_id: string | null
        position: number | null
        custom_number: string | null
      }
      homework_v2_row: {
        assignment_id: string | null
        template_id: string | null
        template_version_id: string | null
        template_title: string | null
        course_id: string | null
        group_id: string | null
        group_name: string | null
        student_id: string | null
        student_name: string | null
        status: Database["public"]["Enums"]["homework_assignment_status"] | null
        publish_at: string | null
        due_at: string | null
        due_at_override: string | null
        effective_due_at: string | null
        viewed_at: string | null
        is_excused: boolean | null
        max_attempts: number | null
        allow_late_submission: boolean | null
        attempts_count: number | null
        latest_attempt_id: string | null
        latest_attempt_number: number | null
        latest_attempt_status:
          | Database["public"]["Enums"]["homework_attempt_status"]
          | null
        latest_submitted_at: string | null
        latest_score: number | null
        latest_review_decision:
          | Database["public"]["Enums"]["homework_review_decision"]
          | null
        latest_review_comment: string | null
        latest_reviewed_at: string | null
        category: string | null
        overdue: boolean | null
      }
      variant_item_input: {
        task_id: string | null
        pos: number | null
        section_id: string | null
        topic_id: string | null
        points: number | null
      }
      variant_section_input: {
        section_id: string | null
        cnt: number | null
        topic_ids: string[] | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      attendance_status: ["present", "absent", "late", "excused"],
      billing_cycle: ["per_lesson", "biweekly", "monthly"],
      course_material_kind: ["text", "video", "link", "file"],
      enrollment_source: ["purchase", "manual", "trial", "gift"],
      enrollment_status: ["active", "expired", "cancelled", "trial"],
      exam_type: [
        "ege",
        "oge",
        "grade_7",
        "grade_8",
        "grade_9",
        "grade_10",
        "grade_11",
      ],
      group_type: ["individual", "pair", "group"],
      homework_ai_evaluation_status: [
        "confident",
        "needs_review",
        "unreadable",
        "not_found",
      ],
      homework_ai_job_status: [
        "queued",
        "preprocessing",
        "extracting",
        "evaluating",
        "awaiting_teacher",
        "completed",
        "failed",
      ],
      homework_assignment_status: ["draft", "published", "closed", "cancelled"],
      homework_attempt_status: [
        "draft",
        "submitted",
        "under_review",
        "returned_for_revision",
        "accepted",
        "rejected",
      ],
      homework_grading_mode: [
        "manual",
        "exact_answer",
        "numeric_tolerance",
        "multiple_choice",
        "formula",
        "rubric",
        "ai_assisted",
      ],
      homework_review_decision: [
        "accepted",
        "returned_for_revision",
        "rejected",
      ],
      homework_status: ["not_submitted", "submitted", "checked", "revision"],
      homework_template_status: ["draft", "active", "archived"],
      league_type: ["bronze", "silver", "gold", "platinum", "academic"],
      lesson_format: ["group", "individual", "pair", "parallel"],
      lesson_status: ["scheduled", "completed", "cancelled", "missed"],
      notification_queue_status: [
        "pending",
        "processing",
        "sent",
        "failed",
        "cancelled",
      ],
      payment_status: ["pending", "paid", "overdue", "refunded"],
      subject_type: [
        "physics",
        "math",
        "algebra",
        "geometry",
        "probability_statistics",
      ],
      topic_homework_attempt_status: [
        "draft",
        "submitted",
        "accepted",
        "returned_for_revision",
      ],
      topic_homework_review_decision: ["accepted", "returned_for_revision"],
      topic_test_attempt_status: ["in_progress", "completed"],
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
