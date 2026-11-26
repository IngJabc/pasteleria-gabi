
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_general_notifications": {
                  Row: {
                    "admin_id": string,"created_at": string,"event_key": string,"event_type": string,"id": number,"order_id": number | null,"payment_id": number | null,"product_id": number | null,"read_at": string | null,"receipt_submission_id": number | null,"review_id": number | null,"summary": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id": string,"created_at"?: string,"event_key": string,"event_type": string,"id"?: never,"order_id"?: number | null,"payment_id"?: number | null,"product_id"?: number | null,"read_at"?: string | null,"receipt_submission_id"?: number | null,"review_id"?: number | null,"summary": string
                  }
                  Update: {
                    "admin_id"?: string,"created_at"?: string,"event_key"?: string,"event_type"?: string,"id"?: never,"order_id"?: number | null,"payment_id"?: number | null,"product_id"?: number | null,"read_at"?: string | null,"receipt_submission_id"?: number | null,"review_id"?: number | null,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_general_notifications_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_general_notifications_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_general_notifications_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_general_notifications_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_general_notifications_receipt_submission_id_fkey"
      columns: ["receipt_submission_id"]
isOneToOne: false
      referencedRelation: "receipt_submissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_general_notifications_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "product_reviews"
      referencedColumns: ["id"]
    }
                  ]
                },"admin_notifications": {
                  Row: {
                    "admin_id": string,"created_at": string,"id": number,"interval_bucket": number,"read_at": string | null,"receipt_submission_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id": string,"created_at"?: string,"id"?: never,"interval_bucket": number,"read_at"?: string | null,"receipt_submission_id": number
                  }
                  Update: {
                    "admin_id"?: string,"created_at"?: string,"id"?: never,"interval_bucket"?: number,"read_at"?: string | null,"receipt_submission_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_notifications_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_notifications_receipt_submission_id_fkey"
      columns: ["receipt_submission_id"]
isOneToOne: false
      referencedRelation: "receipt_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"administrators": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"is_active": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id": string,"is_active"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"is_active"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"admin_id": string | null,"created_at": string,"data": Json | null,"entity_id": string,"entity_type": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"admin_id"?: string | null,"created_at"?: string,"data"?: Json | null,"entity_id": string,"entity_type": string,"id"?: never
                  }
                  Update: {
                    "action"?: string,"admin_id"?: string | null,"created_at"?: string,"data"?: Json | null,"entity_id"?: string,"entity_type"?: string,"id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    }
                  ]
                },"cancellation_requests": {
                  Row: {
                    "created_at": string,"customer_reason": string | null,"id": number,"order_id": number,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"source": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_reason"?: string | null,"id"?: never,"order_id": number,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"customer_reason"?: string | null,"id"?: never,"order_id"?: number,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cancellation_requests_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cancellation_requests_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_zones": {
                  Row: {
                    "created_at": string,"description": string | null,"fee_usd": number,"id": number,"is_active": boolean,"name": string,"requires_quote": boolean,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"fee_usd": number,"id"?: never,"is_active"?: boolean,"name": string,"requires_quote"?: boolean,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"fee_usd"?: number,"id"?: never,"is_active"?: boolean,"name"?: string,"requires_quote"?: boolean,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"exchange_rates": {
                  Row: {
                    "created_at": string,"id": number,"idempotency_key": string | null,"is_active": boolean,"note": string | null,"observed_at": string,"rate_ves_per_usd": number,"registered_by": string | null,"source": string | null,"supersedes_id": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"idempotency_key"?: string | null,"is_active"?: boolean,"note"?: string | null,"observed_at": string,"rate_ves_per_usd": number,"registered_by"?: string | null,"source"?: string | null,"supersedes_id"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"idempotency_key"?: string | null,"is_active"?: boolean,"note"?: string | null,"observed_at"?: string,"rate_ves_per_usd"?: number,"registered_by"?: string | null,"source"?: string | null,"supersedes_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "exchange_rates_registered_by_fkey"
      columns: ["registered_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exchange_rates_supersedes_id_fkey"
      columns: ["supersedes_id"]
isOneToOne: false
      referencedRelation: "exchange_rates"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_batches": {
                  Row: {
                    "created_at": string,"created_by": string,"id": number,"initial_quantity": number,"product_id": number,"production_date": string,"remaining_quantity": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: never,"initial_quantity": number,"product_id": number,"production_date": string,"remaining_quantity": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: never,"initial_quantity"?: number,"product_id"?: number,"production_date"?: string,"remaining_quantity"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_batches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "admin_id": string | null,"batch_id": number,"created_at": string,"id": number,"order_id": number | null,"quantity": number,"reason": string | null,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id"?: string | null,"batch_id": number,"created_at"?: string,"id"?: never,"order_id"?: number | null,"quantity": number,"reason"?: string | null,"type": string
                  }
                  Update: {
                    "admin_id"?: string | null,"batch_id"?: number,"created_at"?: string,"id"?: never,"order_id"?: number | null,"quantity"?: number,"reason"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "inventory_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_reservations": {
                  Row: {
                    "batch_id": number,"closed_at": string | null,"correction_window_ends_at": string | null,"created_at": string,"expires_at": string | null,"id": number,"initial_expires_at": string,"order_id": number,"quantity": number,"quote_acceptance_expires_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": number,"closed_at"?: string | null,"correction_window_ends_at"?: string | null,"created_at"?: string,"expires_at"?: string | null,"id"?: never,"initial_expires_at": string,"order_id": number,"quantity": number,"quote_acceptance_expires_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "batch_id"?: number,"closed_at"?: string | null,"correction_window_ends_at"?: string | null,"created_at"?: string,"expires_at"?: string | null,"id"?: never,"initial_expires_at"?: string,"order_id"?: number,"quantity"?: number,"quote_acceptance_expires_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_reservations_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "inventory_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_reservations_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "id": number,"order_id": number,"product_id": number,"product_name": string,"quantity": number,"unit_price_usd": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"order_id": number,"product_id": number,"product_name": string,"quantity": number,"unit_price_usd": number
                  }
                  Update: {
                    "id"?: never,"order_id"?: number,"product_id"?: number,"product_name"?: string,"quantity"?: number,"unit_price_usd"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "additional_instructions": string | null,"address_line": string | null,"address_references": string | null,"bcv_rate_at": string | null,"bcv_rate_ves": number | null,"channel": string,"created_at": string,"customer_name": string | null,"customer_phone": string | null,"delivery_fee_usd": number | null,"delivery_zone_id": number | null,"fulfillment_type": string | null,"id": number,"quote_accepted_at": string | null,"receipt_attempts": number,"rounding_rule": string | null,"status": string,"subtotal_usd": number,"total_usd": number,"total_ves": number | null,"tracking_token_hash": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "additional_instructions"?: string | null,"address_line"?: string | null,"address_references"?: string | null,"bcv_rate_at"?: string | null,"bcv_rate_ves"?: number | null,"channel"?: string,"created_at"?: string,"customer_name"?: string | null,"customer_phone"?: string | null,"delivery_fee_usd"?: number | null,"delivery_zone_id"?: number | null,"fulfillment_type"?: string | null,"id"?: never,"quote_accepted_at"?: string | null,"receipt_attempts"?: number,"rounding_rule"?: string | null,"status"?: string,"subtotal_usd": number,"total_usd": number,"total_ves"?: number | null,"tracking_token_hash"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "additional_instructions"?: string | null,"address_line"?: string | null,"address_references"?: string | null,"bcv_rate_at"?: string | null,"bcv_rate_ves"?: number | null,"channel"?: string,"created_at"?: string,"customer_name"?: string | null,"customer_phone"?: string | null,"delivery_fee_usd"?: number | null,"delivery_zone_id"?: number | null,"fulfillment_type"?: string | null,"id"?: never,"quote_accepted_at"?: string | null,"receipt_attempts"?: number,"rounding_rule"?: string | null,"status"?: string,"subtotal_usd"?: number,"total_usd"?: number,"total_ves"?: number | null,"tracking_token_hash"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_delivery_zone_id_fkey"
      columns: ["delivery_zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_refunds": {
                  Row: {
                    "admin_id": string,"amount": number,"created_at": string,"currency": string,"id": number,"idempotency_key": string | null,"method": string,"payment_id": number,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id": string,"amount": number,"created_at"?: string,"currency": string,"id"?: never,"idempotency_key"?: string | null,"method": string,"payment_id": number,"reason": string
                  }
                  Update: {
                    "admin_id"?: string,"amount"?: number,"created_at"?: string,"currency"?: string,"id"?: never,"idempotency_key"?: string | null,"method"?: string,"payment_id"?: number,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_refunds_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_refunds_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"amount_tendered_usd": number | null,"created_at": string,"currency": string,"id": number,"idempotency_key": string | null,"method": string,"order_id": number,"receipt_path": string | null,"reference": string | null,"registered_by": string | null,"status": string,"updated_at": string,"verified_at": string | null,"verified_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"amount_tendered_usd"?: number | null,"created_at"?: string,"currency": string,"id"?: never,"idempotency_key"?: string | null,"method": string,"order_id": number,"receipt_path"?: string | null,"reference"?: string | null,"registered_by"?: string | null,"status"?: string,"updated_at"?: string,"verified_at"?: string | null,"verified_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"amount_tendered_usd"?: number | null,"created_at"?: string,"currency"?: string,"id"?: never,"idempotency_key"?: string | null,"method"?: string,"order_id"?: number,"receipt_path"?: string | null,"reference"?: string | null,"registered_by"?: string | null,"status"?: string,"updated_at"?: string,"verified_at"?: string | null,"verified_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_registered_by_fkey"
      columns: ["registered_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_verified_by_fkey"
      columns: ["verified_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    }
                  ]
                },"product_images": {
                  Row: {
                    "created_at": string,"id": number,"position": number,"product_id": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"position": number,"product_id": number,"storage_path": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"position"?: number,"product_id"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_review_aggregates": {
                  Row: {
                    "average_rating": number,"product_id": number,"rating_sum": number,"review_count": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "average_rating"?: number,"product_id": number,"rating_sum"?: number,"review_count"?: number,"updated_at"?: string
                  }
                  Update: {
                    "average_rating"?: number,"product_id"?: number,"rating_sum"?: number,"review_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_review_aggregates_product_id_fkey"
      columns: ["product_id"]
isOneToOne: true
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_reviews": {
                  Row: {
                    "comment": string,"created_at": string,"hidden_at": string | null,"hidden_by": string | null,"id": number,"is_hidden": boolean,"is_verified_purchase": boolean,"order_id": number | null,"product_id": number,"rating": number,"reviewer_name": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment": string,"created_at"?: string,"hidden_at"?: string | null,"hidden_by"?: string | null,"id"?: never,"is_hidden"?: boolean,"is_verified_purchase"?: boolean,"order_id"?: number | null,"product_id": number,"rating": number,"reviewer_name"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"hidden_at"?: string | null,"hidden_by"?: string | null,"id"?: never,"is_hidden"?: boolean,"is_verified_purchase"?: boolean,"order_id"?: number | null,"product_id"?: number,"rating"?: number,"reviewer_name"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_reviews_hidden_by_fkey"
      columns: ["hidden_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "created_at": string,"description": string,"id": number,"is_active": boolean,"name": string,"price_usd": number,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description": string,"id"?: never,"is_active"?: boolean,"name": string,"price_usd": number,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: never,"is_active"?: boolean,"name"?: string,"price_usd"?: number,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"bcv_sync_attempts": {
                  Row: {
                    "attempted_at": string,"created_at": string,"effective_date": string | null,"error_code": string | null,"error_detail": string | null,"id": number,"idempotency_key": string,"provider_updated_at": string | null,"rate_ves_per_usd": number | null,"registered_rate_id": number | null,"retrieved_at": string | null,"schedule_slot": string,"source": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempted_at"?: string,"created_at"?: string,"effective_date"?: string | null,"error_code"?: string | null,"error_detail"?: string | null,"id"?: never,"idempotency_key": string,"provider_updated_at"?: string | null,"rate_ves_per_usd"?: number | null,"registered_rate_id"?: number | null,"retrieved_at"?: string | null,"schedule_slot": string,"source": string,"status": string
                  }
                  Update: {
                    "attempted_at"?: string,"created_at"?: string,"effective_date"?: string | null,"error_code"?: string | null,"error_detail"?: string | null,"id"?: never,"idempotency_key"?: string,"provider_updated_at"?: string | null,"rate_ves_per_usd"?: number | null,"registered_rate_id"?: number | null,"retrieved_at"?: string | null,"schedule_slot"?: string,"source"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bcv_sync_attempts_registered_rate_id_fkey"
      columns: ["registered_rate_id"]
isOneToOne: false
      referencedRelation: "exchange_rates"
      referencedColumns: ["id"]
    }
                  ]
                },"receipt_submissions": {
                  Row: {
                    "attempt_number": number,"id": number,"order_id": number,"payment_id": number | null,"review_status": string,"reviewed_at": string | null,"submitted_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_number": number,"id"?: never,"order_id": number,"payment_id"?: number | null,"review_status"?: string,"reviewed_at"?: string | null,"submitted_at"?: string
                  }
                  Update: {
                    "attempt_number"?: number,"id"?: never,"order_id"?: number,"payment_id"?: number | null,"review_status"?: string,"reviewed_at"?: string | null,"submitted_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipt_submissions_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "receipt_submissions_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"store_settings": {
                  Row: {
                    "business_hours": Json | null,"id": number,"payment_instructions": Json | null,"pickup_address": string | null,"updated_at": string,"updated_by": string | null,"whatsapp_phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_hours"?: Json | null,"id": number,"payment_instructions"?: Json | null,"pickup_address"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_phone"?: string | null
                  }
                  Update: {
                    "business_hours"?: Json | null,"id"?: number,"payment_instructions"?: Json | null,"pickup_address"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_phone"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "administrators"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_quote_fee":
{ Args: { "p_order_id": number }; Returns: Json
                           },
"accept_quote_fee_for_tracking":
{ Args: { "p_token": string }; Returns: Json
                           },
"adjust_inventory":
{ Args: { "p_batch_id": number,"p_quantity": number,"p_reason": string }; Returns: number
                           },
"apply_bcv_rate_for_tracking":
{ Args: { "p_token": string }; Returns: Json
                           },
"apply_bcv_rate_to_order":
{ Args: { "p_admin_id": string,"p_order_id": number }; Returns: Json
                           },
"approve_payment":
{ Args: { "p_admin_id": string,"p_payment_id": number }; Returns: Json
                           },
"approve_receipt_submission":
{ Args: { "p_order_id": number }; Returns: Json
                           },
"consume_order_reservations":
{ Args: { "p_order_id": number }; Returns: number
                           },
"create_inventory_batch":
{ Args: { "p_initial_quantity": number,"p_product_id": number,"p_production_date"?: string }; Returns: number
                           },
"create_online_order":
{ Args: { "p_additional_instructions": string,"p_address_line": string,"p_address_references": string,"p_customer_name": string,"p_customer_phone": string,"p_delivery_zone_id": number,"p_fulfillment_type": string,"p_items": Json }; Returns: Json
                           },
"create_online_order_with_bcv":
{ Args: { "p_additional_instructions": string,"p_address_line": string,"p_address_references": string,"p_customer_name": string,"p_customer_phone": string,"p_delivery_zone_id": number,"p_fulfillment_type": string,"p_items": Json }; Returns: Json
                           },
"deactivate_bcv_rate":
{ Args: { "p_admin_id": string,"p_rate_id": number }; Returns: Json
                           },
"get_bcv_rate":
{ Args: { "p_as_of"?: string }; Returns: Json
                           },
"get_last_ves_per_usd":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"get_order_for_tracking":
{ Args: { "p_token": string }; Returns: Json
                           },
"get_order_payment_summary":
{ Args: { "p_order_id": number }; Returns: Json
                           },
"get_product_stock":
{ Args: { "p_product_id": number }; Returns: {
              "available_quantity": number,"product_id": number,"remaining_quantity": number,"reserved_quantity": number
            }[]
                           },
"hold_order_reservations":
{ Args: { "p_order_id": number }; Returns: number
                           },
"notify_online_order_formalized":
{ Args: { "p_order_id": number }; Returns: number
                           },
"open_order_correction_window":
{ Args: { "p_order_id": number }; Returns: number
                           },
"process_sla_notifications":
{ Args: { "p_now"?: string }; Returns: Json
                           },
"record_refund":
{ Args: { "p_admin_id": string,"p_amount": number,"p_idempotency_key": string,"p_method": string,"p_payment_id": number,"p_reason": string }; Returns: Json
                           },
"register_bcv_rate":
{ Args: { "p_admin_id": string,"p_idempotency_key"?: string,"p_note"?: string,"p_observed_at"?: string,"p_rate_ves_per_usd": number,"p_source": string,"p_supersedes_id"?: number }; Returns: Json
                           },
"register_payment":
{ Args: { "p_amount": number,"p_amount_tendered_usd": number,"p_collected"?: boolean,"p_currency": string,"p_idempotency_key": string,"p_method": string,"p_order_id": number,"p_receipt_path": string,"p_reference": string,"p_registered_by"?: string }; Returns: Json
                           },
"register_payment_for_tracking":
{ Args: { "p_amount": number,"p_idempotency_key": string,"p_method": string,"p_receipt_path": string,"p_reference": string,"p_token": string }; Returns: Json
                           },
"register_pos_cash_sale":
{ Args: { "p_admin_id": string,"p_amount_tendered_usd": number,"p_idempotency_key": string,"p_items": Json }; Returns: Json
                           },
"reject_payment":
{ Args: { "p_admin_id": string,"p_payment_id": number }; Returns: Json
                           },
"release_expired_reservations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"release_order_reservations":
{ Args: { "p_order_id": number }; Returns: number
                           },
"request_order_cancellation":
{ Args: { "p_reason": string,"p_token": string }; Returns: number
                           },
"set_product_review_hidden":
{ Args: { "p_hidden": boolean,"p_review_id": number }; Returns: { [key: string]: unknown }
                           },
"submit_payment_evidence":
{ Args: { "p_payment_id": number }; Returns: Json
                           },
"submit_product_review":
{ Args: { "p_comment": string,"p_product_id": number,"p_rating": number,"p_reviewer_name": string | null,"p_submitter_key": string | null,"p_tracking_token": string | null }; Returns: Json
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
