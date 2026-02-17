/**
 * Structured JSON logger for the Temporal worker.
 * Outputs one JSON object per line so Google Cloud Run / GCP Logging can parse
 * severity, search by message/fields, and correlate with workflow/activity context.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	/** Optional: workflowId for request correlation */
	workflowId?: string;
	/** Optional: activity name for activity logs */
	activity?: string;
	/** Optional: projectId for bootstrap workflows */
	projectId?: string;
	[key: string]: unknown;
}

function formatEntry(level: LogLevel, message: string, fields: Record<string, unknown> = {}): string {
	const entry: LogEntry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...fields,
	};
	return JSON.stringify(entry);
}

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
	const line = formatEntry(level, message, fields);
	if (level === "error") {
		process.stderr.write(line + "\n");
	} else {
		process.stdout.write(line + "\n");
	}
}

export const logger = {
	debug(message: string, fields?: Record<string, unknown>) {
		write("debug", message, fields);
	},
	info(message: string, fields?: Record<string, unknown>) {
		write("info", message, fields);
	},
	warn(message: string, fields?: Record<string, unknown>) {
		write("warn", message, fields);
	},
	error(message: string, fields?: Record<string, unknown>) {
		write("error", message, fields);
	},
	/** Log with workflow context for correlation in Cloud Logging */
	withWorkflow(workflowId: string, projectId?: string) {
		return {
			debug: (msg: string, f?: Record<string, unknown>) => logger.debug(msg, { ...f, workflowId, projectId }),
			info: (msg: string, f?: Record<string, unknown>) => logger.info(msg, { ...f, workflowId, projectId }),
			warn: (msg: string, f?: Record<string, unknown>) => logger.warn(msg, { ...f, workflowId, projectId }),
			error: (msg: string, f?: Record<string, unknown>) => logger.error(msg, { ...f, workflowId, projectId }),
		};
	},
	/** Log from an activity for clear attribution */
	withActivity(activity: string, workflowId?: string) {
		return {
			debug: (msg: string, f?: Record<string, unknown>) => logger.debug(msg, { ...f, activity, workflowId }),
			info: (msg: string, f?: Record<string, unknown>) => logger.info(msg, { ...f, activity, workflowId }),
			warn: (msg: string, f?: Record<string, unknown>) => logger.warn(msg, { ...f, activity, workflowId }),
			error: (msg: string, f?: Record<string, unknown>) => logger.error(msg, { ...f, activity, workflowId }),
		};
	},
};
