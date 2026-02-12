import type { BootstrapOptions, BootstrapResult, ChangeAnalysis, ImpactReport, ObserverEngineConfig } from "./types.js";

export interface ObserverApiClientOptions {
	baseUrl: string;
	apiKey?: string;
}

export class ObserverApiClient {
	private readonly baseUrl: string;
	private readonly apiKey?: string;

	constructor(options: ObserverApiClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;
	}

	static fromConfig(config: ObserverEngineConfig): ObserverApiClient | null {
		const baseUrl = config.observer.apiBaseUrl;
		if (!baseUrl) return null;
		return new ObserverApiClient({
			baseUrl,
			apiKey: config.observer.apiKey,
		});
	}

	async bootstrapProject(options: BootstrapOptions): Promise<BootstrapResult> {
		const res = await this.post<BootstrapResult>("/observer/bootstrap", options);
		return res;
	}

	async analyzeChanges(change: ChangeAnalysis): Promise<ImpactReport> {
		const res = await this.post<ImpactReport>("/observer/analyze", change);
		return res;
	}

	private async post<T>(path: string, body: unknown): Promise<T> {
		const url = `${this.baseUrl}${path}`;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.apiKey) {
			headers["Authorization"] = `Bearer ${this.apiKey}`;
		}

		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Observer API request failed (${response.status}): ${text || response.statusText}`);
		}

		return (await response.json()) as T;
	}
}
