/**
 * Database types — GENERATED. Do not edit by hand.
 *
 *   npm run db:types
 *   # supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Generated from the live project after migrations 0001-0004. The aliases at
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
      generate_invite_code: { Args: never; Returns: string }
      health: { Args: never; Returns: Json }
      is_couple_member: { Args: { target: string }; Returns: boolean }
      join_couple: { Args: { code: string }; Returns: string }
      leave_couple: { Args: never; Returns: undefined }
      my_couple_id: { Args: never; Returns: string }
      partner_id: { Args: never; Returns: string }
      regenerate_invite_code: { Args: never; Returns: string }
      seed_categories: { Args: { target: string }; Returns: undefined }
      seed_trip_statuses: { Args: { target: string }; Returns: undefined }
      sync_trip_days: { Args: { target: string }; Returns: number }
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
