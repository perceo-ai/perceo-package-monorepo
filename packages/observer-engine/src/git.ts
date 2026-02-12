import { exec as _exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { ChangeAnalysis, ChangeAnalysisFile } from "./types.js";

const exec = promisify(_exec);

export async function computeChangeAnalysis(projectRoot: string, baseSha: string, headSha: string): Promise<ChangeAnalysis> {
	const { stdout } = await exec(`git diff --name-status ${baseSha}...${headSha}`, {
		cwd: projectRoot,
	});

	const files: ChangeAnalysisFile[] = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [status, filePath] = line.split(/\s+/, 2);
			return {
				path: normalizePath(filePath),
				status: mapStatus(status),
			};
		});

	return {
		baseSha,
		headSha,
		files,
	};
}

function mapStatus(raw: string): ChangeAnalysisFile["status"] {
	switch (raw) {
		case "A":
			return "added";
		case "D":
			return "deleted";
		case "R":
		case "R100":
		case "R099":
			return "renamed";
		case "M":
		default:
			return "modified";
	}
}

function normalizePath(p: string | undefined): string {
	if (!p) return "";
	// Ensure posix-style separators for consistency across platforms.
	return p.split("\\").join("/");
}
