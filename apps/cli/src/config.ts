import fs from "node:fs/promises";
import path from "node:path";

export type PerceoConfig = any; // Will be refined as the engines are implemented

const CONFIG_DIR = ".perceo";
const BASE_CONFIG_FILE = "config.json";
const LOCAL_CONFIG_FILE = "config.local.json";

type LoadConfigOptions = {
	/**
	 * Explicit project root. Defaults to process.cwd().
	 */
	projectDir?: string;
};

/**
 * Load Perceo configuration with optional local-development overrides.
 *
 * Resolution rules:
 * - Base config:   <projectDir>/.perceo/config.json        (required)
 * - Local config:  <projectDir>/.perceo/config.local.json  (optional)
 *
 * Environment:
 * - PERCEO_CONFIG_PATH: absolute or project-relative path to a config file.
 *   When set, this file is used as the base and .perceo/ config discovery is skipped.
 *
 * - PERCEO_ENV=local (or NODE_ENV=development):
 *   When "local", config.local.json (if present) is deep-merged on top of the base config.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<PerceoConfig> {
	const projectDir = path.resolve(options.projectDir ?? process.cwd());

	const envPath = process.env.PERCEO_CONFIG_PATH;
	const baseConfigPath = envPath ? resolveMaybeRelativePath(envPath, projectDir) : path.join(projectDir, CONFIG_DIR, BASE_CONFIG_FILE);

	let baseConfig = await readJsonFile(baseConfigPath);

	const isLocalEnv = (process.env.PERCEO_ENV || "").toLowerCase() === "local" || process.env.NODE_ENV === "development";

	if (isLocalEnv) {
		// Local overrides are optional; if they don't exist just use baseConfig.
		const localConfigPath = path.join(projectDir, CONFIG_DIR, LOCAL_CONFIG_FILE);
		const localExists = await fileExists(localConfigPath);
		if (localExists) {
			const localConfig = await readJsonFile(localConfigPath);
			baseConfig = deepMerge(baseConfig, localConfig);
		}
	}

	// Inject Temporal config from environment variables
	if (process.env.PERCEO_TEMPORAL_ENABLED === 'true') {
		baseConfig.temporal = {
			enabled: true,
			address: process.env.PERCEO_TEMPORAL_ADDRESS || 'localhost:7233',
			namespace: process.env.PERCEO_TEMPORAL_NAMESPACE || 'perceo',
			taskQueue: process.env.PERCEO_TEMPORAL_TASK_QUEUE || 'observer-engine',
		};

		// Add TLS config if cert path is provided
		if (process.env.PERCEO_TEMPORAL_TLS_CERT_PATH) {
			baseConfig.temporal.tls = {
				certPath: process.env.PERCEO_TEMPORAL_TLS_CERT_PATH,
				keyPath: process.env.PERCEO_TEMPORAL_TLS_KEY_PATH || '',
			};
		}
	}

	return baseConfig;
}

async function readJsonFile<T = any>(filePath: string): Promise<T> {
	const raw = await fs.readFile(filePath, "utf8");
	return JSON.parse(raw) as T;
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

function resolveMaybeRelativePath(p: string, projectDir: string): string {
	if (path.isAbsolute(p)) return p;
	return path.join(projectDir, p);
}

function deepMerge(target: any, source: any): any {
	if (Array.isArray(target) && Array.isArray(source)) {
		return source; // arrays are replaced, not merged, for simplicity
	}

	if (isPlainObject(target) && isPlainObject(source)) {
		const result: any = { ...target };
		for (const key of Object.keys(source)) {
			if (key in target) {
				result[key] = deepMerge(target[key], source[key]);
			} else {
				result[key] = source[key];
			}
		}
		return result;
	}

	return source;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
