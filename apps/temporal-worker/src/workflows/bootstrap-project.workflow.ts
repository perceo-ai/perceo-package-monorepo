import { proxyActivities, setHandler, defineQuery } from "@temporalio/workflow";
import type * as activities from "../activities";

// Proxy activities with retry policies
const { detectFramework, callObserverBootstrapApi, publishEvent } = proxyActivities<typeof activities>({
	startToCloseTimeout: "5 minutes",
	retry: {
		initialInterval: "1s",
		maximumInterval: "30s",
		backoffCoefficient: 2,
		maximumAttempts: 3,
	},
});

export interface BootstrapProjectInput {
	projectDir: string;
	projectName: string;
	framework?: string;
	apiConfig?: {
		baseUrl: string;
		apiKey?: string;
	};
	eventBusConfig?: {
		redisUrl: string;
	};
}

export interface BootstrapProjectResult {
	projectId: string;
	flows: any[];
	personas: any[];
	framework: string;
}

// Progress tracking
let currentProgress = {
	stage: "initializing",
	message: "Starting bootstrap process...",
	percentage: 0,
};

// Define query to check progress
export const bootstrapProgressQuery = defineQuery<typeof currentProgress>("progress");

export async function bootstrapProjectWorkflow(input: BootstrapProjectInput): Promise<BootstrapProjectResult> {
	// Set up progress query handler
	setHandler(bootstrapProgressQuery, () => currentProgress);

	// Step 1: Detect framework if not provided
	let framework = input.framework;
	if (!framework) {
		currentProgress = {
			stage: "detecting_framework",
			message: "Detecting project framework...",
			percentage: 10,
		};

		framework = await detectFramework(input.projectDir);
	}

	// Step 2: Call bootstrap API
	currentProgress = {
		stage: "bootstrapping",
		message: "Analyzing project and generating flows...",
		percentage: 30,
	};

	if (!input.apiConfig) {
		throw new Error("API configuration is required for bootstrap");
	}

	const bootstrapResult = await callObserverBootstrapApi(input.apiConfig, {
		projectName: input.projectName,
		projectDir: input.projectDir,
		framework,
	});

	// Step 3: Publish completion event if event bus configured
	if (input.eventBusConfig) {
		currentProgress = {
			stage: "publishing_event",
			message: "Publishing completion event...",
			percentage: 70,
		};

		await publishEvent(input.eventBusConfig, {
			type: "observer.bootstrap.complete",
			payload: {
				projectId: bootstrapResult.projectId,
				projectName: input.projectName,
				flowCount: bootstrapResult.flows.length,
				personaCount: bootstrapResult.personas.length,
				framework,
			},
		});
	}

	currentProgress = {
		stage: "complete",
		message: "Bootstrap completed successfully!",
		percentage: 100,
	};

	return {
		projectId: bootstrapResult.projectId,
		flows: bootstrapResult.flows,
		personas: bootstrapResult.personas,
		framework,
	};
}
