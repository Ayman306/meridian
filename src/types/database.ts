/**
 * Database types.
 *
 * This file mirrors the applied migrations under `supabase/migrations/`.
 * Once a Supabase project exists, regenerate it rather than editing by hand:
 *
 *   npm run db:types
 *   # => supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Until then it is maintained alongside each migration, which is why it is
 * excluded from lint.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string | null
          avatar_url: string | null
          home_city: string | null
          home_country: string | null
          home_lat: number | null
          home_lng: number | null
          timezone: string
          nationality: string | null
          second_nationality: string | null
          accent_color: string
          onboarded_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          avatar_url?: string | null
          home_city?: string | null
          home_country?: string | null
          home_lat?: number | null
          home_lng?: number | null
          timezone?: string
          nationality?: string | null
          second_nationality?: string | null
          accent_color?: string
          onboarded_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      couples: {
        Row: {
          id: string
          name: string | null
          anniversary_date: string | null
          invite_code: string | null
          invite_expires_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name?: string | null
          anniversary_date?: string | null
          invite_code?: string | null
          invite_expires_at?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['couples']['Insert']>
        Relationships: []
      }
      couple_members: {
        Row: {
          couple_id: string
          user_id: string
          joined_at: string
        }
        Insert: {
          couple_id: string
          user_id: string
          joined_at?: string
        }
        Update: Partial<Database['public']['Tables']['couple_members']['Insert']>
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      create_couple: {
        Args: { couple_name?: string | null }
        Returns: Database['public']['Tables']['couples']['Row']
      }
      join_couple: { Args: { code: string }; Returns: string }
      regenerate_invite_code: { Args: Record<never, never>; Returns: string }
      leave_couple: { Args: Record<never, never>; Returns: undefined }
      my_couple_id: { Args: Record<never, never>; Returns: string | null }
      partner_id: { Args: Record<never, never>; Returns: string | null }
      is_couple_member: { Args: { target: string }; Returns: boolean }
      health: { Args: Record<never, never>; Returns: Json }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
