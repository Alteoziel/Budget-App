/**
 * Shared Auth options for every Supabase client.
 * Passkeys are experimental in supabase-js and require an explicit opt-in.
 */
export const supabaseAuthOptions = {
  experimental: { passkey: true as const },
};
