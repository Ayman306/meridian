/**
 * Database types — GENERATED. Do not edit by hand.
 *
 *   npm run db:types
 *   # supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Generated from the live project after migrations 0001-0028. The aliases at
 * the bottom are the only hand-written part: they are what the modules import,
 * and they are re-added after each regeneration.
 */

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
  public: {
    Tables: {
      accommodations: {
        Row: {
          address: string | null
          booking_ref: string | null
          check_in: string | null
          check_out: string | null
          city: string | null
          country_code: string | null
          couple_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          maps_url: string | null
          name: string
          notes: string | null
          phone: string | null
          trip_id: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          address?: string | null
          booking_ref?: string | null
          check_in?: string | null
          check_out?: string | null
          city?: string | null
          country_code?: string | null
          couple_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          trip_id?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          address?: string | null
          booking_ref?: string | null
          check_in?: string | null
          check_out?: string | null
          city?: string | null
          country_code?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          trip_id?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accommodations_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accommodations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accommodations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      access_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          modules: string[]
          name: string
          prefix: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          modules?: string[]
          name: string
          prefix: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          modules?: string[]
          name?: string
          prefix?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      airline_codes: {
        Row: {
          iata: string
          icao: string
          name: string | null
        }
        Insert: {
          iata: string
          icao: string
          name?: string | null
        }
        Update: {
          iata?: string
          icao?: string
          name?: string | null
        }
        Relationships: []
      }
      airport_routes: {
        Row: {
          dest_iata: string
          duration_minutes: number
          is_direct: boolean
          origin_iata: string
        }
        Insert: {
          dest_iata: string
          duration_minutes: number
          is_direct?: boolean
          origin_iata: string
        }
        Update: {
          dest_iata?: string
          duration_minutes?: number
          is_direct?: boolean
          origin_iata?: string
        }
        Relationships: []
      }
      airport_wait_times: {
        Row: {
          baggage_minutes: number | null
          iata: string
          immigration_minutes: number | null
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          baggage_minutes?: number | null
          iata: string
          immigration_minutes?: number | null
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          baggage_minutes?: number | null
          iata?: string
          immigration_minutes?: number | null
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airport_wait_times_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      airports: {
        Row: {
          city: string
          country_code: string
          created_at: string
          iata: string
          icao: string | null
          lat: number
          lng: number
          name: string
          timezone: string
        }
        Insert: {
          city: string
          country_code: string
          created_at?: string
          iata: string
          icao?: string | null
          lat: number
          lng: number
          name: string
          timezone: string
        }
        Update: {
          city?: string
          country_code?: string
          created_at?: string
          iata?: string
          icao?: string | null
          lat?: number
          lng?: number
          name?: string
          timezone?: string
        }
        Relationships: []
      }
      album_media: {
        Row: {
          album_id: string
          media_id: string
          sort_key: string | null
        }
        Insert: {
          album_id: string
          media_id: string
          sort_key?: string | null
        }
        Update: {
          album_id?: string
          media_id?: string
          sort_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "album_media_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_media_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          couple_id: string
          cover_media_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          sort_order: number
          title: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          couple_id: string
          cover_media_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          sort_order?: number
          title: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          couple_id?: string
          cover_media_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          sort_order?: number
          title?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "albums_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "albums_cover_media_id_fkey"
            columns: ["cover_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "albums_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "albums_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      allowance_rules: {
        Row: {
          couple_id: string | null
          created_at: string
          destination_country: string
          id: string
          label: string | null
          max_days: number
          notes: string | null
          passport_country: string
          region_members: string[] | null
          rule_type: string
          source_url: string | null
          updated_at: string
          user_id: string | null
          verified_on: string | null
          window_days: number | null
          window_start: string | null
        }
        Insert: {
          couple_id?: string | null
          created_at?: string
          destination_country: string
          id?: string
          label?: string | null
          max_days: number
          notes?: string | null
          passport_country: string
          region_members?: string[] | null
          rule_type: string
          source_url?: string | null
          updated_at?: string
          user_id?: string | null
          verified_on?: string | null
          window_days?: number | null
          window_start?: string | null
        }
        Update: {
          couple_id?: string | null
          created_at?: string
          destination_country?: string
          id?: string
          label?: string | null
          max_days?: number
          notes?: string | null
          passport_country?: string
          region_members?: string[] | null
          rule_type?: string
          source_url?: string | null
          updated_at?: string
          user_id?: string | null
          verified_on?: string | null
          window_days?: number | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allowance_rules_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowance_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          called_at: string
          error: string | null
          flight_id: string | null
          id: string
          provider: string
          success: boolean | null
          units: number
        }
        Insert: {
          called_at?: string
          error?: string | null
          flight_id?: string | null
          id?: string
          provider: string
          success?: boolean | null
          units?: number
        }
        Update: {
          called_at?: string
          error?: string | null
          flight_id?: string | null
          id?: string
          provider?: string
          success?: boolean | null
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount: number
          category_id: string | null
          couple_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          period: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          couple_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          period?: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          period?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          couple_id: string
          created_at: string
          icon: string | null
          id: string
          is_default: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          couple_id: string
          created_at?: string
          icon?: string | null
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          couple_id?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      couple_members: {
        Row: {
          couple_id: string
          invited_by: string | null
          joined_at: string
          module_grants: string[] | null
          role: string
          user_id: string
        }
        Insert: {
          couple_id: string
          invited_by?: string | null
          joined_at?: string
          module_grants?: string[] | null
          role?: string
          user_id: string
        }
        Update: {
          couple_id?: string
          invited_by?: string | null
          joined_at?: string
          module_grants?: string[] | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "couple_members_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couple_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couple_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      couple_settings: {
        Row: {
          ai_enabled: boolean
          base_currency: string
          couple_id: string
          created_at: string
          date_format: string
          distance_unit: string
          long_stay_threshold: number
          require_insurance: boolean
          show_departure_countdown: boolean
          updated_at: string
          week_starts_on: number
        }
        Insert: {
          ai_enabled?: boolean
          base_currency?: string
          couple_id: string
          created_at?: string
          date_format?: string
          distance_unit?: string
          long_stay_threshold?: number
          require_insurance?: boolean
          show_departure_countdown?: boolean
          updated_at?: string
          week_starts_on?: number
        }
        Update: {
          ai_enabled?: boolean
          base_currency?: string
          couple_id?: string
          created_at?: string
          date_format?: string
          distance_unit?: string
          long_stay_threshold?: number
          require_insurance?: boolean
          show_departure_countdown?: boolean
          updated_at?: string
          week_starts_on?: number
        }
        Relationships: [
          {
            foreignKeyName: "couple_settings_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: true
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      couples: {
        Row: {
          anniversary_date: string | null
          base_currency: string
          created_at: string
          created_by: string | null
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          kind: string
          name: string | null
          updated_at: string
        }
        Insert: {
          anniversary_date?: string | null
          base_currency?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          kind?: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          anniversary_date?: string | null
          base_currency?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          kind?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cycle_logs: {
        Row: {
          created_at: string
          ended_on: string | null
          fertility_note: string | null
          flow: string | null
          id: string
          luteal_days: number | null
          notes: string | null
          ovulation_on: string | null
          owner_id: string
          started_on: string
          symptoms: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_on?: string | null
          fertility_note?: string | null
          flow?: string | null
          id?: string
          luteal_days?: number | null
          notes?: string | null
          ovulation_on?: string | null
          owner_id: string
          started_on: string
          symptoms?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_on?: string | null
          fertility_note?: string | null
          flow?: string | null
          id?: string
          luteal_days?: number | null
          notes?: string | null
          ovulation_on?: string | null
          owner_id?: string
          started_on?: string
          symptoms?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_logs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_exchange: {
        Row: {
          couple_id: string
          created_at: string
          exchange_date: string
          id: string
          media_id: string
          user_id: string
        }
        Insert: {
          couple_id: string
          created_at?: string
          exchange_date: string
          id?: string
          media_id: string
          user_id: string
        }
        Update: {
          couple_id?: string
          created_at?: string
          exchange_date?: string
          id?: string
          media_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_exchange_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_exchange_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_exchange_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      destination_weights: {
        Row: {
          couple_id: string
          created_at: string
          updated_at: string
          weights: Json
        }
        Insert: {
          couple_id: string
          created_at?: string
          updated_at?: string
          weights?: Json
        }
        Update: {
          couple_id?: string
          created_at?: string
          updated_at?: string
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "destination_weights_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: true
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          couple_id: string
          created_at: string
          has_expiry: boolean
          id: string
          name: string
          requires_country: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          couple_id: string
          created_at?: string
          has_expiry?: boolean
          id?: string
          name: string
          requires_country?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          couple_id?: string
          created_at?: string
          has_expiry?: boolean
          id?: string
          name?: string
          requires_country?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_types_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          country_code: string | null
          couple_id: string
          created_at: string
          deleted_at: string | null
          expires_on: string | null
          file_name: string | null
          file_size: number | null
          id: string
          is_shared: boolean
          issued_on: string | null
          label: string
          last_alerted_threshold: string | null
          mime_type: string | null
          notes: string | null
          number_last4: string | null
          owner_id: string
          storage_path: string | null
          type_id: string | null
          updated_at: string
        }
        Insert: {
          country_code?: string | null
          couple_id: string
          created_at?: string
          deleted_at?: string | null
          expires_on?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_shared?: boolean
          issued_on?: string | null
          label: string
          last_alerted_threshold?: string | null
          mime_type?: string | null
          notes?: string | null
          number_last4?: string | null
          owner_id: string
          storage_path?: string | null
          type_id?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string | null
          couple_id?: string
          created_at?: string
          deleted_at?: string | null
          expires_on?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_shared?: boolean
          issued_on?: string | null
          label?: string
          last_alerted_threshold?: string | null
          mime_type?: string | null
          notes?: string | null
          number_last4?: string | null
          owner_id?: string
          storage_path?: string | null
          type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_exit_log: {
        Row: {
          country_code: string
          couple_id: string
          created_at: string
          entered_on: string
          exited_on: string | null
          id: string
          is_estimated: boolean
          notes: string | null
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          country_code: string
          couple_id: string
          created_at?: string
          entered_on: string
          exited_on?: string | null
          id?: string
          is_estimated?: boolean
          notes?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          country_code?: string
          couple_id?: string
          created_at?: string
          entered_on?: string
          exited_on?: string | null
          id?: string
          is_estimated?: boolean
          notes?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_exit_log_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_exit_log_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_exit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          color: string | null
          couple_id: string
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          couple_id: string
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          accommodation_id: string | null
          amount: number
          amount_base: number | null
          category_id: string | null
          couple_id: string
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          fx_date: string | null
          fx_rate: number | null
          id: string
          itinerary_item_id: string | null
          notes: string | null
          paid_by: string
          receipt_media_id: string | null
          spent_on: string
          split_detail: Json | null
          split_type: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          accommodation_id?: string | null
          amount: number
          amount_base?: number | null
          category_id?: string | null
          couple_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          description: string
          fx_date?: string | null
          fx_rate?: number | null
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          paid_by: string
          receipt_media_id?: string | null
          spent_on?: string
          split_detail?: Json | null
          split_type?: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          accommodation_id?: string | null
          amount?: number
          amount_base?: number | null
          category_id?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string
          fx_date?: string | null
          fx_rate?: number | null
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          paid_by?: string
          receipt_media_id?: string | null
          spent_on?: string
          split_detail?: Json | null
          split_type?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_receipt_media_id_fkey"
            columns: ["receipt_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_events: {
        Row: {
          created_at: string
          event_type: string
          flight_id: string | null
          from_value: Json | null
          id: string
          notified_at: string | null
          notified_user_id: string | null
          to_value: Json | null
        }
        Insert: {
          created_at?: string
          event_type: string
          flight_id?: string | null
          from_value?: Json | null
          id?: string
          notified_at?: string | null
          notified_user_id?: string | null
          to_value?: Json | null
        }
        Update: {
          created_at?: string
          event_type?: string
          flight_id?: string | null
          from_value?: Json | null
          id?: string
          notified_at?: string | null
          notified_user_id?: string | null
          to_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_events_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_events_notified_user_id_fkey"
            columns: ["notified_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_positions: {
        Row: {
          altitude_m: number | null
          created_at: string
          flight_id: string
          heading: number | null
          id: string
          lat: number
          lng: number
          on_ground: boolean
          recorded_at: string
          source: string
          velocity_ms: number | null
          vertical_rate: number | null
        }
        Insert: {
          altitude_m?: number | null
          created_at?: string
          flight_id: string
          heading?: number | null
          id?: string
          lat: number
          lng: number
          on_ground?: boolean
          recorded_at: string
          source?: string
          velocity_ms?: number | null
          vertical_rate?: number | null
        }
        Update: {
          altitude_m?: number | null
          created_at?: string
          flight_id?: string
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          on_ground?: boolean
          recorded_at?: string
          source?: string
          velocity_ms?: number | null
          vertical_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_positions_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
        ]
      }
      flights: {
        Row: {
          actual_arrival: string | null
          actual_departure: string | null
          aircraft_type: string | null
          airline_iata: string | null
          airline_name: string | null
          baggage_belt: string | null
          callsign: string | null
          couple_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          dest_iata: string | null
          dest_lat: number | null
          dest_lng: number | null
          dest_name: string | null
          dest_tz: string | null
          estimated_arrival: string | null
          estimated_departure: string | null
          flight_date: string
          flight_number: string
          gate: string | null
          has_checked_bags: boolean
          icao24: string | null
          id: string
          journey_id: string | null
          leg_index: number
          manual_override: Json | null
          origin_iata: string | null
          origin_lat: number | null
          origin_lng: number | null
          origin_name: string | null
          origin_tz: string | null
          phase: string
          position_error_count: number
          position_polled_at: string | null
          raw_status: Json | null
          registration: string | null
          scheduled_arrival: string | null
          scheduled_departure: string | null
          status_error_count: number
          status_polled_at: string | null
          terminal: string | null
          tracking_active: boolean
          traveler_id: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          actual_arrival?: string | null
          actual_departure?: string | null
          aircraft_type?: string | null
          airline_iata?: string | null
          airline_name?: string | null
          baggage_belt?: string | null
          callsign?: string | null
          couple_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          dest_iata?: string | null
          dest_lat?: number | null
          dest_lng?: number | null
          dest_name?: string | null
          dest_tz?: string | null
          estimated_arrival?: string | null
          estimated_departure?: string | null
          flight_date: string
          flight_number: string
          gate?: string | null
          has_checked_bags?: boolean
          icao24?: string | null
          id?: string
          journey_id?: string | null
          leg_index?: number
          manual_override?: Json | null
          origin_iata?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          origin_name?: string | null
          origin_tz?: string | null
          phase?: string
          position_error_count?: number
          position_polled_at?: string | null
          raw_status?: Json | null
          registration?: string | null
          scheduled_arrival?: string | null
          scheduled_departure?: string | null
          status_error_count?: number
          status_polled_at?: string | null
          terminal?: string | null
          tracking_active?: boolean
          traveler_id: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_arrival?: string | null
          actual_departure?: string | null
          aircraft_type?: string | null
          airline_iata?: string | null
          airline_name?: string | null
          baggage_belt?: string | null
          callsign?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          dest_iata?: string | null
          dest_lat?: number | null
          dest_lng?: number | null
          dest_name?: string | null
          dest_tz?: string | null
          estimated_arrival?: string | null
          estimated_departure?: string | null
          flight_date?: string
          flight_number?: string
          gate?: string | null
          has_checked_bags?: boolean
          icao24?: string | null
          id?: string
          journey_id?: string | null
          leg_index?: number
          manual_override?: Json | null
          origin_iata?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          origin_name?: string | null
          origin_tz?: string | null
          phase?: string
          position_error_count?: number
          position_polled_at?: string | null
          raw_status?: Json | null
          registration?: string | null
          scheduled_arrival?: string | null
          scheduled_departure?: string | null
          status_error_count?: number
          status_polled_at?: string | null
          terminal?: string | null
          tracking_active?: boolean
          traveler_id?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flights_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_traveler_id_fkey"
            columns: ["traveler_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          base: string
          fetched_at: string
          quote: string
          rate: number
          rate_date: string
          source: string | null
        }
        Insert: {
          base: string
          fetched_at?: string
          quote: string
          rate: number
          rate_date: string
          source?: string | null
        }
        Update: {
          base?: string
          fetched_at?: string
          quote?: string
          rate?: number
          rate_date?: string
          source?: string | null
        }
        Relationships: []
      }
      geocode_cache: {
        Row: {
          cached_at: string
          query: string
          results: Json
        }
        Insert: {
          cached_at?: string
          query: string
          results: Json
        }
        Update: {
          cached_at?: string
          query?: string
          results?: Json
        }
        Relationships: []
      }
      health_consents: {
        Row: {
          created_at: string
          granted_at: string
          id: string
          owner_id: string
          revoked_at: string | null
          scope: string
          updated_at: string
          viewer_id: string
        }
        Insert: {
          created_at?: string
          granted_at?: string
          id?: string
          owner_id: string
          revoked_at?: string | null
          scope: string
          updated_at?: string
          viewer_id: string
        }
        Update: {
          created_at?: string
          granted_at?: string
          id?: string
          owner_id?: string
          revoked_at?: string | null
          scope?: string
          updated_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_consents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_consents_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_records: {
        Row: {
          created_at: string
          detail: Json
          document_id: string | null
          dosage: string | null
          doses_per_day: number | null
          frequency: string | null
          id: string
          kind: string
          label: string
          owner_id: string
          quantity_remaining: number | null
          started_on: string | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          document_id?: string | null
          dosage?: string | null
          doses_per_day?: number | null
          frequency?: string | null
          id?: string
          kind: string
          label: string
          owner_id: string
          quantity_remaining?: number | null
          started_on?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          document_id?: string | null
          dosage?: string | null
          doses_per_day?: number | null
          frequency?: string | null
          id?: string
          kind?: string
          label?: string
          owner_id?: string
          quantity_remaining?: number | null
          started_on?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "health_records_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_records_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          code: string
          couple_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          invited_email: string
          module_grants: string[] | null
          revoked_at: string | null
          role: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          code: string
          couple_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          invited_email: string
          module_grants?: string[] | null
          revoked_at?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          code?: string
          couple_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          invited_email?: string
          module_grants?: string[] | null
          revoked_at?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          couple_id: string
          created_at: string
          created_by: string | null
          delivered_through: string | null
          enabled: boolean
          events: string[]
          id: string
          last_delivered_at: string | null
          last_error: string | null
          last_status: number | null
          name: string
          // Present because the column is. The *grant* is what stops the
          // browser reading it — `revoke select … grant select (named columns)`
          // in 0028 — exactly as `access_tokens.token_hash` is handled. A type
          // that hid it would leave the one context that may read it, the
          // webhook sweep, unable to say so.
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          couple_id: string
          created_at?: string
          created_by?: string | null
          delivered_through?: string | null
          enabled?: boolean
          events?: string[]
          id?: string
          last_delivered_at?: string | null
          last_error?: string | null
          last_status?: number | null
          name: string
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          couple_id?: string
          created_at?: string
          created_by?: string | null
          delivered_through?: string | null
          enabled?: boolean
          events?: string[]
          id?: string
          last_delivered_at?: string | null
          last_error?: string | null
          last_status?: number | null
          name?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      itinerary_items: {
        Row: {
          address: string | null
          category_id: string | null
          cost_estimate: number | null
          couple_id: string
          created_at: string
          currency: string | null
          deleted_at: string | null
          destination_id: string | null
          duration_minutes: number | null
          end_time: string | null
          id: string
          lat: number | null
          lng: number | null
          maps_url: string | null
          notes: string | null
          place_name: string | null
          proposed_by: string | null
          scheduled_date: string | null
          sort_key: string
          source: string
          start_time: string | null
          state: string
          title: string
          trip_id: string
          updated_at: string
          url: string | null
        }
        Insert: {
          address?: string | null
          category_id?: string | null
          cost_estimate?: number | null
          couple_id: string
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          destination_id?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          notes?: string | null
          place_name?: string | null
          proposed_by?: string | null
          scheduled_date?: string | null
          sort_key: string
          source?: string
          start_time?: string | null
          state?: string
          title: string
          trip_id: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          address?: string | null
          category_id?: string | null
          cost_estimate?: number | null
          couple_id?: string
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          destination_id?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          notes?: string | null
          place_name?: string | null
          proposed_by?: string | null
          scheduled_date?: string | null
          sort_key?: string
          source?: string
          start_time?: string | null
          state?: string
          title?: string
          trip_id?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      journeys: {
        Row: {
          booking_ref: string | null
          couple_id: string
          created_at: string
          direction: string
          id: string
          traveler_id: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          booking_ref?: string | null
          couple_id: string
          created_at?: string
          direction: string
          id?: string
          traveler_id: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_ref?: string | null
          couple_id?: string
          created_at?: string
          direction?: string
          id?: string
          traveler_id?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journeys_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journeys_traveler_id_fkey"
            columns: ["traveler_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journeys_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          bytes: number | null
          caption: string | null
          couple_id: string
          deleted_at: string | null
          duration_s: number | null
          height: number | null
          id: string
          is_favorite: boolean
          itinerary_item_id: string | null
          lat: number | null
          lng: number | null
          media_type: string
          mime_type: string | null
          path_display: string
          path_original: string | null
          path_thumb: string
          phash: string | null
          search_tsv: unknown
          taken_at: string | null
          thumbhash: string | null
          trip_id: string | null
          updated_at: string
          uploaded_at: string
          uploader_id: string
          width: number | null
        }
        Insert: {
          bytes?: number | null
          caption?: string | null
          couple_id: string
          deleted_at?: string | null
          duration_s?: number | null
          height?: number | null
          id?: string
          is_favorite?: boolean
          itinerary_item_id?: string | null
          lat?: number | null
          lng?: number | null
          media_type?: string
          mime_type?: string | null
          path_display: string
          path_original?: string | null
          path_thumb: string
          phash?: string | null
          search_tsv?: unknown
          taken_at?: string | null
          thumbhash?: string | null
          trip_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploader_id: string
          width?: number | null
        }
        Update: {
          bytes?: number | null
          caption?: string | null
          couple_id?: string
          deleted_at?: string | null
          duration_s?: number | null
          height?: number | null
          id?: string
          is_favorite?: boolean
          itinerary_item_id?: string | null
          lat?: number | null
          lng?: number | null
          media_type?: string
          mime_type?: string | null
          path_display?: string
          path_original?: string | null
          path_thumb?: string
          phash?: string | null
          search_tsv?: unknown
          taken_at?: string | null
          thumbhash?: string | null
          trip_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploader_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          media_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          media_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          media_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_comments_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_restrictions: {
        Row: {
          country_code: string
          created_at: string
          id: string
          restriction: string | null
          source_url: string
          substance: string
          verified_on: string | null
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          restriction?: string | null
          source_url: string
          substance: string
          verified_on?: string | null
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          restriction?: string | null
          source_url?: string
          substance?: string
          verified_on?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accent_color: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          gender: string | null
          home_city: string | null
          home_country: string | null
          home_lat: number | null
          home_lng: number | null
          id: string
          nationality: string | null
          onboarded_at: string | null
          second_nationality: string | null
          timezone: string
          work_hours_end: string | null
          work_hours_start: string | null
          tracks_cycle: boolean | null
          updated_at: string
        }
        Insert: {
          accent_color?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          gender?: string | null
          home_city?: string | null
          home_country?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id: string
          nationality?: string | null
          onboarded_at?: string | null
          second_nationality?: string | null
          timezone?: string
          work_hours_end?: string | null
          work_hours_start?: string | null
          tracks_cycle?: boolean | null
          updated_at?: string
        }
        Update: {
          accent_color?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          gender?: string | null
          home_city?: string | null
          home_country?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id?: string
          nationality?: string | null
          onboarded_at?: string | null
          second_nationality?: string | null
          timezone?: string
          work_hours_end?: string | null
          work_hours_start?: string | null
          tracks_cycle?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      provider_quota: {
        Row: {
          checked_at: string
          last_error: string | null
          provider: string
          remaining: number | null
          total: number | null
        }
        Insert: {
          checked_at?: string
          last_error?: string | null
          provider: string
          remaining?: number | null
          total?: number | null
        }
        Update: {
          checked_at?: string
          last_error?: string | null
          provider?: string
          remaining?: number | null
          total?: number | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys: Json
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys: Json
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          couple_id: string
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          id: string
          method: string | null
          notes: string | null
          settled_on: string
          to_user: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          couple_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          from_user: string
          id?: string
          method?: string | null
          notes?: string | null
          settled_on?: string
          to_user: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          couple_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          from_user?: string
          id?: string
          method?: string | null
          notes?: string | null
          settled_on?: string
          to_user?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_from_user_fkey"
            columns: ["from_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_user_fkey"
            columns: ["to_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          allow_download: boolean
          couple_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          passcode_hash: string | null
          revoked_at: string | null
          target_id: string
          target_type: string
          token: string
          updated_at: string
          view_count: number
        }
        Insert: {
          allow_download?: boolean
          couple_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          passcode_hash?: string | null
          revoked_at?: string | null
          target_id: string
          target_type: string
          token: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          allow_download?: boolean
          couple_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          passcode_hash?: string | null
          revoked_at?: string | null
          target_id?: string
          target_type?: string
          token?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "share_links_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_tray: {
        Row: {
          accepted_at: string | null
          couple_id: string
          dismissed_at: string | null
          generated_at: string
          id: string
          payload: Json
          source: string | null
          trip_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          couple_id: string
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          payload: Json
          source?: string | null
          trip_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          couple_id?: string
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          payload?: Json
          source?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_tray_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_tray_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_days: {
        Row: {
          created_at: string
          date: string
          day_type: string
          id: string
          note: string | null
          title: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          day_type?: string
          id?: string
          note?: string | null
          title?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          day_type?: string
          id?: string
          note?: string | null
          title?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_days_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_destinations: {
        Row: {
          arrive_on: string | null
          board: Json
          city: string
          country_code: string | null
          couple_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          depart_on: string | null
          id: string
          lat: number | null
          lng: number | null
          notes: string | null
          sort_key: string
          state: string
          timezone: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          arrive_on?: string | null
          board?: Json
          city: string
          country_code?: string | null
          couple_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          depart_on?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          sort_key: string
          state?: string
          timezone?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          arrive_on?: string | null
          board?: Json
          city?: string
          country_code?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          depart_on?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          sort_key?: string
          state?: string
          timezone?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_destinations_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_destinations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_destinations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_document_requirements: {
        Row: {
          created_at: string
          document_id: string | null
          id: string
          is_manual: boolean
          note: string | null
          trip_id: string
          type_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          id?: string
          is_manual?: boolean
          note?: string | null
          trip_id: string
          type_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          id?: string
          is_manual?: boolean
          note?: string | null
          trip_id?: string
          type_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_document_requirements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_document_requirements_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_document_requirements_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_document_requirements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_statuses: {
        Row: {
          color: string | null
          couple_id: string
          created_at: string
          id: string
          is_terminal: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          couple_id: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          couple_id?: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_statuses_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_travelers: {
        Row: {
          arrival_date: string | null
          created_at: string
          departure_date: string | null
          notes: string | null
          origin_airport: string | null
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          arrival_date?: string | null
          created_at?: string
          departure_date?: string | null
          notes?: string | null
          origin_airport?: string | null
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          arrival_date?: string | null
          created_at?: string
          departure_date?: string | null
          notes?: string | null
          origin_airport?: string | null
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_travelers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_travelers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          couple_id: string
          cover_media_id: string | null
          created_at: string
          created_by: string | null
          custom: Json
          date_precision: string
          deleted_at: string | null
          end_date: string | null
          id: string
          is_open_ended: boolean
          notes: string | null
          start_date: string | null
          status_id: string | null
          timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          couple_id: string
          cover_media_id?: string | null
          created_at?: string
          created_by?: string | null
          custom?: Json
          date_precision?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          is_open_ended?: boolean
          notes?: string | null
          start_date?: string | null
          status_id?: string | null
          timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          couple_id?: string
          cover_media_id?: string | null
          created_at?: string
          created_by?: string | null
          custom?: Json
          date_precision?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          is_open_ended?: boolean
          notes?: string | null
          start_date?: string | null
          status_id?: string | null
          timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "trip_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          activity_seen_at: string | null
          created_at: string
          notify_allowance: boolean
          notify_daily_exchange: boolean
          notify_documents: boolean
          notify_flights: boolean
          notify_partner_activity: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          theme: string
          updated_at: string
          user_id: string
          vault_lock_minutes: number
          work_days: number[] | null
          work_timezone: string | null
        }
        Insert: {
          activity_seen_at?: string | null
          created_at?: string
          notify_allowance?: boolean
          notify_daily_exchange?: boolean
          notify_documents?: boolean
          notify_flights?: boolean
          notify_partner_activity?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          theme?: string
          updated_at?: string
          user_id: string
          vault_lock_minutes?: number
          work_days?: number[] | null
          work_timezone?: string | null
        }
        Update: {
          activity_seen_at?: string | null
          created_at?: string
          notify_allowance?: boolean
          notify_daily_exchange?: boolean
          notify_documents?: boolean
          notify_flights?: boolean
          notify_partner_activity?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          theme?: string
          updated_at?: string
          user_id?: string
          vault_lock_minutes?: number
          work_days?: number[] | null
          work_timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_rules: {
        Row: {
          destination_country: string
          id: string
          label: string | null
          max_days: number | null
          passport_country: string
          source_url: string | null
          tier: number
          verified_on: string | null
        }
        Insert: {
          destination_country: string
          id?: string
          label?: string | null
          max_days?: number | null
          passport_country: string
          source_url?: string | null
          tier: number
          verified_on?: string | null
        }
        Update: {
          destination_country?: string
          id?: string
          label?: string | null
          max_days?: number | null
          passport_country?: string
          source_url?: string | null
          tier?: number
          verified_on?: string | null
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          address: string | null
          category_id: string | null
          city: string | null
          country_code: string | null
          couple_id: string
          created_at: string
          deleted_at: string | null
          id: string
          image_url: string | null
          intensity: number | null
          lat: number | null
          lng: number | null
          maps_url: string | null
          notes: string | null
          place_name: string | null
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          category_id?: string | null
          city?: string | null
          country_code?: string | null
          couple_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          intensity?: number | null
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          notes?: string | null
          place_name?: string | null
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          category_id?: string | null
          city?: string | null
          country_code?: string | null
          couple_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          intensity?: number | null
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          notes?: string | null
          place_name?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlist_verdicts: {
        Row: {
          created_at: string
          updated_at: string
          user_id: string
          verdict: string
          wishlist_id: string
        }
        Insert: {
          created_at?: string
          updated_at?: string
          user_id: string
          verdict: string
          wishlist_id: string
        }
        Update: {
          created_at?: string
          updated_at?: string
          user_id?: string
          verdict?: string
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_verdicts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_verdicts_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlist_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activity_feed: {
        Args: { since?: string | null; max_results?: number }
        Returns: {
          event: string
          id: string
          title: string
          subtitle: string | null
          actor_id: string | null
          trip_id: string | null
          at: string
        }[]
      }
      all_modules: { Args: never; Returns: string[] }
      api_usage_in_window: {
        Args: { target_provider: string }
        Returns: number
      }
      assert_grants_allowed: {
        Args: { grants: string[]; member_role: string }
        Returns: undefined
      }
      can_see: { Args: { module: string; target: string }; Returns: boolean }
      choose_destination: {
        Args: { destination_id: string }
        Returns: undefined
      }
      create_couple: {
        Args: { couple_name?: string }
        Returns: {
          anniversary_date: string | null
          base_currency: string
          created_at: string
          created_by: string | null
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          kind: string
          name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "couples"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invite: {
        Args: {
          email: string
          grants?: string[]
          member_role?: string
          valid_days?: number
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          code: string
          couple_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          invited_email: string
          module_grants: string[] | null
          revoked_at: string | null
          role: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dashboard: { Args: never; Returns: Json }
      deactivate_finished_flights: { Args: never; Returns: number }
      delete_all_health_data: { Args: never; Returns: undefined }
      ensure_trip_album: { Args: { target_trip: string }; Returns: string }
      expired_media: {
        Args: { grace_days?: number }
        Returns: {
          id: string
          path_display: string
          path_original: string
          path_thumb: string
        }[]
      }
      generate_invite_code: { Args: never; Returns: string }
      has_health_consent: {
        Args: { owner: string; scope_name: string }
        Returns: boolean
      }
      health: { Args: never; Returns: Json }
      invoke_sweep: { Args: { path: string }; Returns: number }
      is_couple_member: { Args: { target: string }; Returns: boolean }
      join_couple: { Args: { code: string }; Returns: string }
      leave_couple: { Args: never; Returns: undefined }
      media_usage: {
        Args: never
        Returns: {
          photo_count: number
          total_bytes: number
          trashed_count: number
        }[]
      }
      my_couple_id: { Args: never; Returns: string }
      my_email: { Args: never; Returns: string }
      my_modules: { Args: never; Returns: string[] }
      my_role: { Args: never; Returns: string }
      partner_id: { Args: never; Returns: string }
      purge_media: { Args: { ids: string[] }; Returns: number }
      push_wishlist_to_itinerary: {
        Args: {
          new_sort_key: string
          target_trip_id: string
          wishlist_item_id: string
        }
        Returns: string
      }
      regenerate_invite_code: { Args: never; Returns: string }
      schedule_sweeps: { Args: never; Returns: undefined }
      search_everything: {
        Args: { q: string; max_results?: number }
        Returns: {
          kind: string
          id: string
          title: string
          subtitle: string | null
          trip_id: string | null
          occurred: string | null
          rank: number
        }[]
      }
      seed_categories: { Args: { target: string }; Returns: undefined }
      seed_document_types: { Args: { target: string }; Returns: undefined }
      seed_trip_statuses: { Args: { target: string }; Returns: undefined }
      sensitive_modules: { Args: never; Returns: string[] }
      sync_trip_days: { Args: { target: string }; Returns: number }
      trip_item_counts_by_day: {
        Args: { target: string }
        Returns: {
          date: string
          item_count: number
        }[]
      }
      trip_readiness: {
        Args: { target: string }
        Returns: {
          document_id: string
          expires_on: string
          is_manual: boolean
          satisfied: boolean
          type_id: string
          type_name: string
          user_id: string
        }[]
      }
      unchoose_destination: {
        Args: { destination_id: string }
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
  public: {
    Enums: {},
  },
} as const

// ---------------------------------------------------------------------------
// Hand-written aliases. Re-add these after regenerating — they are what the
// modules import, and shorter than the generated names at every call site.
// ---------------------------------------------------------------------------

export type InsertDto<T extends keyof DefaultSchema['Tables']> = TablesInsert<T>
export type UpdateDto<T extends keyof DefaultSchema['Tables']> = TablesUpdate<T>
