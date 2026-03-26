import Anthropic from "@anthropic-ai/sdk";
import type { AgentAction, ComputerUseLlmCallInput, ComputerUseLlmClient } from "@perceo/computer-use-agent";

function parseAgentActionFromModelText(text: string): AgentAction {
	const stripped = text
		.replace(/```json\s*/gi, "")
		.replace(/```\s*$/g, "")
		.trim();
	return JSON.parse(stripped) as AgentAction;
}

export function createAnthropicComputerUseLlm(apiKey: string, model?: string): ComputerUseLlmClient {
	const anthropic = new Anthropic({ apiKey });
	const resolvedModel = model ?? process.env.PERCEO_COMPUTER_USE_MODEL ?? "claude-sonnet-4-20250514";

	const client: ComputerUseLlmClient = {
		async call(input: ComputerUseLlmCallInput): Promise<AgentAction> {
			const message = await anthropic.messages.create({
				model: resolvedModel,
				max_tokens: 2048,
				system: input.systemPrompt,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "image",
								source: {
									type: "base64",
									media_type: "image/jpeg",
									data: input.screenshot.toString("base64"),
								},
							},
							{
								type: "text",
								text: `Step index: ${input.stepIndex}. Output exactly one JSON object matching the action schema from the system prompt. No markdown.`,
							},
						],
					},
				],
			});

			const textBlock = message.content.find((b) => b.type === "text");
			if (!textBlock || textBlock.type !== "text") {
				throw new Error("Anthropic response had no text block");
			}
			return parseAgentActionFromModelText(textBlock.text);
		},
	};

	return client;
}
