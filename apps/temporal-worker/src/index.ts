import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities";
import { loadWorkerConfig } from "./config";
import { readFileSync } from "fs";
import { createServer } from "http";

async function run() {
	const config = loadWorkerConfig();

	console.log("Starting Perceo Temporal Worker...");
	console.log(`Server: ${config.serverAddress}`);
	console.log(`Namespace: ${config.namespace}`);
	console.log(`Task Queue: ${config.taskQueue}`);

	// Start a simple HTTP server for Cloud Run health checks
	const port = process.env.PORT || "8080";
	const server = createServer((req, res) => {
		if (req.url === "/health") {
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("ok");
			return;
		}

		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("perceo-temporal-worker");
	});

	server.listen(parseInt(port, 10), () => {
		console.log(`Healthcheck server listening on port ${port}`);
	});

	// Create connection to Temporal server
	const connection = await NativeConnection.connect({
		address: config.serverAddress,
		tls: config.tls
			? {
					clientCertPair: {
						crt: readFileSync(config.tls.certPath),
						key: readFileSync(config.tls.keyPath),
					},
				}
			: undefined,
	});

	// Create worker
	const worker = await Worker.create({
		connection,
		namespace: config.namespace,
		workflowsPath: require.resolve("./workflows"),
		activities,
		taskQueue: config.taskQueue,
	});

	console.log("Worker created successfully. Starting to poll for tasks...");

	// Run the worker until it's told to shutdown
	await worker.run();

	console.log("Worker stopped.");
}

run().catch((err) => {
	console.error("Worker failed:", err);
	process.exit(1);
});
