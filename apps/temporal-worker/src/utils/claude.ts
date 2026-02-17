import Anthropic from "@anthropic-ai/sdk";
import { OpenRouter } from "@openrouter/sdk";
import { readFileSync } from "fs";
import { join } from "path";

export interface Persona {
	name: string;
	description: string;
	behaviors: string[];
}

export interface Flow {
	name: string;
	personaName: string;
	description: string;
	triggerConditions: string[];
}

/** Flow identified from route graph (Phase 2): one action, 1-2 pages */
export interface IdentifiedFlow {
	name: string;
	description: string;
	pages: string[];
	connectedFlowIds?: string[];
}

/** Persona with flow assignments (Phase 3) */
export interface PersonaWithFlowNames {
	name: string;
	description: string;
	behaviors: string[];
	flowNames: string[];
}

export interface Step {
	stepNumber: number;
	action: string;
	expectedState: string;
	selectors?: string[];
}

export interface PersonasExtractionResult {
	personas: Persona[];
}

export interface FlowsExtractionResult {
	flows: Flow[];
}

export interface StepsExtractionResult {
	steps: Step[];
}

interface PromptConfig {
	template: string;
	schema: {
		name: string;
		strict: boolean;
		schema: Record<string, unknown>;
	};
}

/**
 * LLM API client wrapper for Perceo extraction tasks
 * Supports both OpenRouter and direct Anthropic API
 */
export class ClaudeClient {
	private anthropicClient?: Anthropic;
	private openRouterClient?: OpenRouter;
	private useOpenRouter: boolean;
	private prompts: Map<string, PromptConfig> = new Map();

	constructor(apiKey: string, useOpenRouter = true) {
		this.useOpenRouter = useOpenRouter;

		if (useOpenRouter) {
			// Use OpenRouter SDK for cost efficiency and model flexibility
			this.openRouterClient = new OpenRouter({
				apiKey,
			});
		} else {
			// Use Anthropic SDK directly
			this.anthropicClient = new Anthropic({ apiKey });
		}

		// Load prompts
		this.loadPrompts();
	}

	/**
	 * Load all prompt templates and schemas from disk
	 */
	private loadPrompts(): void {
		const promptsDir = join(__dirname, "../prompts");
		console.log(`Loading prompts from: ${promptsDir}`);

		const promptTypes = ["personas", "flows", "steps", "flows-from-graph", "personas-assign"];

		for (const type of promptTypes) {
			try {
				const templatePath = join(promptsDir, type, "prompt.txt");
				const schemaPath = join(promptsDir, type, "schema.json");

				console.log(`Loading ${type} prompt from: ${templatePath}`);
				const template = readFileSync(templatePath, "utf-8");
				const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

				this.prompts.set(type, { template, schema });
				console.log(`Successfully loaded ${type} prompt config`);
			} catch (error) {
				console.error(`Failed to load prompt config for ${type}:`, error);
				console.error(`Prompts directory contents:`, promptsDir);
			}
		}

		console.log(`Loaded ${this.prompts.size} prompt configs: ${Array.from(this.prompts.keys()).join(", ")}`);
	}

	/**
	 * Get the model ID to use based on provider
	 */
	private getModelId(): string {
		if (this.useOpenRouter) {
			// Use Claude 3.5 Sonnet via OpenRouter
			return "anthropic/claude-sonnet-4.5";
		}
		return "claude-sonnet-4-5-20250929";
	}

	/**
	 * Render a prompt template with variables
	 */
	private renderTemplate(template: string, variables: Record<string, string>): string {
		let result = template;
		for (const [key, value] of Object.entries(variables)) {
			result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
		}
		return result;
	}

	/**
	 * Build structured output instructions based on schema
	 */
	private buildSchemaInstructions(config: PromptConfig): string {
		return `\n\nYou must respond with ONLY a valid JSON object matching this exact schema:\n${JSON.stringify(config.schema.schema, null, 2)}\n\nDo not include any markdown formatting, explanations, or text outside the JSON object. Return only the raw JSON.`;
	}

	/**
	 * Parse JSON response with error handling
	 */
	private parseJsonResponse<T>(text: string): T | null {
		try {
			// Remove markdown code blocks if present
			const cleaned = text
				.replace(/```json\n?/g, "")
				.replace(/```\n?/g, "")
				.trim();
			return JSON.parse(cleaned) as T;
		} catch (error) {
			console.error("Failed to parse JSON response:", text.slice(0, 500));
			return null;
		}
	}

	/**
	 * Extract user personas from git diff
	 */
	async extractPersonasFromDiff(diff: string, framework: string): Promise<Persona[]> {
		const config = this.prompts.get("personas");
		if (!config) {
			throw new Error("Personas prompt config not loaded");
		}

		const prompt =
			this.renderTemplate(config.template, {
				framework,
				diff: diff.slice(0, 50000),
			}) + this.buildSchemaInstructions(config);

		try {
			if (this.useOpenRouter && this.openRouterClient) {
				// Use OpenRouter SDK
				const completion = await this.openRouterClient.chat.send({
					model: this.getModelId(),
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				const content = completion.choices[0]?.message?.content;
				if (!content) {
					console.error("Empty response from OpenRouter API");
					return [];
				}

				// OpenRouter may return content as string or as array of content items
				let contentText: string | undefined;
				if (typeof content === "string") {
					contentText = content;
				} else if (Array.isArray(content)) {
					// Find first "text" type entry and concatenate them (or just join the texts)
					contentText = content
						.filter((c) => typeof c === "object" && c.type === "text" && "text" in c)
						.map((c) => (c as { text: string }).text)
						.join("\n");
				}

				if (!contentText) {
					console.error("Unable to extract text from OpenRouter API response");
					return [];
				}

				const result = this.parseJsonResponse<PersonasExtractionResult>(contentText);
				return result?.personas || [];
			} else if (this.anthropicClient) {
				// Use Anthropic SDK directly
				const response = await this.anthropicClient.messages.create({
					model: this.getModelId(),
					max_tokens: 4096,
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				if (!response.content || response.content.length === 0) {
					console.error("Empty response from Anthropic API");
					return [];
				}

				const content = response.content[0];
				if (!content || content.type !== "text") {
					console.error("Unexpected response type from Anthropic API");
					return [];
				}

				const result = this.parseJsonResponse<PersonasExtractionResult>(content.text);
				return result?.personas || [];
			} else {
				throw new Error("No LLM client initialized");
			}
		} catch (error) {
			console.error("LLM API error (personas):", error);
			// Fallback to empty array on error
			return [];
		}
	}

	/**
	 * Extract user flows from git diff for a specific persona
	 * One LLM call per persona for more focused extraction
	 */
	async extractFlowsForPersona(diff: string, framework: string, persona: Persona): Promise<Flow[]> {
		const config = this.prompts.get("flows");
		if (!config) {
			throw new Error("Flows prompt config not loaded");
		}

		const behaviorsList = persona.behaviors.map((b) => `  - ${b}`).join("\n");

		const prompt =
			this.renderTemplate(config.template, {
				framework,
				personaName: persona.name,
				personaDescription: persona.description,
				personaBehaviors: behaviorsList,
				diff: diff.slice(0, 50000),
			}) + this.buildSchemaInstructions(config);

		try {
			if (this.useOpenRouter && this.openRouterClient) {
				// Use OpenRouter SDK
				const completion = await this.openRouterClient.chat.send({
					model: this.getModelId(),
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				const content = completion.choices[0]?.message?.content;
				if (!content) {
					console.error("Empty response from OpenRouter API");
					return [];
				}

				// OpenRouter may return content as string or as array of content items
				let contentText: string | undefined;
				if (typeof content === "string") {
					contentText = content;
				} else if (Array.isArray(content)) {
					// Find first "text" type entry and concatenate them (or just join the texts)
					contentText = content
						.filter((c) => typeof c === "object" && c.type === "text" && "text" in c)
						.map((c) => (c as { text: string }).text)
						.join("\n");
				}

				if (!contentText) {
					console.error("Unable to extract text from OpenRouter API response");
					return [];
				}

				const result = this.parseJsonResponse<FlowsExtractionResult>(contentText);
				return result?.flows || [];
			} else if (this.anthropicClient) {
				// Use Anthropic SDK directly
				const response = await this.anthropicClient.messages.create({
					model: this.getModelId(),
					max_tokens: 8192,
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				if (!response.content || response.content.length === 0) {
					console.error("Empty response from Anthropic API");
					return [];
				}

				const content = response.content[0];
				if (!content || content.type !== "text") {
					console.error("Unexpected response type from Anthropic API");
					return [];
				}

				const result = this.parseJsonResponse<FlowsExtractionResult>(content.text);
				return result?.flows || [];
			} else {
				throw new Error("No LLM client initialized");
			}
		} catch (error) {
			console.error("LLM API error (flows):", error);
			return [];
		}
	}

	/**
	 * Extract detailed steps for a specific flow
	 */
	async extractStepsForFlow(codeContext: string, flowName: string, flowDescription: string, framework: string): Promise<Step[]> {
		const config = this.prompts.get("steps");
		if (!config) {
			throw new Error("Steps prompt config not loaded");
		}

		const prompt =
			this.renderTemplate(config.template, {
				framework,
				flowName,
				flowDescription,
				codeContext: codeContext.slice(0, 40000),
			}) + this.buildSchemaInstructions(config);

		try {
			if (this.useOpenRouter && this.openRouterClient) {
				// Use OpenRouter SDK
				const completion = await this.openRouterClient.chat.send({
					model: this.getModelId(),
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				const content = completion.choices[0]?.message?.content;
				if (!content) {
					console.error("Empty response from OpenRouter API");
					return [];
				}

				// OpenRouter may return content as string or as array of content items
				let contentText: string | undefined;
				if (typeof content === "string") {
					contentText = content;
				} else if (Array.isArray(content)) {
					// Find first "text" type entry and concatenate them (or just join the texts)
					contentText = content
						.filter((c) => typeof c === "object" && c.type === "text" && "text" in c)
						.map((c) => (c as { text: string }).text)
						.join("\n");
				}

				if (!contentText) {
					console.error("Unable to extract text from OpenRouter API response");
					return [];
				}

				const result = this.parseJsonResponse<StepsExtractionResult>(contentText);
				return result?.steps || [];
			} else if (this.anthropicClient) {
				// Use Anthropic SDK directly
				const response = await this.anthropicClient.messages.create({
					model: this.getModelId(),
					max_tokens: 8192,
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				if (!response.content || response.content.length === 0) {
					console.error("Empty response from Anthropic API");
					return [];
				}

				const content = response.content[0];
				if (!content || content.type !== "text") {
					console.error("Unexpected response type from Anthropic API");
					return [];
				}

				const result = this.parseJsonResponse<StepsExtractionResult>(content.text);
				return result?.steps || [];
			} else {
				throw new Error("No LLM client initialized");
			}
		} catch (error) {
			console.error("LLM API error (steps):", error);
			return [];
		}
	}

	/**
	 * Phase 2: Identify flows from route graph (1-2 LLM calls).
	 * Each flow is one action, 1-2 pages, with optional connectivity.
	 */
	async identifyFlowsFromRouteGraph(routeList: string, navigationGraph: string, framework: string, authSnippets?: string): Promise<IdentifiedFlow[]> {
		const config = this.prompts.get("flows-from-graph");
		if (!config) {
			throw new Error("flows-from-graph prompt config not loaded");
		}

		const prompt =
			this.renderTemplate(config.template, {
				framework,
				routeList,
				navigationGraph,
				authSnippets: authSnippets ?? "None",
			}) + this.buildSchemaInstructions(config);

		const raw = await this.sendPromptAndParse<{ flows: IdentifiedFlow[] }>(prompt);
		return raw?.flows ?? [];
	}

	/**
	 * Phase 3: Assign personas to flows (1 LLM call).
	 */
	async assignPersonasToFlows(flowList: string, framework: string, authSnippets?: string): Promise<PersonaWithFlowNames[]> {
		const config = this.prompts.get("personas-assign");
		if (!config) {
			throw new Error("personas-assign prompt config not loaded");
		}

		const prompt =
			this.renderTemplate(config.template, {
				framework,
				flowList,
				authSnippets: authSnippets ?? "None",
			}) + this.buildSchemaInstructions(config);

		const raw = await this.sendPromptAndParse<{ personas: PersonaWithFlowNames[] }>(prompt);
		return raw?.personas ?? [];
	}

	private async sendPromptAndParse<T>(prompt: string): Promise<T | null> {
		try {
			if (this.useOpenRouter && this.openRouterClient) {
				const completion = await this.openRouterClient.chat.send({
					model: this.getModelId(),
					messages: [{ role: "user", content: prompt }],
				});
				const content = completion.choices[0]?.message?.content;
				const contentText = this.extractContentText(content);
				return contentText ? this.parseJsonResponse<T>(contentText) : null;
			}
			if (this.anthropicClient) {
				const response = await this.anthropicClient.messages.create({
					model: this.getModelId(),
					max_tokens: 8192,
					messages: [{ role: "user", content: prompt }],
				});
				const content = response.content?.[0];
				const text = content && content.type === "text" ? content.text : "";
				return text ? this.parseJsonResponse<T>(text) : null;
			}
			return null;
		} catch (error) {
			console.error("LLM API error:", error);
			return null;
		}
	}

	private extractContentText(content: unknown): string | undefined {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const texts = content.filter((c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "text" && "text" in c).map((c) => (c as { text: string }).text);
			return texts.length ? texts.join("\n") : undefined;
		}
		return undefined;
	}
}
