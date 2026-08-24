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
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_permissions: {
        Row: {
          created_at: string
          description: string | null
          key: string
          kind: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          kind?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          kind?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      ai_solutions: {
        Row: {
          content: Json
          created_at: string
          id: string
          question_id: string
          required_permission: string
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          question_id: string
          required_permission?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          question_id?: string
          required_permission?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_solutions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_solutions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_solutions_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      announcements: {
        Row: {
          author_id: string | null
          content: Json
          created_at: string
          id: string
          is_pinned: boolean
          required_permission: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          content: Json
          created_at?: string
          id?: string
          is_pinned?: boolean
          required_permission?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          content?: Json
          created_at?: string
          id?: string
          is_pinned?: boolean
          required_permission?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      answer_votes: {
        Row: {
          created_at: string
          question_id: string
          reason: string | null
          updated_at: string
          user_id: string
          voted_answer: number[]
        }
        Insert: {
          created_at?: string
          question_id: string
          reason?: string | null
          updated_at?: string
          user_id: string
          voted_answer: number[]
        }
        Update: {
          created_at?: string
          question_id?: string
          reason?: string | null
          updated_at?: string
          user_id?: string
          voted_answer?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "answer_votes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_votes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          assigned_by: string | null
          assignee_id: string
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          question_id: string
          required_permission: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          assignee_id: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          question_id: string
          required_permission?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          assignee_id?: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          question_id?: string
          required_permission?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      attempts: {
        Row: {
          attempt_number: number
          created_at: string
          id: string
          is_active: boolean
          is_correct: boolean | null
          question_id: string
          selected_answer: number[]
          self_grade: string | null
          time_spent_sec: number | null
          user_id: string
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_correct?: boolean | null
          question_id: string
          selected_answer?: number[]
          self_grade?: string | null
          time_spent_sec?: number | null
          user_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_correct?: boolean | null
          question_id?: string
          selected_answer?: number[]
          self_grade?: string | null
          time_spent_sec?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookmarks: {
        Row: {
          created_at: string
          question_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          question_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          question_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_deletion_audit: {
        Row: {
          actor_id: string | null
          application_name: string | null
          client_role: string | null
          deleted_at: string
          id: string
          request_id: string | null
          row_data: Json
          row_id: string
          session_user_name: string
          table_name: string
          transaction_id: number
          trigger_depth: number
        }
        Insert: {
          actor_id?: string | null
          application_name?: string | null
          client_role?: string | null
          deleted_at?: string
          id?: string
          request_id?: string | null
          row_data: Json
          row_id: string
          session_user_name: string
          table_name: string
          transaction_id: number
          trigger_depth: number
        }
        Update: {
          actor_id?: string | null
          application_name?: string | null
          client_role?: string | null
          deleted_at?: string
          id?: string
          request_id?: string | null
          row_data?: Json
          row_id?: string
          session_user_name?: string
          table_name?: string
          transaction_id?: number
          trigger_depth?: number
        }
        Relationships: []
      }
      daily_question_sets: {
        Row: {
          created_at: string
          date: string
          question_ids: string[]
        }
        Insert: {
          created_at?: string
          date: string
          question_ids: string[]
        }
        Update: {
          created_at?: string
          date?: string
          question_ids?: string[]
        }
        Relationships: []
      }
      discussion_bookmarks: {
        Row: {
          created_at: string
          discussion_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discussion_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          discussion_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_bookmarks_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_bookmarks_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_replies: {
        Row: {
          author_id: string
          content: Json
          created_at: string
          discussion_id: string
          id: string
          is_accepted: boolean
          is_deleted: boolean
          parent_id: string | null
          updated_at: string
          upvote_count: number
        }
        Insert: {
          author_id: string
          content: Json
          created_at?: string
          discussion_id: string
          id?: string
          is_accepted?: boolean
          is_deleted?: boolean
          parent_id?: string | null
          updated_at?: string
          upvote_count?: number
        }
        Update: {
          author_id?: string
          content?: Json
          created_at?: string
          discussion_id?: string
          id?: string
          is_accepted?: boolean
          is_deleted?: boolean
          parent_id?: string | null
          updated_at?: string
          upvote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "discussion_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "discussion_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_revisions: {
        Row: {
          category: string
          confusion_point: string | null
          content: Json
          discussion_id: string
          edited_at: string
          id: string
          title: string
        }
        Insert: {
          category: string
          confusion_point?: string | null
          content: Json
          discussion_id: string
          edited_at?: string
          id?: string
          title: string
        }
        Update: {
          category?: string
          confusion_point?: string | null
          content?: Json
          discussion_id?: string
          edited_at?: string
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_revisions_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_revisions_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions_feed"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_upvotes: {
        Row: {
          created_at: string
          discussion_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discussion_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          discussion_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_upvotes_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_upvotes_discussion_id_fkey"
            columns: ["discussion_id"]
            isOneToOne: false
            referencedRelation: "discussions_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_upvotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discussions: {
        Row: {
          author_id: string
          category: string
          confusion_point: string | null
          content: Json
          content_edited_at: string | null
          created_at: string
          id: string
          is_auto_answer_dispute: boolean
          question_id: string | null
          reply_count: number
          resolved_by: string | null
          status: string
          title: string
          updated_at: string
          upvote_count: number
          view_count: number
        }
        Insert: {
          author_id: string
          category?: string
          confusion_point?: string | null
          content: Json
          content_edited_at?: string | null
          created_at?: string
          id?: string
          is_auto_answer_dispute?: boolean
          question_id?: string | null
          reply_count?: number
          resolved_by?: string | null
          status?: string
          title: string
          updated_at?: string
          upvote_count?: number
          view_count?: number
        }
        Update: {
          author_id?: string
          category?: string
          confusion_point?: string | null
          content?: Json
          content_edited_at?: string | null
          created_at?: string
          id?: string
          is_auto_answer_dispute?: boolean
          question_id?: string | null
          reply_count?: number
          resolved_by?: string | null
          status?: string
          title?: string
          updated_at?: string
          upvote_count?: number
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "discussions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          content: Json
          created_at: string
          id: string
          target_key: string
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          target_key: string
          target_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          target_key?: string
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          cohort: string
          created_at: string
          created_by: string | null
          curriculum: string | null
          duration_min: number | null
          exam_code: string | null
          exam_date: string | null
          exam_name: string
          exam_subject_label: string | null
          format: string | null
          id: string
          overview: string | null
          required_permission: string | null
          restored_questions: number | null
          source_file_url: string | null
          source_page_end: number | null
          source_page_start: number | null
          status: string
          subject_id: string
          total_questions: number | null
          updated_at: string
        }
        Insert: {
          cohort: string
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          duration_min?: number | null
          exam_code?: string | null
          exam_date?: string | null
          exam_name?: string
          exam_subject_label?: string | null
          format?: string | null
          id?: string
          overview?: string | null
          required_permission?: string | null
          restored_questions?: number | null
          source_file_url?: string | null
          source_page_end?: number | null
          source_page_start?: number | null
          status?: string
          subject_id: string
          total_questions?: number | null
          updated_at?: string
        }
        Update: {
          cohort?: string
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          duration_min?: number | null
          exam_code?: string | null
          exam_date?: string | null
          exam_name?: string
          exam_subject_label?: string | null
          format?: string | null
          id?: string
          overview?: string | null
          required_permission?: string | null
          restored_questions?: number | null
          source_file_url?: string | null
          source_page_end?: number | null
          source_page_start?: number | null
          status?: string
          subject_id?: string
          total_questions?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "exams_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      inline_comments: {
        Row: {
          anchor_from: number | null
          anchor_to: number | null
          author_id: string
          content: string
          created_at: string
          id: string
          parent_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          selected_text: string | null
          solution_id: string
          status: string
          updated_at: string
        }
        Insert: {
          anchor_from?: number | null
          anchor_to?: number | null
          author_id: string
          content: string
          created_at?: string
          id?: string
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          selected_text?: string | null
          solution_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          anchor_from?: number | null
          anchor_to?: number | null
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          selected_text?: string | null
          solution_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inline_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inline_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "inline_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inline_comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inline_comments_solution_id_fkey"
            columns: ["solution_id"]
            isOneToOne: false
            referencedRelation: "solutions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_categories: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_documents: {
        Row: {
          byte_size: number | null
          category_id: string
          content_hash: string
          created_at: string
          created_by: string | null
          curriculum: string | null
          file_path: string
          id: string
          is_published: boolean
          lecture_year: number | null
          page_count: number | null
          professor: string | null
          required_permission: string | null
          sort_order: number
          text_content: string | null
          title: string
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          category_id: string
          content_hash: string
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          file_path: string
          id?: string
          is_published?: boolean
          lecture_year?: number | null
          page_count?: number | null
          professor?: string | null
          required_permission?: string | null
          sort_order?: number
          text_content?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          category_id?: string
          content_hash?: string
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          file_path?: string
          id?: string
          is_published?: boolean
          lecture_year?: number | null
          page_count?: number | null
          professor?: string | null
          required_permission?: string | null
          sort_order?: number
          text_content?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_documents_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "lecture_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_documents_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      lecture_page_texts: {
        Row: {
          created_at: string
          lecture_id: string
          page_number: number
          text_content: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          lecture_id: string
          page_number: number
          text_content?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          lecture_id?: string
          page_number?: number
          text_content?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_page_texts_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lecture_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_student_notes: {
        Row: {
          content_md: string
          content_text: string
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          lecture_date: string | null
          lecture_id: string
          required_permission: string
          sort_order: number
          source_course: string | null
          source_hash: string
          source_key: string
          title: string
          updated_at: string
        }
        Insert: {
          content_md: string
          content_text: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          lecture_date?: string | null
          lecture_id: string
          required_permission?: string
          sort_order?: number
          source_course?: string | null
          source_hash: string
          source_key: string
          title: string
          updated_at?: string
        }
        Update: {
          content_md?: string
          content_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          lecture_date?: string | null
          lecture_id?: string
          required_permission?: string
          sort_order?: number
          source_course?: string | null
          source_hash?: string
          source_key?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_student_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_student_notes_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lecture_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_student_notes_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      lecture_sources: {
        Row: {
          created_at: string
          curriculum: string | null
          id: string
          lecture_document_id: string | null
          professor: string | null
          sort_order: number
          source_key: string | null
          subject_id: string
          theory_document_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          curriculum?: string | null
          id?: string
          lecture_document_id?: string | null
          professor?: string | null
          sort_order?: number
          source_key?: string | null
          subject_id: string
          theory_document_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          curriculum?: string | null
          id?: string
          lecture_document_id?: string | null
          professor?: string | null
          sort_order?: number
          source_key?: string | null
          subject_id?: string
          theory_document_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_sources_lecture_document_id_fkey"
            columns: ["lecture_document_id"]
            isOneToOne: false
            referencedRelation: "lecture_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_sources_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_sources_theory_document_id_fkey"
            columns: ["theory_document_id"]
            isOneToOne: false
            referencedRelation: "theory_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          target_id: string | null
          target_type: string | null
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          target_id?: string | null
          target_type?: string | null
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          target_id?: string | null
          target_type?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_notes: {
        Row: {
          content: Json
          created_at: string
          group_id: string | null
          id: string
          question_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          group_id?: string | null
          id?: string
          question_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          group_id?: string | null
          id?: string
          question_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_notes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "question_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_notes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_notes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_permissions: {
        Row: {
          granted_at: string
          granted_by: string | null
          permission_key: string
          profile_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          permission_key: string
          profile_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          permission_key?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "profile_permissions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cohort: string | null
          created_at: string
          dedupe_identical: boolean
          default_solution_permission: string | null
          display_name: string
          email: string | null
          font_scale: number
          id: string
          is_suspended: boolean
          one_liner: string | null
          role: string
          theme: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cohort?: string | null
          created_at?: string
          dedupe_identical?: boolean
          default_solution_permission?: string | null
          display_name: string
          email?: string | null
          font_scale?: number
          id: string
          is_suspended?: boolean
          one_liner?: string | null
          role?: string
          theme?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cohort?: string | null
          created_at?: string
          dedupe_identical?: boolean
          default_solution_permission?: string | null
          display_name?: string
          email?: string | null
          font_scale?: number
          id?: string
          is_suspended?: boolean
          one_liner?: string | null
          role?: string
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_solution_permission_fkey"
            columns: ["default_solution_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      question_groups: {
        Row: {
          canonical_question_id: string | null
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          canonical_question_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          canonical_question_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_groups_canonical_fk"
            columns: ["canonical_question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_groups_canonical_fk"
            columns: ["canonical_question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      question_lecture_sources: {
        Row: {
          lecture_source_id: string
          question_id: string
          sort_order: number
        }
        Insert: {
          lecture_source_id: string
          question_id: string
          sort_order?: number
        }
        Update: {
          lecture_source_id?: string
          question_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_lecture_sources_lecture_source_id_fkey"
            columns: ["lecture_source_id"]
            isOneToOne: false
            referencedRelation: "lecture_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_lecture_sources_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_lecture_sources_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sets: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          instruction: string | null
          set_title: string | null
          shared_choices: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          instruction?: string | null
          set_title?: string | null
          shared_choices?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          instruction?: string | null
          set_title?: string | null
          shared_choices?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_sets_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          answer_count: number
          answer_note: string | null
          answer_status: string
          choices: Json
          completeness: string
          created_at: string
          created_by: string | null
          editor_answer: number[]
          exam_id: string
          grading_points: Json | null
          group_id: string | null
          id: string
          model_answer: string | null
          official_explanation: Json | null
          professor: string | null
          question_number: number
          question_type: string
          restorer_note: string | null
          same_as: string | null
          set_id: string | null
          source_tags: string[]
          status: string
          stem_blocks: Json
          stem_norm: string | null
          stem_text: string | null
          unit_id: string | null
          unit_source: string | null
          updated_at: string
          updated_by: string | null
          variant_note: string | null
          variant_type: string
          view_count: number
          yama_answer: number[] | null
        }
        Insert: {
          answer_count?: number
          answer_note?: string | null
          answer_status?: string
          choices?: Json
          completeness?: string
          created_at?: string
          created_by?: string | null
          editor_answer?: number[]
          exam_id: string
          grading_points?: Json | null
          group_id?: string | null
          id?: string
          model_answer?: string | null
          official_explanation?: Json | null
          professor?: string | null
          question_number: number
          question_type?: string
          restorer_note?: string | null
          same_as?: string | null
          set_id?: string | null
          source_tags?: string[]
          status?: string
          stem_blocks?: Json
          stem_norm?: string | null
          stem_text?: string | null
          unit_id?: string | null
          unit_source?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_note?: string | null
          variant_type?: string
          view_count?: number
          yama_answer?: number[] | null
        }
        Update: {
          answer_count?: number
          answer_note?: string | null
          answer_status?: string
          choices?: Json
          completeness?: string
          created_at?: string
          created_by?: string | null
          editor_answer?: number[]
          exam_id?: string
          grading_points?: Json | null
          group_id?: string | null
          id?: string
          model_answer?: string | null
          official_explanation?: Json | null
          professor?: string | null
          question_number?: number
          question_type?: string
          restorer_note?: string | null
          same_as?: string | null
          set_id?: string | null
          source_tags?: string[]
          status?: string
          stem_blocks?: Json
          stem_norm?: string | null
          stem_text?: string | null
          unit_id?: string | null
          unit_source?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_note?: string | null
          variant_type?: string
          view_count?: number
          yama_answer?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "question_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_same_as_fkey"
            columns: ["same_as"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_same_as_fkey"
            columns: ["same_as"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_upvotes: {
        Row: {
          created_at: string
          reply_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          reply_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          reply_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reply_upvotes_reply_id_fkey"
            columns: ["reply_id"]
            isOneToOne: false
            referencedRelation: "discussion_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_upvotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          handled_by: string | null
          id: string
          reason: string | null
          reporter_id: string | null
          status: string
          target_id: string
          target_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          handled_by?: string | null
          id?: string
          reason?: string | null
          reporter_id?: string | null
          status?: string
          target_id: string
          target_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          handled_by?: string | null
          id?: string
          reason?: string | null
          reporter_id?: string | null
          status?: string
          target_id?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revisions: {
        Row: {
          change_summary: string | null
          created_at: string
          diff: Json
          editor_id: string | null
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          change_summary?: string | null
          created_at?: string
          diff?: Json
          editor_id?: string | null
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          change_summary?: string | null
          created_at?: string
          diff?: Json
          editor_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revisions_editor_id_fkey"
            columns: ["editor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      senior_solutions: {
        Row: {
          content: Json
          created_at: string
          id: string
          question_id: string
          required_permission: string
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          question_id: string
          required_permission?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          question_id?: string
          required_permission?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "senior_solutions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "senior_solutions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "senior_solutions_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      senior_solutions_backup_20260816: {
        Row: {
          content: Json | null
          id: string | null
          question_id: string | null
        }
        Insert: {
          content?: Json | null
          id?: string | null
          question_id?: string | null
        }
        Update: {
          content?: Json | null
          id?: string | null
          question_id?: string | null
        }
        Relationships: []
      }
      senior_solutions_pending: {
        Row: {
          content: Json
          created_at: string
          question_code: string
          required_permission: string
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          question_code: string
          required_permission?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          question_code?: string
          required_permission?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "senior_solutions_pending_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      solution_upvotes: {
        Row: {
          created_at: string
          solution_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          solution_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          solution_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solution_upvotes_solution_id_fkey"
            columns: ["solution_id"]
            isOneToOne: false
            referencedRelation: "solutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solution_upvotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      solutions: {
        Row: {
          author_id: string
          content: Json
          created_at: string
          edited_at: string | null
          group_id: string | null
          id: string
          is_verified: boolean
          question_id: string | null
          references: Json | null
          required_permission: string | null
          updated_at: string
          upvote_count: number
        }
        Insert: {
          author_id: string
          content: Json
          created_at?: string
          edited_at?: string | null
          group_id?: string | null
          id?: string
          is_verified?: boolean
          question_id?: string | null
          references?: Json | null
          required_permission?: string | null
          updated_at?: string
          upvote_count?: number
        }
        Update: {
          author_id?: string
          content?: Json
          created_at?: string
          edited_at?: string | null
          group_id?: string | null
          id?: string
          is_verified?: boolean
          question_id?: string | null
          references?: Json | null
          required_permission?: string | null
          updated_at?: string
          upvote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "solutions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solutions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "question_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solutions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solutions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solutions_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      solutions_pending: {
        Row: {
          author_id: string
          content: Json
          created_at: string
          id: string
          question_code: string
          references: Json | null
          required_permission: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          content: Json
          created_at?: string
          id?: string
          question_code: string
          references?: Json | null
          required_permission?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: Json
          created_at?: string
          id?: string
          question_code?: string
          references?: Json | null
          required_permission?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solutions_pending_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solutions_pending_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      study_sessions: {
        Row: {
          created_at: string
          current_index: number
          finished_at: string | null
          id: string
          mode: string
          question_ids: string[]
          scope: Json
          started_at: string
          status: string
          time_limit_sec: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_index?: number
          finished_at?: string | null
          id?: string
          mode: string
          question_ids?: string[]
          scope?: Json
          started_at?: string
          status?: string
          time_limit_sec?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_index?: number
          finished_at?: string | null
          id?: string
          mode?: string
          question_ids?: string[]
          scope?: Json
          started_at?: string
          status?: string
          time_limit_sec?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string | null
          created_at: string
          icon_key: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          icon_key?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          icon_key?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      text_marks: {
        Row: {
          anchor_from: number
          anchor_to: number
          created_at: string
          id: string
          selected_text: string | null
          style: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          anchor_from: number
          anchor_to: number
          created_at?: string
          id?: string
          selected_text?: string | null
          style: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          anchor_from?: number
          anchor_to?: number
          created_at?: string
          id?: string
          selected_text?: string | null
          style?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_marks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      theory_backup_gynecology_20260821: {
        Row: {
          content: Json | null
          created_at: string | null
          created_by: string | null
          has_content: boolean | null
          id: string | null
          is_published: boolean | null
          parent_id: string | null
          required_permission: string | null
          sort_order: number | null
          source_key: string | null
          subject_id: string | null
          title: string | null
          unit_id: string | null
          updated_at: string | null
        }
        Insert: {
          content?: Json | null
          created_at?: string | null
          created_by?: string | null
          has_content?: boolean | null
          id?: string | null
          is_published?: boolean | null
          parent_id?: string | null
          required_permission?: string | null
          sort_order?: number | null
          source_key?: string | null
          subject_id?: string | null
          title?: string | null
          unit_id?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: Json | null
          created_at?: string | null
          created_by?: string | null
          has_content?: boolean | null
          id?: string | null
          is_published?: boolean | null
          parent_id?: string | null
          required_permission?: string | null
          sort_order?: number | null
          source_key?: string | null
          subject_id?: string | null
          title?: string | null
          unit_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      theory_documents: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          has_content: boolean
          id: string
          is_published: boolean
          parent_id: string | null
          required_permission: string
          sort_order: number
          source_key: string | null
          subject_id: string
          title: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          has_content?: boolean
          id?: string
          is_published?: boolean
          parent_id?: string | null
          required_permission?: string
          sort_order?: number
          source_key?: string | null
          subject_id: string
          title: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          has_content?: boolean
          id?: string
          is_published?: boolean
          parent_id?: string | null
          required_permission?: string
          sort_order?: number
          source_key?: string | null
          subject_id?: string
          title?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "theory_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theory_documents_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "theory_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theory_documents_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "theory_documents_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theory_documents_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_questions: {
        Row: {
          position: number
          question_id: string
          topic_id: string
        }
        Insert: {
          position?: number
          question_id: string
          topic_id: string
        }
        Update: {
          position?: number
          question_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_questions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_units: {
        Row: {
          topic_id: string
          unit_id: string
        }
        Insert: {
          topic_id: string
          unit_id: string
        }
        Update: {
          topic_id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_units_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          required_permission: string
          subject_id: string
          title: string
          unit_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          required_permission?: string
          subject_id: string
          title: string
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          required_permission?: string
          subject_id?: string
          title?: string
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_required_permission_fkey"
            columns: ["required_permission"]
            isOneToOne: false
            referencedRelation: "access_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "topics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      update_notice_dismissals: {
        Row: {
          dismissed_at: string
          notice_key: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          notice_key: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          notice_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "update_notice_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          created_at: string
          group_name: string | null
          id: string
          name: string
          sort_order: number
          subject_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_name?: string | null
          id?: string
          name: string
          sort_order?: number
          subject_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_name?: string | null
          id?: string
          name?: string
          sort_order?: number
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      discussions_feed: {
        Row: {
          author_id: string | null
          category: string | null
          confusion_point: string | null
          content: Json | null
          content_edited_at: string | null
          created_at: string | null
          id: string | null
          question_cohort: string | null
          question_exam_id: string | null
          question_id: string | null
          question_number: number | null
          question_stem_text: string | null
          question_subject_id: string | null
          question_unit_id: string | null
          reply_count: number | null
          status: string | null
          title: string | null
          updated_at: string | null
          upvote_count: number | null
          view_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discussions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_subject_id_fkey"
            columns: ["question_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_exam_id_fkey"
            columns: ["question_exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_unit_id_fkey"
            columns: ["question_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      questions_solve: {
        Row: {
          answer_count: number | null
          answer_status: string | null
          choices: Json | null
          completeness: string | null
          created_at: string | null
          created_by: string | null
          exam_id: string | null
          group_id: string | null
          id: string | null
          professor: string | null
          question_code: string | null
          question_number: number | null
          question_type: string | null
          restorer_note: string | null
          same_as: string | null
          set_id: string | null
          source_tags: string[] | null
          status: string | null
          stem_blocks: Json | null
          stem_text: string | null
          unit_id: string | null
          unit_source: string | null
          updated_at: string | null
          updated_by: string | null
          variant_note: string | null
          variant_type: string | null
          view_count: number | null
        }
        Insert: {
          answer_count?: number | null
          answer_status?: string | null
          choices?: Json | null
          completeness?: string | null
          created_at?: string | null
          created_by?: string | null
          exam_id?: string | null
          group_id?: string | null
          id?: string | null
          professor?: string | null
          question_code?: never
          question_number?: number | null
          question_type?: string | null
          restorer_note?: string | null
          same_as?: string | null
          set_id?: string | null
          source_tags?: string[] | null
          status?: string | null
          stem_blocks?: Json | null
          stem_text?: string | null
          unit_id?: string | null
          unit_source?: string | null
          updated_at?: string | null
          updated_by?: string | null
          variant_note?: string | null
          variant_type?: string | null
          view_count?: number | null
        }
        Update: {
          answer_count?: number | null
          answer_status?: string | null
          choices?: Json | null
          completeness?: string | null
          created_at?: string | null
          created_by?: string | null
          exam_id?: string | null
          group_id?: string | null
          id?: string | null
          professor?: string | null
          question_code?: never
          question_number?: number | null
          question_type?: string | null
          restorer_note?: string | null
          same_as?: string | null
          set_id?: string | null
          source_tags?: string[] | null
          status?: string | null
          stem_blocks?: Json | null
          stem_text?: string | null
          unit_id?: string | null
          unit_source?: string | null
          updated_at?: string | null
          updated_by?: string | null
          variant_note?: string | null
          variant_type?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "question_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_same_as_fkey"
            columns: ["same_as"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_same_as_fkey"
            columns: ["same_as"]
            isOneToOne: false
            referencedRelation: "questions_solve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_get_deletion_audit: { Args: { p_audit_id: string }; Returns: Json }
      admin_list_assignment_members: {
        Args: never
        Returns: {
          cohort: string
          display_name: string
          id: string
        }[]
      }
      admin_list_deletion_audit: {
        Args: { p_limit?: number }
        Returns: {
          actor_display_name: string
          actor_id: string
          client_role: string
          deleted_at: string
          id: string
          request_id: string
          row_id: string
          table_name: string
          transaction_id: number
          trigger_depth: number
        }[]
      }
      admin_list_members: {
        Args: never
        Returns: {
          attempt_count: number
          avatar_url: string
          created_at: string
          display_name: string
          email: string
          id: string
          is_suspended: boolean
          last_active_at: string
          permission_keys: string[]
          role: string
          solution_count: number
        }[]
      }
      admin_list_storage_objects: {
        Args: { p_after?: string; p_bucket: string; p_limit?: number }
        Returns: {
          mime_type: string
          object_name: string
          size_bytes: number
          updated_at: string
        }[]
      }
      admin_resolve_report: {
        Args: { p_report_id: string; p_status: string }
        Returns: undefined
      }
      admin_set_permission: {
        Args: {
          p_enabled: boolean
          p_permission_key: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      admin_set_suspended: {
        Args: { p_suspended: boolean; p_user_id: string }
        Returns: undefined
      }
      answers_differ: {
        Args: { editor_answer: number[]; yama_answer: number[] }
        Returns: boolean
      }
      authorize_storage_object: {
        Args: { p_bucket: string; p_object_name: string; p_operation?: string }
        Returns: boolean
      }
      can_cluster: { Args: never; Returns: boolean }
      can_edit_topic: { Args: { p_permission: string }; Returns: boolean }
      can_read_exam_source: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      can_read_lecture_document: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      can_read_lecture_file: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      can_read_question_image: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      can_read_solution_image: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      can_view_exam: { Args: { p_exam_id: string }; Returns: boolean }
      can_view_question: { Args: { p_question_id: string }; Returns: boolean }
      can_view_solution: { Args: { p_solution_id: string }; Returns: boolean }
      can_view_solution_target: {
        Args: { p_group_id: string; p_question_id: string }
        Returns: boolean
      }
      can_write: { Args: never; Returns: boolean }
      circled_answer: { Args: { a: number[] }; Returns: string }
      cluster_attach: {
        Args: { p_anchor_id: string; p_target_id: string; p_variant: string }
        Returns: string
      }
      cluster_detach: { Args: { p_question_id: string }; Returns: undefined }
      cluster_ensure_group: { Args: { p_question_id: string }; Returns: string }
      cluster_set_note: {
        Args: { p_note: string; p_question_id: string }
        Returns: undefined
      }
      count_my_open_assignments: { Args: never; Returns: number }
      create_notification: {
        Args: {
          p_actor_id: string
          p_message: string
          p_target_id: string
          p_target_type: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      effective_answer: {
        Args: { q: Database["public"]["Tables"]["questions"]["Row"] }
        Returns: number[]
      }
      find_similar_questions: {
        Args: { p_limit?: number; p_question_id: string; p_threshold?: number }
        Returns: {
          cohort: string
          exam_id: string
          question_id: string
          question_number: number
          similarity: number
          subject_name: string
        }[]
      }
      get_admin_stats: { Args: never; Returns: Json }
      get_assignment_progress: {
        Args: never
        Returns: {
          assignee_id: string
          display_name: string
          done: number
          overdue: number
          total: number
        }[]
      }
      get_daily_challenge_leaderboard: {
        Args: { p_limit?: number }
        Returns: Json
      }
      get_daily_challenge_stats: { Args: { p_user_id?: string }; Returns: Json }
      get_daily_question_set: { Args: { p_date?: string }; Returns: Json }
      get_my_assignments: {
        Args: never
        Returns: {
          assignment_id: string
          cohort: string
          completed_at: string
          curriculum: string
          due_date: string
          exam_date: string
          exam_id: string
          exam_name: string
          exam_subject_label: string
          has_my_solution: boolean
          question_id: string
          question_number: number
          question_type: string
          required_permission: string
          status: string
          stem_preview: string
          subject_id: string
          subject_name: string
          unit_id: string
          unit_name: string
        }[]
      }
      get_my_profile: {
        Args: never
        Returns: {
          avatar_url: string | null
          cohort: string | null
          created_at: string
          dedupe_identical: boolean
          default_solution_permission: string | null
          display_name: string
          email: string | null
          font_scale: number
          id: string
          is_suspended: boolean
          one_liner: string | null
          role: string
          theme: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_question_states: {
        Args: { p_question_ids: string[] }
        Returns: {
          attempts: number
          is_correct: boolean
          question_id: string
        }[]
      }
      get_my_summary: { Args: never; Returns: Json }
      get_progress_by_exam: {
        Args: never
        Returns: {
          correct_questions: number
          exam_id: string
          solved_questions: number
          total_questions: number
        }[]
      }
      get_progress_by_unit: {
        Args: never
        Returns: {
          correct_questions: number
          solved_questions: number
          subject_id: string
          total_questions: number
          unit_id: string
        }[]
      }
      get_question_for_edit: { Args: { p_question_id: string }; Returns: Json }
      get_question_lecture_sources: {
        Args: { p_question_id: string }
        Returns: {
          id: string
          lecture_document_id: string
          lecture_page_count: number
          professor: string
          theory_document_id: string
          title: string
        }[]
      }
      get_question_stats: { Args: { p_question_id: string }; Returns: Json }
      get_wrong_notes: {
        Args: {
          p_cohort?: string
          p_exam_id?: string
          p_subject_id?: string
          p_unit_id?: string
        }
        Returns: {
          answer_status: string
          exam_id: string
          last_attempt_at: string
          last_is_correct: boolean
          question_id: string
          question_number: number
          recent_all_wrong: boolean
          stem_text: string
          total_attempts: number
          unit_id: string
          wrong_count: number
        }[]
      }
      has_content_access: {
        Args: { p_permission_key: string }
        Returns: boolean
      }
      has_permission: { Args: { p_permission_key: string }; Returns: boolean }
      increment_discussion_view: {
        Args: { p_discussion_id: string }
        Returns: undefined
      }
      increment_question_view: {
        Args: { p_question_id: string }
        Returns: undefined
      }
      is_active_member: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_display_name_available: { Args: { p_name: string }; Returns: boolean }
      lecture_search_snippet: {
        Args: { input_text: string; query_text: string; radius?: number }
        Returns: string
      }
      list_profile_cards: {
        Args: never
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          one_liner: string
        }[]
      }
      normalize_search_text: { Args: { input: string }; Returns: string }
      normalize_stem: { Args: { blocks: Json }; Returns: string }
      question_code: {
        Args: { q: Database["public"]["Tables"]["questions"]["Row"] }
        Returns: string
      }
      question_code_for: {
        Args: { p_exam_id: string; p_question_number: number }
        Returns: string
      }
      reset_progress: {
        Args: { p_exam_id?: string; p_subject_id?: string; p_unit_id?: string }
        Returns: number
      }
      reveal_answer: { Args: { p_question_id: string }; Returns: Json }
      reveal_answers: {
        Args: { p_question_ids: string[] }
        Returns: {
          answer_note: string
          answer_status: string
          editor_answer: number[]
          grading_points: Json
          model_answer: string
          official_explanation: Json
          question_id: string
          yama_answer: number[]
        }[]
      }
      revert_question_revision: {
        Args: { p_revision_id: string }
        Returns: undefined
      }
      richtext_plain: { Args: { doc: Json }; Returns: string }
      search_lecture_documents: {
        Args: {
          p_category_id?: string
          p_limit?: number
          p_professor?: string
          p_query: string
          p_year?: number
        }
        Returns: {
          byte_size: number
          category_id: string
          curriculum: string
          file_path: string
          id: string
          is_published: boolean
          lecture_year: number
          match_page: number
          match_page_count: number
          match_snippet: string
          note_match_count: number
          note_match_id: string
          note_match_snippet: string
          note_match_title: string
          page_count: number
          professor: string
          required_permission: string
          title: string
          updated_at: string
        }[]
      }
      search_theory_documents: {
        Args: {
          p_limit?: number
          p_query: string
          p_subject_id?: string
        }
        Returns: {
          id: string
          score: number
          snippet: string
          subject_id: string
          title: string
          unit_id: string
        }[]
      }
      search_questions: {
        Args: {
          p_cohort?: string
          p_include_solutions?: boolean
          p_limit?: number
          p_query: string
          p_subject_id?: string
        }
        Returns: {
          exam_id: string
          matched_in: string
          question_id: string
          question_number: number
          score: number
          snippet: string
          stem_text: string
          unit_id: string
        }[]
      }
      stem_plain_text: { Args: { blocks: Json }; Returns: string }
      submit_attempt: {
        Args: {
          p_question_id: string
          p_selected?: number[]
          p_self_grade?: string
          p_time_spent_sec?: number
        }
        Returns: Json
      }
      topics_for_question: {
        Args: { p_question_id: string }
        Returns: {
          content: Json
          id: string
          subject_id: string
          title: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
