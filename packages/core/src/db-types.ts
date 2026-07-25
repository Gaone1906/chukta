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
      device_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string
          disabled_at: string | null
          disabled_reason: string | null
          expo_push_token: string
          id: string
          last_seen_at: string
          platform: string
          profile_id: string
          timezone: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id: string
          disabled_at?: string | null
          disabled_reason?: string | null
          expo_push_token: string
          id?: string
          last_seen_at?: string
          platform: string
          profile_id: string
          timezone?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          expo_push_token?: string
          id?: string
          last_seen_at?: string
          platform?: string
          profile_id?: string
          timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_attachments: {
        Row: {
          byte_size: number | null
          created_at: string
          expense_id: string
          group_id: string | null
          id: string
          mime_type: string
          storage_path: string
          uploaded_by_profile_id: string
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          expense_id: string
          group_id?: string | null
          id?: string
          mime_type: string
          storage_path: string
          uploaded_by_profile_id: string
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          expense_id?: string
          group_id?: string | null
          id?: string
          mime_type?: string
          storage_path?: string
          uploaded_by_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_attachments_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "expense_attachments_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_comments: {
        Row: {
          author_profile_id: string
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          expense_id: string
          group_id: string | null
          id: string
        }
        Insert: {
          author_profile_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          expense_id: string
          group_id?: string | null
          id?: string
        }
        Update: {
          author_profile_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          expense_id?: string
          group_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_comments_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_comments_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
        ]
      }
      expense_debts: {
        Row: {
          amount_minor: number
          currency: string
          expense_id: string
          from_profile_id: string
          group_id: string | null
          to_profile_id: string
        }
        Insert: {
          amount_minor: number
          currency?: string
          expense_id: string
          from_profile_id: string
          group_id?: string | null
          to_profile_id: string
        }
        Update: {
          amount_minor?: number
          currency?: string
          expense_id?: string
          from_profile_id?: string
          group_id?: string | null
          to_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_debts_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "expense_debts_from_profile_id_fkey"
            columns: ["from_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_debts_to_profile_id_fkey"
            columns: ["to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_item_shares: {
        Row: {
          item_id: string
          profile_id: string
        }
        Insert: {
          item_id: string
          profile_id: string
        }
        Update: {
          item_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_item_shares_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "expense_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_item_shares_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_items: {
        Row: {
          amount_minor: number
          expense_id: string
          group_id: string | null
          id: string
          kind: Database["public"]["Enums"]["item_kind"]
          name: string
          position: number
        }
        Insert: {
          amount_minor: number
          expense_id: string
          group_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["item_kind"]
          name: string
          position: number
        }
        Update: {
          amount_minor?: number
          expense_id?: string
          group_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["item_kind"]
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_items_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
        ]
      }
      expense_participants: {
        Row: {
          expense_id: string
          group_id: string | null
          is_ower: boolean
          is_payer: boolean
          profile_id: string
        }
        Insert: {
          expense_id: string
          group_id?: string | null
          is_ower?: boolean
          is_payer?: boolean
          profile_id: string
        }
        Update: {
          expense_id?: string
          group_id?: string | null
          is_ower?: boolean
          is_payer?: boolean
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_participants_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "expense_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_payers: {
        Row: {
          expense_id: string
          group_id: string | null
          paid_amount_minor: number
          profile_id: string
        }
        Insert: {
          expense_id: string
          group_id?: string | null
          paid_amount_minor: number
          profile_id: string
        }
        Update: {
          expense_id?: string
          group_id?: string | null
          paid_amount_minor?: number
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_payers_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "expense_payers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_revisions: {
        Row: {
          action: string
          actor_profile_id: string | null
          client_mutation_id: string | null
          created_at: string
          diff: Json | null
          expense_id: string
          id: number
          revision: number
          snapshot: Json
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          client_mutation_id?: string | null
          created_at?: string
          diff?: Json | null
          expense_id: string
          id?: number
          revision: number
          snapshot: Json
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          client_mutation_id?: string | null
          created_at?: string
          diff?: Json | null
          expense_id?: string
          id?: number
          revision?: number
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "expense_revisions_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_splits: {
        Row: {
          expense_id: string
          group_id: string | null
          profile_id: string
          share_amount_minor: number
          split_weight: number | null
        }
        Insert: {
          expense_id: string
          group_id?: string | null
          profile_id: string
          share_amount_minor: number
          split_weight?: number | null
        }
        Update: {
          expense_id?: string
          group_id?: string | null
          profile_id?: string
          share_amount_minor?: number
          split_weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_splits_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "expense_splits_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_minor: number
          category: string | null
          created_at: string
          created_by_profile_id: string
          currency: string
          deleted_at: string | null
          deleted_by_profile_id: string | null
          description: string
          group_id: string | null
          id: string
          receipt_count: number
          revision: number
          spent_on: string
          split_type: Database["public"]["Enums"]["split_type"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          category?: string | null
          created_at?: string
          created_by_profile_id: string
          currency?: string
          deleted_at?: string | null
          deleted_by_profile_id?: string | null
          description: string
          group_id?: string | null
          id: string
          receipt_count?: number
          revision?: number
          spent_on: string
          split_type: Database["public"]["Enums"]["split_type"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          category?: string | null
          created_at?: string
          created_by_profile_id?: string
          currency?: string
          deleted_at?: string | null
          deleted_by_profile_id?: string | null
          description?: string
          group_id?: string | null
          id?: string
          receipt_count?: number
          revision?: number
          spent_on?: string
          split_type?: Database["public"]["Enums"]["split_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_deleted_by_profile_id_fkey"
            columns: ["deleted_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          app_version: string | null
          body: string
          created_at: string
          id: string
          platform: string | null
          profile_id: string | null
        }
        Insert: {
          app_version?: string | null
          body: string
          created_at?: string
          id?: string
          platform?: string | null
          profile_id?: string | null
        }
        Update: {
          app_version?: string | null
          body?: string
          created_at?: string
          id?: string
          platform?: string | null
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          added_by_profile_id: string | null
          group_id: string
          joined_at: string
          left_at: string | null
          profile_id: string
          role: string
        }
        Insert: {
          added_by_profile_id?: string | null
          group_id: string
          joined_at?: string
          left_at?: string | null
          profile_id: string
          role?: string
        }
        Update: {
          added_by_profile_id?: string | null
          group_id?: string
          joined_at?: string
          left_at?: string | null
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_added_by_profile_id_fkey"
            columns: ["added_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by_profile_id: string
          currency: string
          deleted_at: string | null
          id: string
          name: string
          simplify_debts: boolean
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by_profile_id: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name: string
          simplify_debts?: boolean
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by_profile_id?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name?: string
          simplify_debts?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          comments: boolean
          expense_edits: boolean
          new_expenses: boolean
          profile_id: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          reminders: boolean
          settlements: boolean
        }
        Insert: {
          comments?: boolean
          expense_edits?: boolean
          new_expenses?: boolean
          profile_id: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminders?: boolean
          settlements?: boolean
        }
        Update: {
          comments?: boolean
          expense_edits?: boolean
          new_expenses?: boolean
          profile_id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminders?: boolean
          settlements?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_claims: {
        Row: {
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          created_by_profile_id: string
          expires_at: string
          id: string
          placeholder_profile_id: string
          token_sha256: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          created_by_profile_id: string
          expires_at?: string
          id?: string
          placeholder_profile_id: string
          token_sha256: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          created_by_profile_id?: string
          expires_at?: string
          id?: string
          placeholder_profile_id?: string
          token_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_claims_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_claims_placeholder_profile_id_fkey"
            columns: ["placeholder_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_contact_points: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["contact_kind"]
          profile_id: string
          retired_at: string | null
          source: string
          value_display: string | null
          value_norm: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["contact_kind"]
          profile_id: string
          retired_at?: string | null
          source?: string
          value_display?: string | null
          value_norm: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["contact_kind"]
          profile_id?: string
          retired_at?: string | null
          source?: string
          value_display?: string | null
          value_norm?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_contact_points_profile_id_fkey"
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
          claimed_at: string | null
          created_at: string
          created_by_profile_id: string | null
          deleted_at: string | null
          display_name: string
          id: string
          merged_at: string | null
          merged_into_profile_id: string | null
          primary_auth_provider: string | null
          timezone: string
          updated_at: string
          upi_vpa: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          claimed_at?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          deleted_at?: string | null
          display_name: string
          id?: string
          merged_at?: string | null
          merged_into_profile_id?: string | null
          primary_auth_provider?: string | null
          timezone?: string
          updated_at?: string
          upi_vpa?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          claimed_at?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          deleted_at?: string | null
          display_name?: string
          id?: string
          merged_at?: string | null
          merged_into_profile_id?: string | null
          primary_auth_provider?: string | null
          timezone?: string
          updated_at?: string
          upi_vpa?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_merged_into_profile_id_fkey"
            columns: ["merged_into_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expense_rules: {
        Row: {
          created_at: string
          created_by_profile_id: string
          day_of_month: number | null
          end_on: string | null
          frequency: string
          group_id: string | null
          id: string
          interval_count: number
          is_paused: boolean
          last_run_on: string | null
          max_occurrences: number | null
          next_run_on: string
          start_on: string
          template: Json
          timezone: string
          updated_at: string
          weekday: number | null
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          day_of_month?: number | null
          end_on?: string | null
          frequency: string
          group_id?: string | null
          id?: string
          interval_count?: number
          is_paused?: boolean
          last_run_on?: string | null
          max_occurrences?: number | null
          next_run_on: string
          start_on: string
          template: Json
          timezone?: string
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          day_of_month?: number | null
          end_on?: string | null
          frequency?: string
          group_id?: string | null
          id?: string
          interval_count?: number
          is_paused?: boolean
          last_run_on?: string | null
          max_occurrences?: number | null
          next_run_on?: string
          start_on?: string
          template?: Json
          timezone?: string
          updated_at?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expense_rules_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_rules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expense_runs: {
        Row: {
          created_at: string
          expense_id: string | null
          rule_id: string
          run_on: string
        }
        Insert: {
          created_at?: string
          expense_id?: string | null
          rule_id: string
          run_on: string
        }
        Update: {
          created_at?: string
          expense_id?: string | null
          rule_id?: string
          run_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expense_runs_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_expense_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount_minor: number
          confirmed_at: string | null
          confirmed_by_profile_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          from_profile_id: string
          group_id: string | null
          id: string
          method: Database["public"]["Enums"]["settlement_method"]
          note: string | null
          recorded_by_profile_id: string
          revision: number
          settled_on: string
          status: string
          to_profile_id: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          confirmed_at?: string | null
          confirmed_by_profile_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          from_profile_id: string
          group_id?: string | null
          id: string
          method?: Database["public"]["Enums"]["settlement_method"]
          note?: string | null
          recorded_by_profile_id: string
          revision?: number
          settled_on: string
          status?: string
          to_profile_id: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          confirmed_at?: string | null
          confirmed_by_profile_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          from_profile_id?: string
          group_id?: string | null
          id?: string
          method?: Database["public"]["Enums"]["settlement_method"]
          note?: string | null
          recorded_by_profile_id?: string
          revision?: number
          settled_on?: string
          status?: string
          to_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_confirmed_by_profile_id_fkey"
            columns: ["confirmed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_from_profile_id_fkey"
            columns: ["from_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_recorded_by_profile_id_fkey"
            columns: ["recorded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_profile_id_fkey"
            columns: ["to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_jar_purchases: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          id: string
          product_id: string
          profile_id: string
          purchased_at: string
          raw_receipt: Json | null
          store: string
          store_txn_id: string
          verified_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency?: string
          id?: string
          product_id: string
          profile_id: string
          purchased_at?: string
          raw_receipt?: Json | null
          store: string
          store_txn_id: string
          verified_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          product_id?: string
          profile_id?: string
          purchased_at?: string
          raw_receipt?: Json | null
          store?: string
          store_txn_id?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_jar_purchases_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_comment: {
        Args: {
          p_body: string
          p_client_mutation_id: string
          p_expense_id: string
        }
        Returns: Json
      }
      add_group_members: {
        Args: {
          p_client_mutation_id: string
          p_group_id: string
          p_profile_ids: string[]
        }
        Returns: Json
      }
      claim_placeholder: { Args: { p_token: string }; Returns: Json }
      create_expense: {
        Args: { p_client_mutation_id: string; p_payload: Json }
        Returns: Json
      }
      create_group: {
        Args: { p_client_mutation_id: string; p_payload: Json }
        Returns: Json
      }
      create_invite_link: { Args: { p_profile_id: string }; Returns: Json }
      delete_account: { Args: never; Returns: Json }
      delete_expense: {
        Args: {
          p_client_mutation_id: string
          p_expected_revision: number
          p_expense_id: string
        }
        Returns: Json
      }
      get_expense_detail: { Args: { p_expense_id: string }; Returns: Json }
      get_group_detail: {
        Args: { p_before?: string; p_group_id: string; p_limit?: number }
        Returns: Json
      }
      get_home_summary: { Args: never; Returns: Json }
      get_person_detail: {
        Args: { p_limit?: number; p_profile_id: string }
        Returns: Json
      }
      record_settlement: {
        Args: { p_client_mutation_id: string; p_payload: Json }
        Returns: Json
      }
      restore_expense: {
        Args: { p_client_mutation_id: string; p_expense_id: string }
        Returns: Json
      }
      simplify_group_debts: {
        Args: { p_group_id: string }
        Returns: {
          amount_minor: number
          from_profile_id: string
          to_profile_id: string
        }[]
      }
      sync_pull: {
        Args: { p_limit?: number; p_since_event_id?: number }
        Returns: Json
      }
      update_expense: {
        Args: {
          p_client_mutation_id: string
          p_expected_revision: number
          p_expense_id: string
          p_payload: Json
        }
        Returns: Json
      }
      upsert_contact_profile: {
        Args: {
          p_client_mutation_id?: string
          p_display_name: string
          p_kind?: Database["public"]["Enums"]["contact_kind"]
          p_profile_id?: string
          p_value_norm?: string
        }
        Returns: string
      }
    }
    Enums: {
      contact_kind: "phone" | "email"
      item_kind: "line" | "tax" | "tip" | "discount"
      settlement_method: "upi" | "cash" | "bank" | "other"
      split_type: "equal" | "exact" | "percentage" | "shares" | "itemized"
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
    Enums: {
      contact_kind: ["phone", "email"],
      item_kind: ["line", "tax", "tip", "discount"],
      settlement_method: ["upi", "cash", "bank", "other"],
      split_type: ["equal", "exact", "percentage", "shares", "itemized"],
    },
  },
} as const

