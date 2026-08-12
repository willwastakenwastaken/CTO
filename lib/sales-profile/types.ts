// Persistence row shape for sales_profiles — column names MUST match
// migrations/001_initial_schema.sql. All server-side; user_id is derived from
// the session and never browser-supplied. RLS (migrations/002) enforces
// ownership. Missing fields stay NULL — never fictional.
export interface SalesProfileRow {
  id: string;
  user_id: string;
  name: string | null;
  product_name: string | null;
  description: string | null;
  pricing: string | null;
  ideal_customer: string | null;
  benefits: string | null;
  problems_solved: string | null;
  differentiators: string | null;
  call_goal: string | null;
  preferred_cta: string | null;
  sales_process: string | null;
  objections: string[];
  guardrails: string[];
  is_default: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}
