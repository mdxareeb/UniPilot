export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          sources: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          sources?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          sources?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          created_at: string
          id: string
          scope_document_id: string | null
          scope_subject_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          scope_document_id?: string | null
          scope_subject_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          scope_document_id?: string | null
          scope_subject_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_sessions_scope_document_id_fkey"
            columns: ["scope_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_sessions_scope_subject_id_fkey"
            columns: ["scope_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_actions: {
        Row: {
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          message_id: string | null
          payload: Json
          proposed_at: string
          result: Json | null
          settled_at: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          message_id?: string | null
          payload: Json
          proposed_at?: string
          result?: Json | null
          settled_at?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          message_id?: string | null
          payload?: Json
          proposed_at?: string
          result?: Json | null
          settled_at?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          page: number | null
          updated_at: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          page?: number | null
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          page?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_summary: string | null
          created_at: string
          error_message: string | null
          file_sha256: string | null
          id: string
          mime_type: string | null
          name: string
          page_count: number | null
          size_bytes: number | null
          source: string
          source_message_id: string | null
          status: string
          storage_path: string | null
          subject_id: string | null
          topic_tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          error_message?: string | null
          file_sha256?: string | null
          id?: string
          mime_type?: string | null
          name: string
          page_count?: number | null
          size_bytes?: number | null
          source?: string
          source_message_id?: string | null
          status?: string
          storage_path?: string | null
          subject_id?: string | null
          topic_tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          error_message?: string | null
          file_sha256?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          page_count?: number | null
          size_bytes?: number | null
          source?: string
          source_message_id?: string | null
          status?: string
          storage_path?: string | null
          subject_id?: string | null
          topic_tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "raw_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          confidence_score: number | null
          created_at: string
          description: string | null
          end_at: string | null
          google_event_id: string | null
          id: string
          location: string | null
          source: string
          source_action_id: string | null
          source_document_id: string | null
          source_message_id: string | null
          source_ref: string | null
          start_at: string
          subject_id: string | null
          title: string
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          google_event_id?: string | null
          id?: string
          location?: string | null
          source?: string
          source_action_id?: string | null
          source_document_id?: string | null
          source_message_id?: string | null
          source_ref?: string | null
          start_at: string
          subject_id?: string | null
          title: string
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          google_event_id?: string | null
          id?: string
          location?: string | null
          source?: string
          source_action_id?: string | null
          source_document_id?: string | null
          source_message_id?: string | null
          source_ref?: string | null
          start_at?: string
          subject_id?: string | null
          title?: string
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_source_action_id_fkey"
            columns: ["source_action_id"]
            isOneToOne: false
            referencedRelation: "assistant_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "raw_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_credentials: {
        Row: {
          calendar_id: string
          connected_at: string
          refresh_token_enc: string
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id?: string
          connected_at?: string
          refresh_token_enc: string
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string
          connected_at?: string
          refresh_token_enc?: string
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_calendars: {
        Row: {
          activated_at: string | null
          created_at: string
          google_calendar_id: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          summary: string
          sync_cursor: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          google_calendar_id: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          summary?: string
          sync_cursor?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          google_calendar_id?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          summary?: string
          sync_cursor?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          provider: string
          return_scheme: string
          state_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          provider: string
          return_scheme: string
          state_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          provider?: string
          return_scheme?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_candidates: {
        Row: {
          all_day: boolean
          confidence: number | null
          created_at: string
          end_at: string | null
          event_id: string | null
          event_type: string | null
          fingerprint: string
          group_name: string | null
          id: string
          kind: string
          message_id: string | null
          message_sender: string
          message_text: string
          origin: string
          proposed_subject_name: string | null
          provider_event_id: string | null
          push_error: string | null
          pushed_at: string | null
          run_id: string | null
          source_message_id: string | null
          start_at: string | null
          status: string
          subject_id: string | null
          task_type: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          confidence?: number | null
          created_at?: string
          end_at?: string | null
          event_id?: string | null
          event_type?: string | null
          fingerprint: string
          group_name?: string | null
          id?: string
          kind?: string
          message_id?: string | null
          message_sender: string
          message_text: string
          origin?: string
          proposed_subject_name?: string | null
          provider_event_id?: string | null
          push_error?: string | null
          pushed_at?: string | null
          run_id?: string | null
          source_message_id?: string | null
          start_at?: string | null
          status?: string
          subject_id?: string | null
          task_type?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          confidence?: number | null
          created_at?: string
          end_at?: string | null
          event_id?: string | null
          event_type?: string | null
          fingerprint?: string
          group_name?: string | null
          id?: string
          kind?: string
          message_id?: string | null
          message_sender?: string
          message_text?: string
          origin?: string
          proposed_subject_name?: string | null
          provider_event_id?: string | null
          push_error?: string | null
          pushed_at?: string | null
          run_id?: string | null
          source_message_id?: string | null
          start_at?: string | null
          status?: string
          subject_id?: string | null
          task_type?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_candidates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_candidates_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "integration_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "integration_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_candidates_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "raw_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_candidates_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          auto_export_to_gcal: boolean
          created_at: string
          date_order: string
          detect_relative_dates: boolean
          export_calendar_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          mode: string | null
          profile_ref: string | null
          provider: string
          qr_data_enc: string | null
          qr_expires_at: string | null
          review_mode: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_export_to_gcal?: boolean
          created_at?: string
          date_order?: string
          detect_relative_dates?: boolean
          export_calendar_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          mode?: string | null
          profile_ref?: string | null
          provider: string
          qr_data_enc?: string | null
          qr_expires_at?: string | null
          review_mode?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_export_to_gcal?: boolean
          created_at?: string
          date_order?: string
          detect_relative_dates?: boolean
          export_calendar_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          mode?: string | null
          profile_ref?: string | null
          provider?: string
          qr_data_enc?: string | null
          qr_expires_at?: string | null
          review_mode?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          position: number
          run_id: string
          sender: string
          sent_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          position: number
          run_id: string
          sender: string
          sent_at: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          position?: number
          run_id?: string
          sender?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "integration_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_runs: {
        Row: {
          candidate_count: number
          chat_name: string | null
          completed_at: string | null
          connection_id: string | null
          created_at: string
          error: string | null
          id: string
          message_count: number
          mode: string
          review_mode: string
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_count?: number
          chat_name?: string | null
          completed_at?: string | null
          connection_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message_count?: number
          mode: string
          review_mode?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_count?: number
          chat_name?: string | null
          completed_at?: string | null
          connection_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message_count?: number
          mode?: string
          review_mode?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_after: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          run_after?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          run_after?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          sources: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          sources?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          sources?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_groups: {
        Row: {
          activated_at: string | null
          created_at: string
          group_jid: string
          group_name: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          group_jid: string
          group_name?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          group_jid?: string
          group_name?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          href: string | null
          id: string
          kind: string
          read_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind: string
          read_at?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      presentations: {
        Row: {
          created_at: string
          document_id: string | null
          error_message: string | null
          export_error_message: string | null
          export_status: string | null
          exported_at: string | null
          format: string
          id: string
          include_table_of_contents: boolean
          include_title_slide: boolean
          instructions: string | null
          language: string | null
          n_slides: number | null
          presenton_presentation_id: string | null
          presenton_task_id: string | null
          prompt: string
          slides_done: number | null
          slides_total: number | null
          source_document_ids: string[]
          status: string
          template: string
          tone: string | null
          updated_at: string
          user_id: string
          verbosity: string | null
          web_search: boolean
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          error_message?: string | null
          export_error_message?: string | null
          export_status?: string | null
          exported_at?: string | null
          format?: string
          id?: string
          include_table_of_contents?: boolean
          include_title_slide?: boolean
          instructions?: string | null
          language?: string | null
          n_slides?: number | null
          presenton_presentation_id?: string | null
          presenton_task_id?: string | null
          prompt: string
          slides_done?: number | null
          slides_total?: number | null
          source_document_ids?: string[]
          status?: string
          template?: string
          tone?: string | null
          updated_at?: string
          user_id: string
          verbosity?: string | null
          web_search?: boolean
        }
        Update: {
          created_at?: string
          document_id?: string | null
          error_message?: string | null
          export_error_message?: string | null
          export_status?: string | null
          exported_at?: string | null
          format?: string
          id?: string
          include_table_of_contents?: boolean
          include_title_slide?: boolean
          instructions?: string | null
          language?: string | null
          n_slides?: number | null
          presenton_presentation_id?: string | null
          presenton_task_id?: string | null
          prompt?: string
          slides_done?: number | null
          slides_total?: number | null
          source_document_ids?: string[]
          status?: string
          template?: string
          tone?: string | null
          updated_at?: string
          user_id?: string
          verbosity?: string | null
          web_search?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "presentations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          academic_year: number | null
          course_program: string | null
          created_at: string
          first_name: string | null
          id: string
          institution: string | null
          last_name: string | null
          onboarding_completed_at: string | null
          planning_style: string | null
          reminder_lead: string | null
          semester: number | null
          timezone: string
          updated_at: string
        }
        Insert: {
          academic_year?: number | null
          course_program?: string | null
          created_at?: string
          first_name?: string | null
          id: string
          institution?: string | null
          last_name?: string | null
          onboarding_completed_at?: string | null
          planning_style?: string | null
          reminder_lead?: string | null
          semester?: number | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          academic_year?: number | null
          course_program?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          institution?: string | null
          last_name?: string | null
          onboarding_completed_at?: string | null
          planning_style?: string | null
          reminder_lead?: string | null
          semester?: number | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      raw_messages: {
        Row: {
          created_at: string
          error: string | null
          file_sha256: string | null
          fingerprint: string
          group_jid: string
          id: string
          media_type: string
          raw_text: string
          sender_name: string
          sent_at: string
          status: string
          updated_at: string
          user_id: string
          whatsapp_msg_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          file_sha256?: string | null
          fingerprint: string
          group_jid: string
          id?: string
          media_type?: string
          raw_text?: string
          sender_name?: string
          sent_at: string
          status?: string
          updated_at?: string
          user_id: string
          whatsapp_msg_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          file_sha256?: string | null
          fingerprint?: string
          group_jid?: string
          id?: string
          media_type?: string
          raw_text?: string
          sender_name?: string
          sent_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          whatsapp_msg_id?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          aliases: string[]
          color_tag: string | null
          course_code: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aliases?: string[]
          color_tag?: string | null
          course_code?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aliases?: string[]
          color_tag?: string | null
          course_code?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          plan: string
          provider: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          confidence_score: number | null
          created_at: string
          description: string | null
          due_date: string | null
          effort_minutes: number | null
          google_event_id: string | null
          id: string
          priority: string | null
          source: string
          source_action_id: string | null
          source_document_id: string | null
          source_message_id: string | null
          source_ref: string | null
          status: string
          subject_id: string | null
          task_type: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          effort_minutes?: number | null
          google_event_id?: string | null
          id?: string
          priority?: string | null
          source?: string
          source_action_id?: string | null
          source_document_id?: string | null
          source_message_id?: string | null
          source_ref?: string | null
          status?: string
          subject_id?: string | null
          task_type?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          effort_minutes?: number | null
          google_event_id?: string | null
          id?: string
          priority?: string | null
          source?: string
          source_action_id?: string | null
          source_document_id?: string | null
          source_message_id?: string | null
          source_ref?: string | null
          status?: string
          subject_id?: string | null
          task_type?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_source_action_id_fkey"
            columns: ["source_action_id"]
            isOneToOne: false
            referencedRelation: "assistant_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "raw_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          input: Json | null
          output: Json | null
          started_at: string | null
          status: string
          tool_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          started_at?: string | null
          status?: string
          tool_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          started_at?: string | null
          status?: string
          tool_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          occurred_at: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          occurred_at?: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          occurred_at?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_auth_keys: {
        Row: {
          key_id: string
          key_type: string
          updated_at: string
          user_id: string
          value_enc: string
        }
        Insert: {
          key_id: string
          key_type: string
          updated_at?: string
          user_id: string
          value_enc: string
        }
        Update: {
          key_id?: string
          key_type?: string
          updated_at?: string
          user_id?: string
          value_enc?: string
        }
        Relationships: []
      }
      whatsapp_session_secrets: {
        Row: {
          creds_enc: string | null
          pairing_code_enc: string | null
          pairing_expires_at: string | null
          phone_enc: string | null
          qr_enc: string | null
          qr_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          creds_enc?: string | null
          pairing_code_enc?: string | null
          pairing_expires_at?: string | null
          phone_enc?: string | null
          qr_enc?: string | null
          qr_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          creds_enc?: string | null
          pairing_code_enc?: string | null
          pairing_expires_at?: string | null
          phone_enc?: string | null
          qr_enc?: string | null
          qr_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_sessions: {
        Row: {
          bridge_heartbeat_at: string | null
          connected_at: string | null
          created_at: string
          desired_state: string
          last_error: string | null
          link_method: string
          requested_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bridge_heartbeat_at?: string | null
          connected_at?: string | null
          created_at?: string
          desired_state?: string
          last_error?: string | null
          link_method?: string
          requested_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bridge_heartbeat_at?: string | null
          connected_at?: string | null
          created_at?: string
          desired_state?: string
          last_error?: string | null
          link_method?: string
          requested_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_jobs: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_after: string
          status: string
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_whatsapp_pairing: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      clear_whatsapp_qr: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      clear_whatsapp_session: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      clear_whatsapp_session_qr: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      complete_onboarding: {
        Args: {
          p_academic_year: number
          p_course_program: string
          p_first_name: string
          p_institution: string
          p_last_name: string
          p_planning_style: string
          p_reminder_lead: string
          p_semester: number
          p_subjects?: string[]
        }
        Returns: string
      }
      delete_google_credentials: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      enqueue_gcal_sync: { Args: { p_user_id: string }; Returns: boolean }
      enqueue_raw_message_extraction: {
        Args: { p_message_id: string; p_user_id: string }
        Returns: boolean
      }
      finish_job: {
        Args: {
          p_error?: string
          p_job_id: string
          p_retryable?: boolean
          p_worker_id: string
        }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_after: string
          status: string
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_google_credentials: {
        Args: { p_key: string; p_user_id: string }
        Returns: {
          calendar_id: string
          connected_at: string
          refresh_token: string
          scope: string
        }[]
      }
      get_whatsapp_auth_keys: {
        Args: {
          p_ids: string[]
          p_key: string
          p_key_type: string
          p_user_id: string
        }
        Returns: {
          key_id: string
          value: string
        }[]
      }
      get_whatsapp_creds: {
        Args: { p_key: string; p_user_id: string }
        Returns: string
      }
      get_whatsapp_pairing_code: {
        Args: { p_key: string; p_user_id: string }
        Returns: string
      }
      get_whatsapp_pairing_phone: {
        Args: { p_key: string; p_user_id: string }
        Returns: string
      }
      get_whatsapp_pairing_status: {
        Args: { p_key: string; p_user_id: string }
        Returns: {
          code: string
          expires_at: string
        }[]
      }
      get_whatsapp_qr: {
        Args: { p_connection_id: string; p_key: string }
        Returns: string
      }
      get_whatsapp_session_qr: {
        Args: { p_key: string; p_user_id: string }
        Returns: string
      }
      ingest_raw_messages: {
        Args: { p_rows: Json; p_user_id: string }
        Returns: {
          group_jid: string
          media_type: string
          message_id: string
          status: string
          whatsapp_msg_id: string
        }[]
      }
      purge_expired_raw_messages: {
        Args: { p_retention_days?: number; p_user_id?: string }
        Returns: number
      }
      recent_document_chunks: {
        Args: {
          p_document_id?: string
          p_limit?: number
          p_subject_id?: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          document_name: string
          match_kind: string
          page: number
          score: number
          snippet: string
        }[]
      }
      rotate_google_token_key: {
        Args: { p_new_key: string; p_old_key: string }
        Returns: undefined
      }
      search_document_chunks: {
        Args: {
          p_document_id?: string
          p_embedding?: string
          p_limit?: number
          p_page?: number
          p_query: string
          p_subject_id?: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          document_name: string
          match_kind: string
          page: number
          score: number
          snippet: string
        }[]
      }
      set_whatsapp_auth_keys: {
        Args: { p_entries: Json; p_key: string; p_user_id: string }
        Returns: undefined
      }
      set_whatsapp_creds: {
        Args: { p_creds: string; p_key: string; p_user_id: string }
        Returns: undefined
      }
      set_whatsapp_pairing_code: {
        Args: {
          p_code: string
          p_key: string
          p_ttl_seconds?: number
          p_user_id: string
        }
        Returns: undefined
      }
      set_whatsapp_pairing_phone: {
        Args: { p_key: string; p_phone: string; p_user_id: string }
        Returns: undefined
      }
      set_whatsapp_qr: {
        Args: {
          p_connection_id: string
          p_key: string
          p_qr: string
          p_ttl_seconds?: number
        }
        Returns: undefined
      }
      set_whatsapp_session_qr: {
        Args: {
          p_key: string
          p_qr: string
          p_ttl_seconds?: number
          p_user_id: string
        }
        Returns: undefined
      }
      touch_job: {
        Args: { p_job_id: string; p_worker_id: string }
        Returns: undefined
      }
      upsert_google_credentials: {
        Args: {
          p_calendar_id: string
          p_key: string
          p_refresh_token: string
          p_scope: string
          p_user_id: string
        }
        Returns: undefined
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

