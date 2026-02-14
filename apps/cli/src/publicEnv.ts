import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "@perceo/supabase";
import { getGlobalConfigDir } from "./auth.js";

const PUBLIC_ENV_FILE = "public-env.json";

export type PublicEnvCache = {
	_meta: { fetchedAt: string; cliVersion: string };
	[key: string]: string | { fetchedAt: string; cliVersion: string };
};

/**
 * Path to the cached public env file (sibling to auth.json in global config dir).
 */
export function getPublicEnvPath(): string {
	return path.join(getGlobalConfigDir(), PUBLIC_ENV_FILE);
}

/**
 * Resolve CLI version from package.json next to the built entry (dist/index.js -> ../package.json).
 * When installed as @perceo/perceo, package root is one level up from dist.
 */
export function getCliVersion(): string {
	try {
		const dir = path.dirname(fileURLToPath(import.meta.url));
		// Built file is dist/publicEnv.js; package.json is at package root (dist/..)
		const pkgPath = path.join(dir, "..", "package.json");
		const raw = readFileSync(pkgPath, "utf8");
		const pkg = JSON.parse(raw) as { version?: string };
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Load cache from disk. Returns null if missing or invalid.
 */
async function readCache(cachePath: string): Promise<PublicEnvCache | null> {
	if (!(await fileExists(cachePath))) return null;
	try {
		const raw = await fs.readFile(cachePath, "utf8");
		const data = JSON.parse(raw) as PublicEnvCache;
		if (!data || typeof data._meta !== "object" || typeof data._meta?.cliVersion !== "string") return null;
		return data;
	} catch {
		return null;
	}
}

/**
 * Apply key/value pairs from cache to process.env. Does not overwrite existing env vars.
 */
function applyToProcessEnv(env: Record<string, string>): void {
	for (const [key, value] of Object.entries(env)) {
		if (key === "_meta" || typeof value !== "string") continue;
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

/**
 * Fetch public env from the get-public-env Edge Function. Uses supabaseUrl (no auth).
 */
async function fetchPublicEnv(supabaseUrl: string): Promise<Record<string, string>> {
	const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/get-public-env`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`get-public-env failed: ${res.status} ${res.statusText}`);
	}
	const data = (await res.json()) as Record<string, string>;
	if (data == null || typeof data !== "object") {
		throw new Error("get-public-env returned invalid JSON");
	}
	return data;
}

/**
 * Ensure public env is loaded: use cache if present and CLI version matches; otherwise fetch and cache.
 * Only runs when using Perceo Cloud (process.env.PERCEO_SUPABASE_URL not set). Self-hosted users rely on their env.
 * After this, process.env will have cached/fetched values applied (existing env vars are not overwritten).
 */
export async function ensurePublicEnvLoaded(): Promise<void> {
	if (process.env.PERCEO_SUPABASE_URL) {
		return;
	}
	const supabaseUrl = DEFAULT_SUPABASE_URL;
	const cachePath = getPublicEnvPath();
	const currentVersion = getCliVersion();
	const cached = await readCache(cachePath);
	if (cached && cached._meta.cliVersion === currentVersion) {
		applyToProcessEnv(cached as unknown as Record<string, string>);
		return;
	}
	try {
		const env = await fetchPublicEnv(supabaseUrl);
		const toWrite: PublicEnvCache = {
			_meta: { fetchedAt: new Date().toISOString(), cliVersion: currentVersion },
			...env,
		};
		await fs.mkdir(path.dirname(cachePath), { recursive: true });
		await fs.writeFile(cachePath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
		applyToProcessEnv(env);
	} catch {
		if (cached) {
			applyToProcessEnv(cached as unknown as Record<string, string>);
		} else {
			// New PC: no cache and fetch failed. Apply embedded Perceo Cloud defaults so CLI works.
			applyToProcessEnv({
				PERCEO_SUPABASE_URL: DEFAULT_SUPABASE_URL,
				PERCEO_SUPABASE_ANON_KEY: DEFAULT_SUPABASE_ANON_KEY,
			});
		}
	}
}
