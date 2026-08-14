/**
 * Database types — GENERATED. Do not edit by hand.
 *
 *   npm run db:types
 *   # supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Generated from the live project after migrations 0001-0009. The aliases at
 * the bottom are the only hand-written part: they are what the modules import,
 * and they are re-added after each regeneration.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.15'
  }
  public: {
    Tables: {
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
            foreignKeyName: 'categories_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
        ]
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
            foreignKeyName: 'allowance_rules_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'allowance_rules_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      couple_members: {
        Row: {
          couple_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          couple_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          couple_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'couple_members_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'couple_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      couples: {
        Row: {
          anniversary_date: string | null
          created_at: string
          created_by: string | null
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          name: string | null
          updated_at: string
        }
        Insert: {
          anniversary_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          name?: string | null
          updated_at?: string
        }
        Update: {
          anniversary_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          name?: string | null
          updated_at?: string
        }
        Relationships: []
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
            foreignKeyName: 'destination_weights_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: true
            referencedRelation: 'couples'
            referencedColumns: ['id']
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
            foreignKeyName: 'entry_exit_log_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'entry_exit_log_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'entry_exit_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
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
            foreignKeyName: 'itinerary_items_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'itinerary_items_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'itinerary_items_proposed_by_fkey'
            columns: ['proposed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'itinerary_items_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          accent_color: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          home_city: string | null
          home_country: string | null
          home_lat: number | null
          home_lng: number | null
          id: string
          nationality: string | null
          onboarded_at: string | null
          second_nationality: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          home_city?: string | null
          home_country?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id: string
          nationality?: string | null
          onboarded_at?: string | null
          second_nationality?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          home_city?: string | null
          home_country?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id?: string
          nationality?: string | null
          onboarded_at?: string | null
          second_nationality?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
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
            foreignKeyName: 'suggestion_tray_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'suggestion_tray_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
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
            foreignKeyName: 'trip_days_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
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
            foreignKeyName: 'trip_statuses_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
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
            foreignKeyName: 'document_types_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
        ]
      }
      documents: {
        Row: {
          couple_id: string
          country_code: string | null
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
          couple_id: string
          country_code?: string | null
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
          couple_id?: string
          country_code?: string | null
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
            foreignKeyName: 'documents_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_type_id_fkey'
            columns: ['type_id']
            isOneToOne: false
            referencedRelation: 'document_types'
            referencedColumns: ['id']
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
            foreignKeyName: 'trip_destinations_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trip_destinations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trip_destinations_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
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
            foreignKeyName: 'trip_document_requirements_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trip_document_requirements_type_id_fkey'
            columns: ['type_id']
            isOneToOne: false
            referencedRelation: 'document_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trip_document_requirements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
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
            foreignKeyName: 'trip_travelers_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trip_travelers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
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
            foreignKeyName: 'trips_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trips_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trips_status_id_fkey'
            columns: ['status_id']
            isOneToOne: false
            referencedRelation: 'trip_statuses'
            referencedColumns: ['id']
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
            foreignKeyName: 'wishlist_items_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'wishlist_items_couple_id_fkey'
            columns: ['couple_id']
            isOneToOne: false
            referencedRelation: 'couples'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'wishlist_items_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
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
            foreignKeyName: 'wishlist_verdicts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'wishlist_verdicts_wishlist_id_fkey'
            columns: ['wishlist_id']
            isOneToOne: false
            referencedRelation: 'wishlist_items'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_couple: {
        Args: { couple_name?: string }
        Returns: {
          anniversary_date: string | null
          created_at: string
          created_by: string | null
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'couples'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      choose_destination: { Args: { destination_id: string }; Returns: undefined }
      dashboard: { Args: never; Returns: Json }
      generate_invite_code: { Args: never; Returns: string }
      health: { Args: never; Returns: Json }
      is_couple_member: { Args: { target: string }; Returns: boolean }
      join_couple: { Args: { code: string }; Returns: string }
      leave_couple: { Args: never; Returns: undefined }
      my_couple_id: { Args: never; Returns: string }
      partner_id: { Args: never; Returns: string }
      push_wishlist_to_itinerary: {
        Args: {
          new_sort_key: string
          target_trip_id: string
          wishlist_item_id: string
        }
        Returns: string
      }
      regenerate_invite_code: { Args: never; Returns: string }
      seed_categories: { Args: { target: string }; Returns: undefined }
      seed_document_types: { Args: { target: string }; Returns: undefined }
      seed_trip_statuses: { Args: { target: string }; Returns: undefined }
      sync_trip_days: { Args: { target: string }; Returns: number }
      unchoose_destination: { Args: { destination_id: string }; Returns: undefined }
      trip_readiness: {
        Args: { target: string }
        Returns: {
          user_id: string
          type_id: string
          type_name: string
          is_manual: boolean
          document_id: string | null
          expires_on: string | null
          satisfied: boolean
        }[]
      }
      trip_item_counts_by_day: {
        Args: { target: string }
        Returns: {
          date: string
          item_count: number
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
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
