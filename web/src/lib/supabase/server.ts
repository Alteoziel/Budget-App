import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { supabaseAuthOptions } from "@/lib/supabase/auth-options";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** One Supabase server client per request (deduped across layout + pages). */
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — middleware will refresh sessions.
        }
      },
    },
    auth: supabaseAuthOptions,
  });
});
