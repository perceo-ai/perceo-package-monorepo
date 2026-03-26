import type { AgentAction } from "./agent-action.js";

/**
 * Thin OS/transport surface. Agent code depends only on this interface.
 */
export interface VMAdapter {
	getScreenshot(): Promise<Buffer>;
	click(nx: number, ny: number): Promise<void>;
	type(text: string): Promise<void>;
	scroll(nx: number, ny: number, direction: "up" | "down", clicks: number): Promise<void>;
	injectAudio(filepath: string): Promise<void>;
	captureAudio(durationMs: number): Promise<Buffer>;
	getResolution(): Promise<{ width: number; height: number }>;
	/** Hotkey chord (e.g. ctrl+s); transport maps to OS-specific injection. */
	shortcut(keys: string[]): Promise<void>;

	/** Read UTF-8 text from a workspace-restricted file path. */
	readFile(filepath: string): Promise<string>;
	/** List immediate children in a directory (workspace-restricted). */
	listFiles(dirpath: string): Promise<string[]>;
	/** Return file size in bytes (workspace-restricted). */
	getFileSize(filepath: string): Promise<number>;
	/** Transcribe PCM audio to text (implemented by local adapters). */
	transcribeAudio(pcm: Buffer): Promise<string>;
}

export async function executeAgentAction(adapter: VMAdapter, action: AgentAction): Promise<void> {
	switch (action.type) {
		case "click":
			await adapter.click(action.x, action.y);
			return;
		case "type":
			await adapter.type(action.text);
			return;
		case "scroll":
			await adapter.scroll(action.x, action.y, action.direction, action.clicks);
			return;
		case "inject_audio":
			await adapter.injectAudio(action.filepath);
			return;
		case "shortcut":
			await adapter.shortcut(action.keys);
			return;
		case "assert_file_exists": {
			try {
				// Avoid loading the whole file; existence check via size.
				await adapter.getFileSize(action.filepath);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				throw new Error(`assert_file_exists failed for ${action.filepath}: ${msg}`);
			}
			return;
		}
		case "assert_file_contains": {
			const contents = await adapter.readFile(action.filepath);
			if (!contents.includes(action.expected)) {
				throw new Error(`assert_file_contains failed: ${action.filepath} missing expected text`);
			}
			return;
		}
		case "assert_file_size": {
			const size = await adapter.getFileSize(action.filepath);
			if (size < action.minBytes) {
				throw new Error(`assert_file_size failed: ${action.filepath} is ${size} bytes (< ${action.minBytes})`);
			}
			return;
		}
		case "assert_audio_transcript": {
			const pcm = await adapter.captureAudio(action.durationMs);
			const transcript = await adapter.transcribeAudio(pcm);
			const similarity = transcriptSimilarity(transcript, action.expectedTranscript);
			if (similarity < action.similarityThreshold) {
				throw new Error(
					`assert_audio_transcript failed: similarity ${similarity.toFixed(3)} < threshold ${action.similarityThreshold}`,
				);
			}
			return;
		}
		case "done":
			return;
		default: {
			const _exhaustive: never = action;
			return _exhaustive;
		}
	}
}

function normalizeText(s: string): string {
	return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
	const an = a.length;
	const bn = b.length;
	if (an === 0) return bn;
	if (bn === 0) return an;

	// 1D DP to keep TypeScript indexing safe under `noUncheckedIndexedAccess`.
	let prev: number[] = Array.from({ length: bn + 1 }, (_, j) => j);
	let curr: number[] = new Array(bn + 1).fill(0);

	for (let i = 1; i <= an; i++) {
		curr[0] = i;
		for (let j = 1; j <= bn; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const del = (prev[j] ?? 0) + 1;
			const ins = (curr[j - 1] ?? 0) + 1;
			const sub = (prev[j - 1] ?? 0) + cost;
			curr[j] = Math.min(del, ins, sub);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}

	return prev[bn] ?? 0;
}

/** Similarity in [0,1] based on normalized Levenshtein distance. */
function transcriptSimilarity(actual: string, expected: string): number {
	const a = normalizeText(actual);
	const e = normalizeText(expected);
	if (!a && !e) return 1;
	const dist = levenshtein(a, e);
	const denom = Math.max(a.length, e.length) || 1;
	return 1 - dist / denom;
}
