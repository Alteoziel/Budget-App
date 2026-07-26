"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseAuthOptions } from "@/lib/supabase/auth-options";
import { getSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey, {
    auth: supabaseAuthOptions,
  });
}
