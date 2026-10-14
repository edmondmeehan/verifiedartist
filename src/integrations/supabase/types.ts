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
      artist_public_pages: {
        Row: {
          artist_id: string
          created_at: string
          faq: Json
          footer_badge_text: string
          footer_caption: string
          headline: string | null
          id: string
          intro_stats: Json
          live_snapshot: Json
          official_channels: Json
          published: boolean
          slug: string
          start_here: Json
          updated_at: string
        }
        Insert: {
          artist_id: string
          created_at?: string
          faq?: Json
          footer_badge_text?: string
          footer_caption?: string
          headline?: string | null
          id?: string
          intro_stats?: Json
          live_snapshot?: Json
          official_channels?: Json
          published?: boolean
          slug: string
          start_here?: Json
          updated_at?: string
        }
        Update: {
          artist_id?: string
          created_at?: string
          faq?: Json
          footer_badge_text?: string
          footer_caption?: string
          headline?: string | null
          id?: string
          intro_stats?: Json
          live_snapshot?: Json
          official_channels?: Json
          published?: boolean
          slug?: string
          start_here?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artist_public_pages_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: true
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          bandsintown_id: string | null
          created_at: string
          id: string
          image_url: string | null
          last_auto_audit_at: string | null
          name: string
          official_site_url: string | null
          org_id: string
          spotify_id: string | null
          spotify_snapshot: Json | null
          spotify_synced_at: string | null
          status: Database["public"]["Enums"]["artist_status"]
          updated_at: string
          wikidata_qid: string | null
          x_handle: string | null
          youtube_channel_id: string | null
        }
        Insert: {
          bandsintown_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          last_auto_audit_at?: string | null
          name: string
          official_site_url?: string | null
          org_id: string
          spotify_id?: string | null
          spotify_snapshot?: Json | null
          spotify_synced_at?: string | null
          status?: Database["public"]["Enums"]["artist_status"]
          updated_at?: string
          wikidata_qid?: string | null
          x_handle?: string | null
          youtube_channel_id?: string | null
        }
        Update: {
          bandsintown_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          last_auto_audit_at?: string | null
          name?: string
          official_site_url?: string | null
          org_id?: string
          spotify_id?: string | null
          spotify_snapshot?: Json | null
          spotify_synced_at?: string | null
          status?: Database["public"]["Enums"]["artist_status"]
          updated_at?: string
          wikidata_qid?: string | null
          x_handle?: string | null
          youtube_channel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artists_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_queries: {
        Row: {
          artist_id: string
          category: Database["public"]["Enums"]["audit_category"]
          created_at: string
          enabled: boolean
          id: string
          query_text: string
        }
        Insert: {
          artist_id: string
          category?: Database["public"]["Enums"]["audit_category"]
          created_at?: string
          enabled?: boolean
          id?: string
          query_text: string
        }
        Update: {
          artist_id?: string
          category?: Database["public"]["Enums"]["audit_category"]
          created_at?: string
          enabled?: boolean
          id?: string
          query_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_queries_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_runs: {
        Row: {
          agent: Database["public"]["Enums"]["audit_agent"]
          artist_id: string
          discrepancies: Json | null
          id: string
          links: Json | null
          query_id: string | null
          response_text: string | null
          run_at: string
          staleness_days: number | null
          verdict: Database["public"]["Enums"]["audit_verdict"]
        }
        Insert: {
          agent: Database["public"]["Enums"]["audit_agent"]
          artist_id: string
          discrepancies?: Json | null
          id?: string
          links?: Json | null
          query_id?: string | null
          response_text?: string | null
          run_at?: string
          staleness_days?: number | null
          verdict?: Database["public"]["Enums"]["audit_verdict"]
        }
        Update: {
          agent?: Database["public"]["Enums"]["audit_agent"]
          artist_id?: string
          discrepancies?: Json | null
          id?: string
          links?: Json | null
          query_id?: string | null
          response_text?: string | null
          run_at?: string
          staleness_days?: number | null
          verdict?: Database["public"]["Enums"]["audit_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "audit_runs_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_runs_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "audit_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_records: {
        Row: {
          artist_id: string
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_current: boolean
          version: number
        }
        Insert: {
          artist_id: string
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          is_current?: boolean
          version: number
        }
        Update: {
          artist_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_current?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "canonical_records_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_log: {
        Row: {
          artist_id: string
          delivery_detail: string | null
          delivery_status: string
          id: string
          payload_summary: string | null
          propagation_confirmed_at: string | null
          pushed_at: string
          sla_met: boolean | null
          target: Database["public"]["Enums"]["dist_target"]
          verification_id: string | null
        }
        Insert: {
          artist_id: string
          delivery_detail?: string | null
          delivery_status?: string
          id?: string
          payload_summary?: string | null
          propagation_confirmed_at?: string | null
          pushed_at?: string
          sla_met?: boolean | null
          target: Database["public"]["Enums"]["dist_target"]
          verification_id?: string | null
        }
        Update: {
          artist_id?: string
          delivery_detail?: string | null
          delivery_status?: string
          id?: string
          payload_summary?: string | null
          propagation_confirmed_at?: string | null
          pushed_at?: string
          sla_met?: boolean | null
          target?: Database["public"]["Enums"]["dist_target"]
          verification_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "distribution_log_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_log_verification_fk"
            columns: ["verification_id"]
            isOneToOne: false
            referencedRelation: "update_verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_targets: {
        Row: {
          artist_id: string
          config: Json | null
          created_at: string
          id: string
          last_pushed_at: string | null
          status: Database["public"]["Enums"]["dist_status"]
          target: Database["public"]["Enums"]["dist_target"]
          updated_at: string
        }
        Insert: {
          artist_id: string
          config?: Json | null
          created_at?: string
          id?: string
          last_pushed_at?: string | null
          status?: Database["public"]["Enums"]["dist_status"]
          target: Database["public"]["Enums"]["dist_target"]
          updated_at?: string
        }
        Update: {
          artist_id?: string
          config?: Json | null
          created_at?: string
          id?: string
          last_pushed_at?: string | null
          status?: Database["public"]["Enums"]["dist_status"]
          target?: Database["public"]["Enums"]["dist_target"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_targets_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      org_connections: {
        Row: {
          api_key: string | null
          created_at: string
          created_by: string | null
          id: string
          last_sync_at: string | null
          last_sync_details: Json | null
          last_sync_error: string | null
          last_sync_status: string | null
          meta: Json
          org_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_details?: Json | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          meta?: Json
          org_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_details?: Json | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          meta?: Json
          org_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          last_weekly_email_at: string | null
          name: string
          plan: Database["public"]["Enums"]["plan_type"]
          seats: number
          updated_at: string
          weekly_email_enabled: boolean
          weekly_email_recipients: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          last_weekly_email_at?: string | null
          name: string
          plan?: Database["public"]["Enums"]["plan_type"]
          seats?: number
          updated_at?: string
          weekly_email_enabled?: boolean
          weekly_email_recipients?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          last_weekly_email_at?: string | null
          name?: string
          plan?: Database["public"]["Enums"]["plan_type"]
          seats?: number
          updated_at?: string
          weekly_email_enabled?: boolean
          weekly_email_recipients?: string[]
        }
        Relationships: []
      }
      platform_user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      update_verifications: {
        Row: {
          artist_id: string
          baseline_result: Json | null
          canonical_version: number
          change_summary: string | null
          changes: Json | null
          checks_done: number
          created_at: string
          id: string
          kind: string
          last_checked_at: string | null
          last_result: Json | null
          next_check_at: string
          status: string
          verified_at: string | null
        }
        Insert: {
          artist_id: string
          baseline_result?: Json | null
          canonical_version: number
          change_summary?: string | null
          changes?: Json | null
          checks_done?: number
          created_at?: string
          id?: string
          kind?: string
          last_checked_at?: string | null
          last_result?: Json | null
          next_check_at?: string
          status?: string
          verified_at?: string | null
        }
        Update: {
          artist_id?: string
          baseline_result?: Json | null
          canonical_version?: number
          change_summary?: string | null
          changes?: Json | null
          checks_done?: number
          created_at?: string
          id?: string
          kind?: string
          last_checked_at?: string | null
          last_result?: Json | null
          next_check_at?: string
          status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "update_verifications_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_platform_role: {
        Args: {
          _role: Database["public"]["Enums"]["platform_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_staff: { Args: { _user_id: string }; Returns: boolean }
      org_role_of: {
        Args: { _org_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
    }
    Enums: {
      artist_status: "active" | "paused" | "archived"
      audit_agent: "chatgpt" | "claude" | "gemini" | "perplexity" | "grok"
      audit_category: "tour" | "release" | "bio" | "tickets" | "general"
      audit_verdict: "accurate" | "stale" | "wrong" | "missing" | "pending"
      dist_status: "connected" | "pending" | "manual" | "error"
      dist_target:
        | "artist_site"
        | "bandsintown"
        | "songkick"
        | "wikidata"
        | "google_sitemap"
        | "indexnow"
        | "spotify"
        | "x"
      org_role: "owner" | "admin" | "member" | "editor" | "viewer"
      plan_type: "per_artist" | "enterprise"
      platform_role: "super_admin" | "staff"
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
      artist_status: ["active", "paused", "archived"],
      audit_agent: ["chatgpt", "claude", "gemini", "perplexity", "grok"],
      audit_category: ["tour", "release", "bio", "tickets", "general"],
      audit_verdict: ["accurate", "stale", "wrong", "missing", "pending"],
      dist_status: ["connected", "pending", "manual", "error"],
      dist_target: [
        "artist_site",
        "bandsintown",
        "songkick",
        "wikidata",
        "google_sitemap",
        "indexnow",
        "spotify",
        "x",
      ],
      org_role: ["owner", "admin", "member", "editor", "viewer"],
      plan_type: ["per_artist", "enterprise"],
      platform_role: ["super_admin", "staff"],
    },
  },
} as const
