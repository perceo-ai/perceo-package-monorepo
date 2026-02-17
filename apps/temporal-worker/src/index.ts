import { Worker, NativeConnection } from "@temporalio/worker";
import { Client } from "@temporalio/client";
import * as activities from "./activities";
import { loadWorkerConfig } from "./config";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { logger } from "./logger";

/** Embedded Perceo Cloud Supabase URL; override with PERCEO_SUPABASE_URL. */
const DEFAULT_SUPABASE_URL = "https://lygslnolucoidnhaitdn.supabase.co";

// CORS headers
const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

// Helper to parse JSON body
async function parseBody(req: IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

// Helper to send JSON response
function sendJSON(res: ServerResponse, status: number, data: any) {
	res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
	res.end(JSON.stringify(data));
}

async function run() {
	const config = loadWorkerConfig();

	logger.info("Starting Perceo Temporal Worker", {
		server: config.serverAddress,
		namespace: config.namespace,
		taskQueue: config.taskQueue,
	});

	// Create connection to Temporal server
	const connection = await NativeConnection.connect({
		address: config.serverAddress,
		tls: true,
		apiKey: config.apiKey,
	});

	// Create Temporal client for API endpoints
	const client = new Client({
		connection,
		namespace: config.namespace,
	});

	logger.info("Temporal client created successfully");

	// Start HTTP server with API endpoints
	const port = process.env.PORT || "8080";
	const apiKey = process.env.PERCEO_WORKER_API_KEY;

	const server = createServer(async (req, res) => {
		// Handle CORS preflight
		if (req.method === "OPTIONS") {
			res.writeHead(200, corsHeaders);
			res.end();
			return;
		}

		// Health check
		if (req.url === "/health") {
			sendJSON(res, 200, { status: "ok" });
			return;
		}

		// API key authentication (if configured)
		if (apiKey) {
			const providedKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
			if (providedKey !== apiKey) {
				logger.warn("API request rejected: invalid or missing API key", { path: req.url });
				sendJSON(res, 401, { error: "Unauthorized" });
				return;
			}
		}

		try {
			// POST /api/workflows/bootstrap - Start bootstrap workflow
			if (req.method === "POST" && req.url === "/api/workflows/bootstrap") {
				const body = await parseBody(req);
				const { projectId, gitRemoteUrl, projectName, framework, branch = "main", workflowApiKey, useCustomPersonas } = body;

				if (!projectId || !projectName || !framework) {
					logger.warn("Bootstrap request rejected: missing required fields", {
						projectId: !!projectId,
						projectName: !!projectName,
						framework: !!framework,
					});
					sendJSON(res, 400, {
						error: "Missing required fields: projectId, projectName, framework",
					});
					return;
				}

				if (!gitRemoteUrl) {
					logger.warn("Bootstrap request rejected: missing gitRemoteUrl", { projectId });
					sendJSON(res, 400, {
						error: "Missing required field: gitRemoteUrl (Git repository URL to clone)",
					});
					return;
				}

				if (!workflowApiKey) {
					logger.warn("Bootstrap request rejected: missing workflowApiKey", { projectId });
					sendJSON(res, 400, {
						error: "Missing required field: workflowApiKey (project-scoped API key for workflow authorization)",
					});
					return;
				}

				const workflowId = `bootstrap-${projectId}-${Date.now()}`;
				logger.info("Starting bootstrap workflow", {
					workflowId,
					projectId,
					projectName,
					gitRemoteUrl,
					framework,
					branch: body.branch ?? "main",
					workflowApiKeyPrefix: workflowApiKey.substring(0, 12),
				});

				const supabaseUrl = process.env.PERCEO_SUPABASE_URL || DEFAULT_SUPABASE_URL;
				const supabaseServiceRoleKey = process.env.PERCEO_SUPABASE_SERVICE_ROLE_KEY;
				const llmApiKey = process.env.PERCEO_OPEN_ROUTER_API_KEY || process.env.PERCEO_ANTHROPIC_API_KEY;
				const useOpenRouter = !!process.env.PERCEO_OPEN_ROUTER_API_KEY;

				if (!supabaseUrl || !supabaseServiceRoleKey) {
					logger.error("Bootstrap failed: missing Supabase credentials", { projectId });
					sendJSON(res, 500, {
						error: "Server configuration error: Missing Supabase credentials",
					});
					return;
				}

				if (!llmApiKey) {
					logger.error("Bootstrap failed: missing LLM API key", { projectId });
					sendJSON(res, 500, {
						error: "Server configuration error: Missing LLM API key. Set PERCEO_ANTHROPIC_API_KEY or PERCEO_OPEN_ROUTER_API_KEY",
					});
					return;
				}

				const bootstrapInput = {
					projectId,
					gitRemoteUrl,
					projectName,
					framework,
					branch,
					workflowApiKey,
					supabaseUrl,
					supabaseServiceRoleKey,
					llmApiKey,
					useOpenRouter,
					useCustomPersonas: !!useCustomPersonas,
				};

				const handle = await client.workflow.start("bootstrapProjectWorkflow", {
					taskQueue: config.taskQueue,
					workflowId,
					args: [bootstrapInput],
				});

				logger.info("Bootstrap workflow started", {
					workflowId: handle.workflowId,
					projectId,
				});
				sendJSON(res, 200, {
					workflowId: handle.workflowId,
					message: "Bootstrap workflow started successfully",
				});
				return;
			}

			// GET /api/workflows/:workflowId - Query workflow status
			if (req.method === "GET" && req.url?.startsWith("/api/workflows/")) {
				const workflowId = req.url.split("/api/workflows/")[1]?.split("?")[0];
				if (!workflowId) {
					logger.warn("Workflow status request: missing workflowId");
					sendJSON(res, 400, { error: "Missing workflowId" });
					return;
				}

				const handle = client.workflow.getHandle(workflowId);

				let completed = false;
				let result = null;
				let error = null;

				try {
					const description = await handle.describe();
					completed = description.status.name === "COMPLETED" || description.status.name === "FAILED";

					if (description.status.name === "FAILED") {
						error = "Workflow failed";
						logger.info("Workflow status: failed", { workflowId });
					} else if (description.status.name === "COMPLETED") {
						result = await handle.result();
						logger.info("Workflow status: completed", { workflowId, result });
					} else {
						logger.debug("Workflow status: in progress", { workflowId, status: description.status.name });
					}
				} catch (err) {
					logger.error("Error describing workflow", { workflowId, error: err instanceof Error ? err.message : String(err) });
				}

				// Query progress (if not completed)
				let progress = undefined;
				if (!completed) {
					try {
						progress = await handle.query("progress");
					} catch (err) {
						logger.debug("Error querying progress (workflow may not support it)", {
							workflowId,
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}

				sendJSON(res, 200, {
					workflowId,
					progress,
					completed,
					result: completed ? result : undefined,
					error,
				});
				return;
			}

			// 404 for unknown routes
			sendJSON(res, 404, { error: "Not found" });
		} catch (error) {
			logger.error("API error", {
				error: error instanceof Error ? error.message : "Unknown error",
				stack: error instanceof Error ? error.stack : undefined,
			});
			sendJSON(res, 500, {
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	server.listen(parseInt(port, 10), () => {
		logger.info("HTTP API server listening", {
			port: parseInt(port, 10),
			endpoints: ["POST /api/workflows/bootstrap", "GET /api/workflows/:id", "GET /health"],
		});
	});

	// Create worker
	const worker = await Worker.create({
		connection,
		namespace: config.namespace,
		workflowsPath: require.resolve("./workflows"),
		activities,
		taskQueue: config.taskQueue,
	});

	logger.info("Worker created; polling for tasks", { taskQueue: config.taskQueue });

	// Run the worker until it's told to shutdown
	await worker.run();

	logger.info("Worker stopped");
}

run().catch((err) => {
	logger.error("Worker failed", {
		error: err instanceof Error ? err.message : String(err),
		stack: err instanceof Error ? err.stack : undefined,
	});
	process.exit(1);
});
