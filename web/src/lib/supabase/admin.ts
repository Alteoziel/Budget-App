import { createClient } from "@supabase/supabase-js";
import { supabaseAuthOptions } from "@/lib/supabase/auth-options";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Elevated backend client for cron / webhooks (bypasses RLS).
 * Prefer Supabase secret keys (`sb_secret_…`) over the legacy service_role JWT.
 */
export function createServiceClient() {
  const { url } = getSupabaseEnv();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY. " +
        "Create a secret key in Supabase → Settings → API Keys and add it in Doppler.",
    );
  }
  return createClient(url, secretKey, {
    auth: {
      ...supabaseAuthOptions,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
