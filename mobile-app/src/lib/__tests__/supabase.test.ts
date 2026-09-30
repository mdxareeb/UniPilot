/**
 * The Supabase wiring's honest-default test: a build without the public env
 * pair must report "not configured" and expose no client — never a
 * half-configured client and never a secret path.
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

describe("supabase client wiring", () => {
  it("reports unconfigured when the env pair is absent (jest has no EXPO_PUBLIC_*)", () => {
    expect(process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").toBe("");
    expect(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").toBe("");
    expect(isSupabaseConfigured).toBe(false);
    expect(supabase).toBeNull();
  });
});
