import type { Database as GeneratedDatabase } from "./database.types";

type GeneratedPublicSchema = GeneratedDatabase["public"];
type GeneratedFunctions = GeneratedPublicSchema["Functions"];

type OverrideFunction<
  FunctionName extends keyof GeneratedFunctions,
  Args extends object,
> = {
  [Name in FunctionName]: Omit<GeneratedFunctions[Name], "Args"> & { Args: Args };
};

/**
 * Generated types map PostgreSQL `numeric` to `number`; this client contract
 * preserves the decimal strings and explicit nulls already validated by the server.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublicSchema, "Functions"> & {
    Functions: Omit<
      GeneratedFunctions,
      | "record_refund"
      | "register_bcv_rate"
      | "register_payment"
      | "register_payment_for_tracking"
      | "register_pos_cash_sale"
    > &
      OverrideFunction<
        "record_refund",
        Omit<GeneratedFunctions["record_refund"]["Args"], "p_amount"> & {
          p_amount: string;
        }
      > &
      OverrideFunction<
        "register_bcv_rate",
        Omit<
          GeneratedFunctions["register_bcv_rate"]["Args"],
          "p_note" | "p_observed_at" | "p_rate_ves_per_usd" | "p_supersedes_id"
        > & {
          p_rate_ves_per_usd: string;
          p_observed_at?: string | null;
          p_supersedes_id?: number | null;
          p_note?: string | null;
        }
      > &
      OverrideFunction<
        "register_payment",
        Omit<
          GeneratedFunctions["register_payment"]["Args"],
          "p_amount" | "p_amount_tendered_usd" | "p_receipt_path" | "p_reference"
        > & {
          p_amount: string;
          p_amount_tendered_usd: string;
          p_reference: string | null;
          p_receipt_path: string | null;
        }
      > &
      OverrideFunction<
        "register_payment_for_tracking",
        Omit<GeneratedFunctions["register_payment_for_tracking"]["Args"], "p_amount"> & {
          p_amount: string;
        }
      > &
      OverrideFunction<
        "register_pos_cash_sale",
        Omit<GeneratedFunctions["register_pos_cash_sale"]["Args"], "p_amount_tendered_usd"> & {
          p_amount_tendered_usd: string;
        }
      >;
  };
};
