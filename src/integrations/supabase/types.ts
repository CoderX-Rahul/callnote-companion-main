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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      call_reports: {
        Row: {
          ai_doctor_choices: Json
          ai_effectiveness: Json | null
          ai_intelligence: Json | null
          ai_product_choices: Json
          ai_questions: string[]
          ai_unknown_fields: string[]
          approved_at: string | null
          call_date_only: string | null
          call_datetime: string | null
          clinic: string | null
          created_at: string
          doctor_id: string | null
          doctor_name: string | null
          edit_count: number
          effectiveness: Json
          feedback: string | null
          follow_up_action: string | null
          follow_up_done: boolean
          follow_up_due: string | null
          glossary_version: string | null
          id: string
          intelligence: Json
          materials_requested: string | null
          mr_profile_id: string
          normalized_note: string | null
          organization_id: string
          original_doctor_mention: string | null
          original_note: string
          product_ids: string[]
          product_names: string[]
          purpose: string | null
          rep_name: string
          specialty: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_doctor_choices?: Json
          ai_effectiveness?: Json | null
          ai_intelligence?: Json | null
          ai_product_choices?: Json
          ai_questions?: string[]
          ai_unknown_fields?: string[]
          approved_at?: string | null
          call_date_only?: string | null
          call_datetime?: string | null
          clinic?: string | null
          created_at?: string
          doctor_id?: string | null
          doctor_name?: string | null
          edit_count?: number
          effectiveness?: Json
          feedback?: string | null
          follow_up_action?: string | null
          follow_up_done?: boolean
          follow_up_due?: string | null
          glossary_version?: string | null
          id?: string
          intelligence?: Json
          materials_requested?: string | null
          mr_profile_id: string
          normalized_note?: string | null
          organization_id: string
          original_doctor_mention?: string | null
          original_note: string
          product_ids?: string[]
          product_names?: string[]
          purpose?: string | null
          rep_name?: string
          specialty?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_doctor_choices?: Json
          ai_effectiveness?: Json | null
          ai_intelligence?: Json | null
          ai_product_choices?: Json
          ai_questions?: string[]
          ai_unknown_fields?: string[]
          approved_at?: string | null
          call_date_only?: string | null
          call_datetime?: string | null
          clinic?: string | null
          created_at?: string
          doctor_id?: string | null
          doctor_name?: string | null
          edit_count?: number
          effectiveness?: Json
          feedback?: string | null
          follow_up_action?: string | null
          follow_up_done?: boolean
          follow_up_due?: string | null
          glossary_version?: string | null
          id?: string
          intelligence?: Json
          materials_requested?: string | null
          mr_profile_id?: string
          normalized_note?: string | null
          organization_id?: string
          original_doctor_mention?: string | null
          original_note?: string
          product_ids?: string[]
          product_names?: string[]
          purpose?: string | null
          rep_name?: string
          specialty?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_reports_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_reports_mr_profile_id_fkey"
            columns: ["mr_profile_id"]
            isOneToOne: false
            referencedRelation: "mr_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          city: string | null
          clinic: string | null
          id: string
          name: string
          specialty: string | null
        }
        Insert: {
          city?: string | null
          clinic?: string | null
          id: string
          name: string
          specialty?: string | null
        }
        Update: {
          city?: string | null
          clinic?: string | null
          id?: string
          name?: string
          specialty?: string | null
        }
        Relationships: []
      }
      mr_profiles: {
        Row: {
          active: boolean
          created_at: string
          division: string | null
          employee_code: string | null
          full_name: string
          headquarters: string | null
          id: string
          organization_id: string
          role: string
          territory: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          division?: string | null
          employee_code?: string | null
          full_name: string
          headquarters?: string | null
          id?: string
          organization_id: string
          role?: string
          territory?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          division?: string | null
          employee_code?: string | null
          full_name?: string
          headquarters?: string | null
          id?: string
          organization_id?: string
          role?: string
          territory?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mr_profiles_organization_id_fkey"
            columns: ["organization_id"]
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
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          id: string
          name: string
        }
        Insert: {
          category?: string | null
          id: string
          name: string
        }
        Update: {
          category?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      report_barriers: {
        Row: {
          category: string
          evidence: string | null
          is_primary: boolean
          position: number
          report_id: string
          status: string
          suggested_followup_action: string | null
        }
        Insert: {
          category: string
          evidence?: string | null
          is_primary?: boolean
          position: number
          report_id: string
          status: string
          suggested_followup_action?: string | null
        }
        Update: {
          category?: string
          evidence?: string | null
          is_primary?: boolean
          position?: number
          report_id?: string
          status?: string
          suggested_followup_action?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_barriers_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "call_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_collateral: {
        Row: {
          detail: string | null
          material_type: string
          position: number
          report_id: string
        }
        Insert: {
          detail?: string | null
          material_type: string
          position: number
          report_id: string
        }
        Update: {
          detail?: string | null
          material_type?: string
          position?: number
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_collateral_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "call_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_commitments: {
        Row: {
          commitment_date: string | null
          evidence: string | null
          follow_up_outcome: string | null
          position: number
          report_id: string
          status: string
          trial_patient_count: number | null
        }
        Insert: {
          commitment_date?: string | null
          evidence?: string | null
          follow_up_outcome?: string | null
          position: number
          report_id: string
          status: string
          trial_patient_count?: number | null
        }
        Update: {
          commitment_date?: string | null
          evidence?: string | null
          follow_up_outcome?: string | null
          position?: number
          report_id?: string
          status?: string
          trial_patient_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_commitments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "call_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_competitors: {
        Row: {
          ambiguous: boolean
          brand_discussed: string | null
          candidate_ids: string[]
          evidence: string | null
          identity_confirmed: boolean
          original_mention: string
          position: number
          preference_detail: string | null
          product_id: string | null
          reason_for_preference: string
          report_id: string
          sentiment: string
        }
        Insert: {
          ambiguous?: boolean
          brand_discussed?: string | null
          candidate_ids?: string[]
          evidence?: string | null
          identity_confirmed?: boolean
          original_mention: string
          position: number
          preference_detail?: string | null
          product_id?: string | null
          reason_for_preference: string
          report_id: string
          sentiment: string
        }
        Update: {
          ambiguous?: boolean
          brand_discussed?: string | null
          candidate_ids?: string[]
          evidence?: string | null
          identity_confirmed?: boolean
          original_mention?: string
          position?: number
          preference_detail?: string | null
          product_id?: string | null
          reason_for_preference?: string
          report_id?: string
          sentiment?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_competitors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_competitors_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "call_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_edits: {
        Row: {
          actor_user_id: string | null
          edited_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          report_id: string
        }
        Insert: {
          actor_user_id?: string | null
          edited_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          report_id: string
        }
        Update: {
          actor_user_id?: string | null
          edited_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_edits_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "call_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_samples: {
        Row: {
          distribution_status: string
          evidence: string | null
          position: number
          product_id: string | null
          product_mention: string
          quantity: number | null
          report_id: string
        }
        Insert: {
          distribution_status: string
          evidence?: string | null
          position: number
          product_id?: string | null
          product_mention: string
          quantity?: number | null
          report_id: string
        }
        Update: {
          distribution_status?: string
          evidence?: string | null
          position?: number
          product_id?: string | null
          product_mention?: string
          quantity?: number | null
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_samples_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_samples_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "call_reports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
