import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { ensureProjectAccess } from "../projectAccess.js";
import type { Flow } from "@perceo/supabase";
import { computeChangeAnalysis, type ChangeAnalysisFile } from "@perceo/observer-engine";

// ============================================================================
// Types
// ============================================================================

interface AnalyzeOptions {
	base: string;
	head?: string;
	projectDir?: string;
	json?: boolean;
}

interface AnalysisResult {
	projectId: string;
	projectName: string;
	baseSha: string;
	headSha: string;
	flows: AffectedFlowResult[];
	changes: ChangeAnalysisFile[];
	riskLevel: string;
	riskScore: number;
	createdAt: number;
}

interface AffectedFlowResult {
	id: string;
	name: string;
	priority: string;
	riskScore: number;
	confidence: number;
	matchedFiles: string[];
}

// ============================================================================
// Command
// ============================================================================

export const analyzeCommand = new Command("analyze")
	.description("Analyze git diff to find affected flows")
	.requiredOption("--base <sha>", "Base Git ref (e.g., main, origin/main, commit SHA)")
	.option("--head <sha>", "Head Git ref (default: HEAD)", "HEAD")
	.option("--project-dir <dir>", "Project directory", process.cwd())
	.option("--json", "Output JSON for CI integration", false)
	.action(async (options: AnalyzeOptions) => {
		const projectRoot = path.resolve(options.projectDir ?? process.cwd());
		const spinner = ora("Analyzing changes...").start();

		try {
			const { client, projectId, projectName } = await ensureProjectAccess({ projectDir: projectRoot });

			// Get git diff
			spinner.text = "Computing git diff...";
			const baseSha = options.base;
			const headSha = options.head ?? "HEAD";
			const analysis = await computeChangeAnalysis(projectRoot, baseSha, headSha);

			if (analysis.files.length === 0) {
				spinner.succeed("No changes found");
				if (options.json) {
					console.log(JSON.stringify({ flows: [], changes: [], riskLevel: "low", riskScore: 0 }, null, 2));
				} else {
					console.log(chalk.green("\n✓ No files changed between the commits"));
				}
				return;
			}

			// Get existing flows
			spinner.text = "Matching against flows...";
			const flows = await client.getFlows(projectId);

			if (flows.length === 0) {
				spinner.warn("No flows found");
				console.log(chalk.yellow("\nNo flows have been discovered yet. Run `perceo init` to discover flows."));
				return;
			}

			// Match affected flows
			const affectedFlows = matchAffectedFlows(flows, analysis.files);

			// Store code change record
			spinner.text = "Storing analysis...";
			const codeChange = await client.createCodeChange({
				project_id: projectId,
				base_sha: baseSha,
				head_sha: headSha,
				files: analysis.files.map((f) => ({
					path: f.path,
					status: f.status,
				})),
			});

			// Calculate risk and update
			const riskScore = calculateOverallRisk(affectedFlows);
			const riskLevel = getRiskLevel(riskScore);

			await client.updateCodeChangeAnalysis(codeChange.id, {
				risk_level: riskLevel,
				risk_score: riskScore,
				affected_flow_ids: affectedFlows.map((f) => f.flow.id),
			});

			// Mark flows as affected
			if (affectedFlows.length > 0) {
				await client.markFlowsAffected(
					affectedFlows.map((f) => f.flow.id),
					codeChange.id,
					riskScore * 0.2,
				);
			}

			spinner.succeed("Analysis complete");

			// Build result
			const result: AnalysisResult = {
				projectId,
				projectName,
				baseSha,
				headSha,
				flows: affectedFlows.map((f) => ({
					id: f.flow.id,
					name: f.flow.name,
					priority: f.flow.priority,
					riskScore: f.riskScore,
					confidence: f.confidence,
					matchedFiles: f.matchedFiles,
				})),
				changes: analysis.files,
				riskLevel,
				riskScore,
				createdAt: Date.now(),
			};

			// Output
			if (options.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				printResults(result);
			}
		} catch (error) {
			spinner.fail("Analysis failed");
			console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
			process.exit(1);
		}
	});

// ============================================================================
// Flow Matching
// ============================================================================

interface MatchedFlow {
	flow: Flow;
	riskScore: number;
	confidence: number;
	matchedFiles: string[];
}

function matchAffectedFlows(flows: Flow[], changedFiles: ChangeAnalysisFile[]): MatchedFlow[] {
	const affected: MatchedFlow[] = [];

	for (const flow of flows) {
		const matchedFiles: string[] = [];
		let maxConfidence = 0;

		for (const file of changedFiles) {
			const confidence = calculateMatchConfidence(flow, file.path);
			if (confidence > 0.3) {
				matchedFiles.push(file.path);
				maxConfidence = Math.max(maxConfidence, confidence);
			}
		}

		if (matchedFiles.length > 0) {
			affected.push({
				flow,
				riskScore: calculateFlowRisk(flow, matchedFiles, changedFiles),
				confidence: maxConfidence,
				matchedFiles,
			});
		}
	}

	// Sort by risk score descending
	return affected.sort((a, b) => b.riskScore - a.riskScore);
}

function calculateMatchConfidence(flow: Flow, filePath: string): number {
	const normalizedPath = filePath.toLowerCase();
	const flowName = flow.name.toLowerCase();

	// Direct entry point match
	if (flow.entry_point) {
		const entryNormalized = flow.entry_point.toLowerCase().replace(/\//g, "");
		if (normalizedPath.includes(entryNormalized)) {
			return 0.9;
		}
	}

	// Flow name keywords in path
	const keywords = flowName.split(/[\s-_]+/).filter((k) => k.length > 2);
	for (const keyword of keywords) {
		if (normalizedPath.includes(keyword)) {
			return 0.7;
		}
	}

	// Graph data components/pages match
	const graphData = flow.graph_data as { components?: string[]; pages?: string[] } | undefined;
	if (graphData) {
		const allRefs = [...(graphData.components ?? []), ...(graphData.pages ?? [])];
		for (const ref of allRefs) {
			if (normalizedPath.includes(ref.toLowerCase())) {
				return 0.8;
			}
		}
	}

	return 0;
}

function calculateFlowRisk(flow: Flow, matchedFiles: string[], allChanges: ChangeAnalysisFile[]): number {
	const priorityWeight: Record<string, number> = {
		critical: 1.0,
		high: 0.75,
		medium: 0.5,
		low: 0.25,
	};

	const baseRisk = priorityWeight[flow.priority] ?? 0.5;
	const fileRatio = matchedFiles.length / Math.max(allChanges.length, 1);

	return Math.min(1.0, baseRisk + fileRatio * 0.3);
}

function calculateOverallRisk(affected: MatchedFlow[]): number {
	if (affected.length === 0) return 0;

	// Weight by priority
	let totalWeight = 0;
	let weightedRisk = 0;

	for (const a of affected) {
		const weight = a.flow.priority === "critical" ? 2.0 : a.flow.priority === "high" ? 1.5 : 1.0;
		totalWeight += weight;
		weightedRisk += a.riskScore * weight;
	}

	return Math.min(1.0, weightedRisk / totalWeight);
}

function getRiskLevel(score: number): "critical" | "high" | "medium" | "low" {
	if (score >= 0.8) return "critical";
	if (score >= 0.6) return "high";
	if (score >= 0.3) return "medium";
	return "low";
}

// ============================================================================
// Output
// ============================================================================

function printResults(result: AnalysisResult): void {
	console.log();
	console.log(chalk.bold("Project: ") + result.projectName);
	console.log(chalk.bold("Diff: ") + `${result.baseSha}...${result.headSha}`);
	console.log();

	// Risk summary
	const riskColor = result.riskLevel === "critical" ? chalk.red : result.riskLevel === "high" ? chalk.yellow : result.riskLevel === "medium" ? chalk.blue : chalk.green;

	console.log(chalk.bold("Overall Risk: ") + riskColor(`${result.riskLevel.toUpperCase()} (${(result.riskScore * 100).toFixed(0)}%)`));
	console.log();

	// Affected flows
	if (result.flows.length === 0) {
		console.log(chalk.green("✓ No flows affected by these changes"));
	} else {
		console.log(chalk.bold(`${result.flows.length} flow(s) affected:`));
		console.log();

		for (const flow of result.flows) {
			const riskColor = flow.riskScore > 0.7 ? chalk.red : flow.riskScore > 0.4 ? chalk.yellow : chalk.green;

			const priorityColor = flow.priority === "critical" ? chalk.red : flow.priority === "high" ? chalk.yellow : chalk.gray;

			const risk = (flow.riskScore * 100).toFixed(0);
			const confidence = (flow.confidence * 100).toFixed(0);

			console.log(`  ${chalk.cyan(flow.name)} ${priorityColor(`[${flow.priority}]`)}`);
			console.log(`     Risk: ${riskColor(`${risk}%`)}  Confidence: ${confidence}%`);
			console.log(`     Matched: ${chalk.gray(flow.matchedFiles.slice(0, 3).join(", "))}${flow.matchedFiles.length > 3 ? ` (+${flow.matchedFiles.length - 3})` : ""}`);
		}
	}

	// Changed files
	console.log();
	console.log(chalk.bold(`${result.changes.length} file(s) changed:`));

	const maxShow = 10;
	for (const file of result.changes.slice(0, maxShow)) {
		const icon = file.status === "added" ? chalk.green("+") : file.status === "deleted" ? chalk.red("-") : chalk.yellow("~");
		console.log(`  ${icon} ${file.path}`);
	}

	if (result.changes.length > maxShow) {
		console.log(chalk.gray(`  ... and ${result.changes.length - maxShow} more`));
	}

	// Recommendation
	console.log();
	if (result.riskLevel === "critical" || result.riskLevel === "high") {
		console.log(chalk.red(`⚠️  High-risk changes detected. Recommend running tests for affected flows.`));
	} else if (result.flows.length > 0) {
		console.log(chalk.yellow(`ℹ️  ${result.flows.length} flow(s) may be affected. Consider testing them.`));
	} else {
		console.log(chalk.green(`✓ Low risk - no critical flows affected.`));
	}
}
