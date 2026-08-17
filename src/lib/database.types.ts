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
      customers: {
        Row: {
          address_line_1: string
          archived_at: string | null
          city: string
          color: string
          created_at: string
          customer_code: string
          delivery_notes: string | null
          id: string
          initials: string
          is_active: boolean
          location: string
          name: string
          phone: string
          slug: string
          updated_at: string
        }
        Insert: {
          address_line_1?: string
          archived_at?: string | null
          city?: string
          color?: string
          created_at?: string
          customer_code: string
          delivery_notes?: string | null
          id?: string
          initials: string
          is_active?: boolean
          location: string
          name: string
          phone?: string
          slug: string
          updated_at?: string
        }
        Update: {
          address_line_1?: string
          archived_at?: string | null
          city?: string
          color?: string
          created_at?: string
          customer_code?: string
          delivery_notes?: string | null
          id?: string
          initials?: string
          is_active?: boolean
          location?: string
          name?: string
          phone?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_activation_challenges: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          issued_by: string | null
          purpose: string
          profile_id: string | null
          request_fingerprint: string | null
          secret_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          issued_by?: string | null
          purpose?: string
          profile_id?: string | null
          request_fingerprint?: string | null
          secret_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          issued_by?: string | null
          purpose?: string
          profile_id?: string | null
          request_fingerprint?: string | null
          secret_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_activation_challenges_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_activation_challenges_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_access_attempts: {
        Row: {
          created_at: string
          id: number
          request_fingerprint: string
          successful: boolean
        }
        Insert: {
          created_at?: string
          id?: never
          request_fingerprint: string
          successful?: boolean
        }
        Update: {
          created_at?: string
          id?: never
          request_fingerprint?: string
          successful?: boolean
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          customer_id: string
          delivery_date: string
          id: string
          notes: string | null
          order_number: number
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          customer_id: string
          delivery_date: string
          id?: string
          notes?: string | null
          order_number?: never
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          customer_id?: string
          delivery_date?: string
          id?: string
          notes?: string | null
          order_number?: never
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      product_price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          new_price: number
          old_price: number
          product_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_price: number
          old_price: number
          product_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_price?: number
          old_price?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          created_at: string
          detail: string
          id: string
          is_active: boolean
          name: string
          price: number
          tone: string
          unit: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          detail: string
          id: string
          is_active?: boolean
          name: string
          price: number
          tone?: string
          unit: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          detail?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          tone?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_status: string
          activated_at: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          customer_id: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          access_status?: string
          activated_at?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id?: string | null
          full_name?: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          access_status?: string
          activated_at?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "order_summaries"
            referencedColumns: ["customer_id"]
          },
        ]
      }
    }
    Views: {
      order_summaries: {
        Row: {
          created_at: string | null
          customer_color: string | null
          customer_id: string | null
          customer_initials: string | null
          customer_location: string | null
          customer_name: string | null
          customer_slug: string | null
          delivery_date: string | null
          id: string | null
          item_count: number | null
          order_number: number | null
          status: string | null
          total: number | null
          total_kg: number | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      advance_order_status: {
        Args: { p_actor_id: string; p_next_status: string; p_order_id: string }
        Returns: undefined
      }
      complete_customer_activation: {
        Args: { p_profile_id: string; p_secret_hash: string }
        Returns: boolean
      }
      redeem_customer_access_code: {
        Args: {
          p_contact_email: string
          p_customer_code: string
          p_purpose: string
          p_secret_hash: string
        }
        Returns: {
          access_status: string
          challenge_id: string
          profile_id: string
        }[]
      }
      cancel_pending_order: {
        Args: { p_actor_id: string; p_order_id: string }
        Returns: undefined
      }
      place_order: {
        Args: {
          p_actor_id: string
          p_delivery_date?: string
          p_items: Json
          p_notes?: string
        }
        Returns: string
      }
      update_pending_order: {
        Args: {
          p_actor_id: string
          p_delivery_date: string
          p_items: Json
          p_notes?: string
          p_order_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "customer"
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
    Enums: {
      app_role: ["admin", "customer"],
    },
  },
} as const
