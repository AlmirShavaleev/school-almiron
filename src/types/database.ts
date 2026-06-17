// Minimal Database type for Supabase client typing
export interface Database {
  public: {
    Tables: {
      profiles: { Row: any; Insert: any; Update: any }
      students: { Row: any; Insert: any; Update: any }
      parents: { Row: any; Insert: any; Update: any }
      parent_students: { Row: any; Insert: any; Update: any }
      teachers: { Row: any; Insert: any; Update: any }
      curators: { Row: any; Insert: any; Update: any }
      courses: { Row: any; Insert: any; Update: any }
      modules: { Row: any; Insert: any; Update: any }
      topics: { Row: any; Insert: any; Update: any }
      groups: { Row: any; Insert: any; Update: any }
      group_students: { Row: any; Insert: any; Update: any }
      lessons: { Row: any; Insert: any; Update: any }
      attendance: { Row: any; Insert: any; Update: any }
      homeworks: { Row: any; Insert: any; Update: any }
      homework_submissions: { Row: any; Insert: any; Update: any }
      mock_exams: { Row: any; Insert: any; Update: any }
      mock_exam_results: { Row: any; Insert: any; Update: any }
      achievements: { Row: any; Insert: any; Update: any }
      student_achievements: { Row: any; Insert: any; Update: any }
      payments: { Row: any; Insert: any; Update: any }
      leaderboard_points: { Row: any; Insert: any; Update: any }
      recommendations: { Row: any; Insert: any; Update: any }
      notifications: { Row: any; Insert: any; Update: any }
      webhook_logs: { Row: any; Insert: any; Update: any }
    }
    Views: {}
    Functions: {}
    Enums: {}
  }
}
