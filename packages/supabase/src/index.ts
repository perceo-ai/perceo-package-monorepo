import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://perceo.supabase.co";

/**
 * Session data returned from magic-link auth flow.
 * Callers add scope (project/global) when persisting.
 */
export interface SupabaseAuthSession {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	supabaseUrl: string;
}

export function getSupabaseUrl(): string {
	return process.env.PERCEO_SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
	const key = process.env.PERCEO_SUPABASE_ANON_KEY;
	if (!key) {
		throw new Error("PERCEO_SUPABASE_ANON_KEY is not set. Set it to your Supabase project anon key, or use Perceo Cloud.");
	}
	return key;
}

/**
 * Create a Supabase client for auth. Uses PERCEO_SUPABASE_URL and PERCEO_SUPABASE_ANON_KEY.
 */
export function createSupabaseAuthClient(): SupabaseClient {
	return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
		auth: {
			autoRefreshToken: true,
			persistSession: false,
			detectSessionInUrl: false,
		},
	});
}

/**
 * Parse hash fragment from a redirect URL (e.g. from magic link) and return token key-value pairs.
 */
function parseHashParams(hash: string): Record<string, string> {
	const params: Record<string, string> = {};
	if (!hash || !hash.startsWith("#")) return params;
	const query = hash.slice(1);
	for (const part of query.split("&")) {
		const [key, value] = part.split("=").map((s) => decodeURIComponent(s.replace(/\+/g, " ")));
		if (key && value) params[key] = value;
	}
	return params;
}

/**
 * Exchange a redirect URL (with hash) from the magic link for a session and return session data for storage.
 */
export async function sessionFromRedirectUrl(supabase: SupabaseClient, redirectUrl: string): Promise<SupabaseAuthSession> {
	const hash = redirectUrl.includes("#") ? redirectUrl.slice(redirectUrl.indexOf("#")) : "";
	const params = parseHashParams(hash);
	const access_token = params.access_token;
	const refresh_token = params.refresh_token;
	const expires_in = params.expires_in ? parseInt(params.expires_in, 10) : 3600;

	if (!access_token || !refresh_token) {
		throw new Error("Redirect URL did not contain access_token and refresh_token");
	}

	const { data, error } = await supabase.auth.setSession({
		access_token,
		refresh_token,
	});

	if (error) throw error;
	const session = data.session;
	if (!session) throw new Error("No session returned");

	const expires_at = session.expires_at ?? Math.floor(Date.now() / 1000) + expires_in;

	return {
		access_token: session.access_token,
		refresh_token: session.refresh_token ?? refresh_token,
		expires_at,
		supabaseUrl: getSupabaseUrl(),
	};
}

/**
 * Send a magic link to the given email. Redirect will go to redirectUrl (must be allowed in Supabase dashboard).
 */
export async function sendMagicLink(supabase: SupabaseClient, email: string, redirectUrl: string): Promise<{ error: Error | null }> {
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: {
			emailRedirectTo: redirectUrl,
		},
	});
	return { error: error ?? null };
}
