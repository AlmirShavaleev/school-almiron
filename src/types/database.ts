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
      app_visits: {
        Row: {
          profile_id: string
          visited_on: string
        }
        Insert: {
          profile_id: string
          visited_on: string
        }
        Update: {
          profile_id?: string
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
          partial_type: string | null
          position: number
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
          partial_type?: string | null
          position?: number
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
          partial_type?: string | null
          position?: number
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
            foreignKeyName: "catalog_tasks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "catalog_sections"
            referencedColumns: ["id"]
          },
        ]
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
          is_default_for_direction: boolean
          is_draft: boolean
          owner_id: string | null
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
          is_default_for_direction?: boolean
          is_draft?: boolean
          owner_id?: string | null
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
          is_default_for_direction?: boolean
          is_draft?: boolean
          owner_id?: string | null
          price?: number
          start_date?: string | null
          subject?: Database["public"]["Enums"]["subject_type"]
          title?: string
        }
        Relationships: [
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
      enrollment_invites_cleanup_backup_20260803: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          batch_id: string | null
          class_grade: string | null
          client_row_id: string | null
          created_at: string | null
          email: string | null
          email_normalized: string | null
          expires_at: string | null
          full_name: string | null
          group_id: string | null
          id: string | null
          invited_by: string | null
          phone: string | null
          phone_normalized: string | null
          revoked_at: string | null
          short_code_hash: string | null
          status: string | null
          token_hash: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          batch_id?: string | null
          class_grade?: string | null
          client_row_id?: string | null
          created_at?: string | null
          email?: string | null
          email_normalized?: string | null
          expires_at?: string | null
          full_name?: string | null
          group_id?: string | null
          id?: string | null
          invited_by?: string | null
          phone?: string | null
          phone_normalized?: string | null
          revoked_at?: string | null
          short_code_hash?: string | null
          status?: string | null
          token_hash?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          batch_id?: string | null
          class_grade?: string | null
          client_row_id?: string | null
          created_at?: string | null
          email?: string | null
          email_normalized?: string | null
          expires_at?: string | null
          full_name?: string | null
          group_id?: string | null
          id?: string | null
          invited_by?: string | null
          phone?: string | null
          phone_normalized?: string | null
          revoked_at?: string | null
          short_code_hash?: string | null
          status?: string | null
          token_hash?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      group_students_cleanup_backup_20260803: {
        Row: {
          group_id: string | null
          id: string | null
          joined_at: string | null
          student_id: string | null
        }
        Insert: {
          group_id?: string | null
          id?: string | null
          joined_at?: string | null
          student_id?: string | null
        }
        Update: {
          group_id?: string | null
          id?: string | null
          joined_at?: string | null
          student_id?: string | null
        }
        Relationships: []
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
      groups_cleanup_backup_20260803: {
        Row: {
          course_id: string | null
          created_at: string | null
          curator_id: string | null
          id: string | null
          is_active: boolean | null
          max_students: number | null
          name: string | null
          schedule_days: string[] | null
          schedule_time: string | null
          teacher_id: string | null
          type: Database["public"]["Enums"]["group_type"] | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string | null
          curator_id?: string | null
          id?: string | null
          is_active?: boolean | null
          max_students?: number | null
          name?: string | null
          schedule_days?: string[] | null
          schedule_time?: string | null
          teacher_id?: string | null
          type?: Database["public"]["Enums"]["group_type"] | null
        }
        Update: {
          course_id?: string | null
          created_at?: string | null
          curator_id?: string | null
          id?: string | null
          is_active?: boolean | null
          max_students?: number | null
          name?: string | null
          schedule_days?: string[] | null
          schedule_time?: string | null
          teacher_id?: string | null
          type?: Database["public"]["Enums"]["group_type"] | null
        }
        Relationships: []
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
          student_assignment_id: string
          submitted_at: string | null
          teacher_comment: string | null
          variant_item_id: string
        }
        Insert: {
          answer_normalized?: string
          answer_raw?: string
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
          student_assignment_id: string
          submitted_at?: string | null
          teacher_comment?: string | null
          variant_item_id: string
        }
        Update: {
          answer_normalized?: string
          answer_raw?: string
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
        ]
      }
      topic_homework: {
        Row: {
          created_at: string
          created_by: string
          due_at: string | null
          grade_scale: string | null
          id: string
          instructions: string | null
          is_published: boolean
          title: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          due_at?: string | null
          grade_scale?: string | null
          id?: string
          instructions?: string | null
          is_published?: boolean
          title: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          due_at?: string | null
          grade_scale?: string | null
          id?: string
          instructions?: string | null
          is_published?: boolean
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
          id: string
          input_tokens: number | null
          last_error: string | null
          model: string | null
          output_tokens: number | null
          provider: string | null
          readable: boolean | null
          requested_by: string | null
          started_at: string | null
          status: string
          suggested_score: number | null
          summary: string | null
        }
        Insert: {
          accepted_at?: string | null
          attempt_id: string
          attempts?: number
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          last_error?: string | null
          model?: string | null
          output_tokens?: number | null
          provider?: string | null
          readable?: boolean | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          suggested_score?: number | null
          summary?: string | null
        }
        Update: {
          accepted_at?: string | null
          attempt_id?: string
          attempts?: number
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          last_error?: string | null
          model?: string | null
          output_tokens?: number | null
          provider?: string | null
          readable?: boolean | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          suggested_score?: number | null
          summary?: string | null
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
      topic_homework_files: {
        Row: {
          created_at: string
          homework_id: string
          id: string
          mime_type: string | null
          original_filename: string
          position: number
          size_bytes: number | null
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
          source_topic_material_id: string | null
          storage_path: string | null
          title: string | null
          topic_id: string
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
          source_topic_material_id?: string | null
          storage_path?: string | null
          title?: string | null
          topic_id: string
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
          source_topic_material_id?: string | null
          storage_path?: string | null
          title?: string | null
          topic_id?: string
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
      topics: {
        Row: {
          available_from: string | null
          created_at: string
          id: string
          is_open: boolean | null
          max_score: number
          module_id: string
          order_index: number
          source_template_id: string | null
          title: string
        }
        Insert: {
          available_from?: string | null
          created_at?: string
          id?: string
          is_open?: boolean | null
          max_score?: number
          module_id: string
          order_index?: number
          source_template_id?: string | null
          title: string
        }
        Update: {
          available_from?: string | null
          created_at?: string
          id?: string
          is_open?: boolean | null
          max_score?: number
          module_id?: string
          order_index?: number
          source_template_id?: string | null
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
      _accept_invite_core: {
        Args: { p_invite_id: string }
        Returns: {
          group_id: string
          invite_id: string
          student_id: string
        }[]
      }
      _current_teacher_id: { Args: never; Returns: string }
      _direction_label: {
        Args: {
          p_exam: Database["public"]["Enums"]["exam_type"]
          p_subject: Database["public"]["Enums"]["subject_type"]
        }
        Returns: string
      }
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
      _topic_homework_course_staff: {
        Args: { p_course_id: string }
        Returns: {
          profile_id: string
        }[]
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
      admin_school_stats: { Args: never; Returns: Json }
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
      cancel_variant_assignment: {
        Args: { p_assignment_id: string }
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
          id: string
          input_tokens: number | null
          last_error: string | null
          model: string | null
          output_tokens: number | null
          provider: string | null
          readable: boolean | null
          requested_by: string | null
          started_at: string | null
          status: string
          suggested_score: number | null
          summary: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "topic_homework_ai_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_telegram_tokens: { Args: never; Returns: undefined }
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
      course_default_module: { Args: { p_course_id: string }; Returns: string }
      course_delete_execute: { Args: { p_course_id: string }; Returns: Json }
      course_delete_preview: { Args: { p_course_id: string }; Returns: Json }
      course_is_admin: { Args: never; Returns: boolean }
      course_is_lesson_staff: {
        Args: { p_lesson_id: string }
        Returns: boolean
      }
      course_is_staff: { Args: { p_course_id: string }; Returns: boolean }
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
      course_staff_profiles: {
        Args: { p_course_id: string }
        Returns: {
          profile_id: string
        }[]
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
      realtime_review_topic_course: { Args: { topic: string }; Returns: string }
      record_app_visit: { Args: never; Returns: undefined }
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
      revoke_student_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      rollback_lesson_copy: { Args: { p_job_id: string }; Returns: Json }
      rotate_teacher_join_link: { Args: never; Returns: Json }
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
      strip_html_simple: { Args: { html: string }; Returns: string }
      submit_homework_review: {
        Args: {
          p_attempt_id: string
          p_comment: string
          p_decision: Database["public"]["Enums"]["homework_review_decision"]
          p_score: number
        }
        Returns: Json
      }
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
      topic_copy_stage: {
        Args: {
          p_mode?: string
          p_shift_days?: number
          p_source_topic_id: string
          p_target_module_id: string
        }
        Returns: Json
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
      topic_homework_attempt_is_own: {
        Args: { p_attempt_id: string }
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
      topic_homework_enqueue_reviewed: {
        Args: { p_review_id: string }
        Returns: number
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
      topic_homework_review_attempt: {
        Args: {
          p_attempt_id: string
          p_comment?: string
          p_decision: Database["public"]["Enums"]["topic_homework_review_decision"]
          p_score?: number
        }
        Returns: string
      }
      topic_homework_start_attempt: {
        Args: { p_homework_id: string }
        Returns: string
      }
      topic_homework_student_can_see: {
        Args: { p_homework_id: string }
        Returns: boolean
      }
      topic_homework_submit_attempt: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      topic_homework_topic: { Args: { p_homework_id: string }; Returns: string }
      topic_material_can_manage: {
        Args: { p_topic_id: string }
        Returns: boolean
      }
      topic_open_now: {
        Args: { p_available_from: string; p_is_open: boolean }
        Returns: boolean
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
