import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { Session, User } from "@supabase/supabase-js";

import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AUTH_COPY, signInErrorMessage } from "./authErrors";
import {
  exchangeAuthCode,
  parseAuthCallbackUrl,
  startGoogleSignIn,
  type OAuthResult,
} from "./oauth";

/** The owner-scoped profile projection the app renders. */
export type ProfileItem = {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  timezone: string;
  onboardingComplete: boolean;
  institution: string | null;
  courseProgram: string | null;
  academicYear: number | null;
  semester: number | null;
};

export type ProfileEditFields = {
  firstName: string | null;
  lastName: string | null;
  timezone: string;
};

export type AuthStatus = "loading" | "unconfigured" | "signed_out" | "signed_in";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  profile: ProfileItem | null;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Google OAuth through the in-app browser (PKCE + the app deep link). */
  signInWithGoogle: () => Promise<OAuthResult>;
  /** Process a deep-linked callback URL (cold or warm app start). */
  completeAuthCallback: (url: string) => Promise<OAuthResult>;
  signOut: () => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  /** Owner-only profile update (name + timezone); RLS is the authority. */
  saveProfile: (fields: ProfileEditFields) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The one auth provider (M2a): session lifecycle against the LOCAL Supabase,
 * the owner-scoped profile read, and the four honest statuses. No guest mode —
 * the app opens on auth (approved product decision, plan §B).
 *
 * Session persistence is the Supabase client's job through the secure-store
 * adapter; this provider only reads it, subscribes to changes, and pauses
 * auto-refresh while the app is backgrounded (the supabase-js RN contract).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? "loading" : "unconfigured",
  );
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileItem | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const readProfile = useCallback(async (nextUser: User | null) => {
    if (supabase === null || nextUser === null) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    setProfileError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "first_name, last_name, timezone, onboarding_completed_at, institution, course_program, academic_year, semester",
      )
      .eq("id", nextUser.id)
      .maybeSingle();

    if (error) {
      setProfile(null);
      setProfileError(AUTH_COPY.PROFILE_FAILED);
      return;
    }
    if (data === null) {
      setProfile(null);
      return;
    }

    const fullName = [data.first_name, data.last_name]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join(" ")
      .trim();

    setProfile({
      fullName: fullName === "" ? null : fullName,
      firstName: data.first_name,
      lastName: data.last_name,
      timezone: data.timezone ?? "UTC",
      onboardingComplete: data.onboarding_completed_at !== null,
      institution: data.institution,
      courseProgram: data.course_program,
      academicYear: data.academic_year,
      semester: data.semester,
    });
  }, []);

  useEffect(() => {
    const client = supabase;
    if (client === null) return;
    let active = true;

    const applySession = (session: Session | null) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus(session ? "signed_in" : "signed_out");
      void readProfile(session?.user ?? null);
    };

    client.auth
      .getSession()
      .then(({ data }) => applySession(data.session))
      .catch(() => {
        if (active) setStatus("signed_out");
      });

    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => applySession(session),
    );

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        client.auth.startAutoRefresh();
      } else {
        client.auth.stopAutoRefresh();
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, [readProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (supabase === null) return { error: AUTH_COPY.UNCONFIGURED };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error ? signInErrorMessage(error) : null };
  }, []);

  const signOut = useCallback(async () => {
    if (supabase === null) return { error: AUTH_COPY.UNCONFIGURED };
    const { error } = await supabase.auth.signOut();
    return { error: error ? AUTH_COPY.SIGNOUT_FAILED : null };
  }, []);

  const signInWithGoogle = useCallback(async () => startGoogleSignIn(), []);

  const completeAuthCallback = useCallback(
    async (url: string): Promise<OAuthResult> => {
      const { code, error, flowId } = parseAuthCallbackUrl(url);
      if (error !== null) {
        return { status: "error", error: AUTH_COPY.GOOGLE_DENIED };
      }
      if (code === null) {
        return { status: "error", error: AUTH_COPY.GOOGLE_FAILED };
      }
      return exchangeAuthCode(code, flowId);
    },
    [],
  );

  const refreshProfile = useCallback(async () => {
    await readProfile(user);
  }, [readProfile, user]);

  const saveProfile = useCallback(
    async (fields: ProfileEditFields): Promise<{ error: string | null }> => {
      if (supabase === null || user === null) {
        return { error: AUTH_COPY.UNCONFIGURED };
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: fields.firstName,
          last_name: fields.lastName,
          timezone: fields.timezone,
        })
        .eq("id", user.id);
      if (error) {
        return { error: "Couldn't save your profile. Try again." };
      }
      await readProfile(user);
      return { error: null };
    },
    [readProfile, user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      profile,
      profileError,
      signIn,
      signInWithGoogle,
      completeAuthCallback,
      signOut,
      refreshProfile,
      saveProfile,
    }),
    [
      status,
      user,
      profile,
      profileError,
      signIn,
      signInWithGoogle,
      completeAuthCallback,
      signOut,
      refreshProfile,
      saveProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
