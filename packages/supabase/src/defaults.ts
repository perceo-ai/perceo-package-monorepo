/**
 * Embedded Perceo Cloud defaults. Packaged with every consumer so URL and anon key
 * work without env. Override via PERCEO_SUPABASE_URL and PERCEO_SUPABASE_ANON_KEY.
 */
export const DEFAULT_SUPABASE_URL = "https://lygslnolucoidnhaitdn.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_8Wj8bSM7drJH6mXp6NM7SQ_GcyE9pZb";

export function getSupabaseUrl(): string {
	return process.env.PERCEO_SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
	const key = process.env.PERCEO_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
	if (!key) {
		throw new Error(
			"PERCEO_SUPABASE_ANON_KEY is not configured. " + "This should be embedded in the package for Perceo Cloud users. " + "For self-hosted, set PERCEO_SUPABASE_ANON_KEY environment variable.",
		);
	}
	return key;
}
