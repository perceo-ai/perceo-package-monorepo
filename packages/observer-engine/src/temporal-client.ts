import { Client, Connection, Workflow, WorkflowHandle } from "@temporalio/client";
import { readFileSync } from "fs";
import { TemporalConfig } from "./types.js";

export class TemporalClient {
	private config: TemporalConfig;
	private clientPromise: Promise<Client> | null = null;

	constructor(config: TemporalConfig) {
		this.config = config;
	}

	/**
	 * Gets or creates the Temporal client
	 */
	private async getClient(): Promise<Client> {
		if (!this.clientPromise) {
			this.clientPromise = this.createClient();
		}
		return this.clientPromise;
	}

	/**
	 * Creates a new Temporal client with connection
	 */
	private async createClient(): Promise<Client> {
		const address = this.config.address || "localhost:7233";
		const namespace = this.config.namespace || "perceo";

		// Create connection
		const connection = await Connection.connect({
			address,
			tls: true,
			apiKey: this.config.apiKey,
		});

		// Create client
		return new Client({
			connection,
			namespace,
		});
	}

	/**
	 * Executes a workflow and waits for result
	 */
	async executeWorkflow<T>(
		workflowName: string,
		input: any,
		options: {
			workflowId: string;
			taskQueue?: string;
		},
	): Promise<T> {
		const client = await this.getClient();
		const taskQueue = options.taskQueue || this.config.taskQueue || "observer-engine";

		// Start workflow
		const handle: WorkflowHandle = await client.workflow.start(workflowName, {
			args: [input],
			taskQueue,
			workflowId: options.workflowId,
		});

		// Wait for result
		return (await handle.result()) as T;
	}

	/**
	 * Starts a workflow without waiting for result
	 */
	async startWorkflow<T>(
		workflowName: string,
		input: any,
		options: {
			workflowId: string;
			taskQueue?: string;
		},
	): Promise<WorkflowHandle> {
		const client = await this.getClient();
		const taskQueue = options.taskQueue || this.config.taskQueue || "observer-engine";

		return await client.workflow.start(workflowName, {
			args: [input],
			taskQueue,
			workflowId: options.workflowId,
		});
	}

	/**
	 * Gets a handle to an existing workflow
	 */
	async getWorkflowHandle(workflowId: string): Promise<WorkflowHandle> {
		const client = await this.getClient();
		return client.workflow.getHandle(workflowId);
	}

	/**
	 * Signals a running workflow
	 */
	async signalWorkflow(workflowId: string, signalName: string, args?: any[]): Promise<void> {
		const handle = await this.getWorkflowHandle(workflowId);
		await handle.signal(signalName, ...(args || []));
	}

	/**
	 * Queries a running workflow
	 */
	async queryWorkflow<T>(workflowId: string, queryName: string): Promise<T> {
		const handle = await this.getWorkflowHandle(workflowId);
		return await handle.query<T>(queryName);
	}
}
