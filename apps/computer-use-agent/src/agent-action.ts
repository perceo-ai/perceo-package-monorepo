/**
 * Normalized actions the vision LLM returns and the VM adapter executes.
 * Coordinates for click/scroll are 0.0–1.0 (see PRD).
 */
export type AgentClickAction = {
	type: "click";
	x: number;
	y: number;
	summary: string;
};

export type AgentTypeAction = {
	type: "type";
	text: string;
	summary: string;
};

export type AgentScrollAction = {
	type: "scroll";
	x: number;
	y: number;
	direction: "up" | "down";
	clicks: number;
	summary: string;
};

export type AgentInjectAudioAction = {
	type: "inject_audio";
	filepath: string;
	summary: string;
};

export type AgentShortcutAction = {
	type: "shortcut";
	keys: string[];
	summary: string;
};

/** Assert a workspace file exists (workspace-restricted path). */
export type AgentAssertFileExistsAction = {
	type: "assert_file_exists";
	filepath: string;
	summary: string;
};

/** Assert a workspace text file contains a substring. */
export type AgentAssertFileContainsAction = {
	type: "assert_file_contains";
	filepath: string;
	expected: string;
	summary: string;
};

/** Assert a workspace file is at least `minBytes` bytes. */
export type AgentAssertFileSizeAction = {
	type: "assert_file_size";
	filepath: string;
	minBytes: number;
	summary: string;
};

/** Capture the audio and assert the transcript similarity. */
export type AgentAssertAudioTranscriptAction = {
	type: "assert_audio_transcript";
	durationMs: number;
	expectedTranscript: string;
	similarityThreshold: number;
	summary: string;
};

export type AgentDoneAction = {
	type: "done";
	success: boolean;
	reason: string;
	summary?: string;
};

export type AgentAction =
	| AgentClickAction
	| AgentTypeAction
	| AgentScrollAction
	| AgentInjectAudioAction
	| AgentShortcutAction
	| AgentAssertFileExistsAction
	| AgentAssertFileContainsAction
	| AgentAssertFileSizeAction
	| AgentAssertAudioTranscriptAction
	| AgentDoneAction;

export function isTerminalAction(action: AgentAction): action is AgentDoneAction {
	return action.type === "done";
}
