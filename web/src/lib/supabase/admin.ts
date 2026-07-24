import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** Service-role client for cron / trusted server jobs (bypasses RLS). */
export function createServiceClient() {
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it in Doppler and sync to Vercel.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
