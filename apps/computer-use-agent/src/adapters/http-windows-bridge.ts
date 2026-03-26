import type { WindowsVmBridge } from "./windows-adapter.js";

/**
 * HTTP JSON bridge that runs beside the Windows VM (or as a sidecar) and forwards
 * to RDP/pyrdp/FreeRDP. Expected routes (REST):
 *
 * - `GET /screenshot` → image/jpeg body
 * - `POST /click` `{ "x": number, "y": number }` pixel coordinates
 * - `POST /type` `{ "text": string }`
 * - `POST /scroll` `{ "x", "y", "direction": "up"|"down", "clicks": number }`
 * - `POST /shortcut` `{ "keys": string[] }`
 * - `POST /inject-audio` `{ "filepath": string }`
 * - `POST /capture-audio` `{ "durationMs": number }` → raw PCM body
 * - `GET /resolution` → `{ "width": number, "height": number }`
 */
export class HttpWindowsVmBridge implements WindowsVmBridge {
	constructor(
		private readonly baseUrl: string,
		private readonly headersInit?: Record<string, string>,
	) {}

	private url(path: string): string {
		return `${this.baseUrl.replace(/\/$/, "")}${path}`;
	}

	private headers(json?: boolean): HeadersInit {
		const h: Record<string, string> = { ...(this.headersInit ?? {}) };
		if (json) h["content-type"] = "application/json";
		return h;
	}

	async captureJpeg(): Promise<Buffer> {
		const r = await fetch(this.url("/screenshot"), { headers: this.headers() });
		if (!r.ok) throw new Error(`HttpWindowsVmBridge screenshot: ${r.status} ${await r.text()}`);
		return Buffer.from(await r.arrayBuffer());
	}

	async sendClick(x: number, y: number): Promise<void> {
		const r = await fetch(this.url("/click"), {
			method: "POST",
			headers: this.headers(true),
			body: JSON.stringify({ x, y }),
		});
		if (!r.ok) throw new Error(`HttpWindowsVmBridge click: ${r.status}`);
	}

	async sendType(text: string): Promise<void> {
		const r = await fetch(this.url("/type"), {
			method: "POST",
			headers: this.headers(true),
			body: JSON.stringify({ text }),
		});
		if (!r.ok) throw new Error(`HttpWindowsVmBridge type: ${r.status}`);
	}

	async sendScroll(x: number, y: number, direction: "up" | "down", clicks: number): Promise<void> {
		const r = await fetch(this.url("/scroll"), {
			method: "POST",
			headers: this.headers(true),
			body: JSON.stringify({ x, y, direction, clicks }),
		});
		if (!r.ok) throw new Error(`HttpWindowsVmBridge scroll: ${r.status}`);
	}

	async sendShortcut(keys: string[]): Promise<void> {
		const r = await fetch(this.url("/shortcut"), {
			method: "POST",
			headers: this.headers(true),
			body: JSON.stringify({ keys }),
		});
		if (!r.ok) throw new Error(`HttpWindowsVmBridge shortcut: ${r.status}`);
	}

	async injectAudioFromFile(filepath: string): Promise<void> {
		const r = await fetch(this.url("/inject-audio"), {
			method: "POST",
			headers: this.headers(true),
			body: JSON.stringify({ filepath }),
		});
		if (!r.ok) throw new Error(`HttpWindowsVmBridge injectAudio: ${r.status}`);
	}

	async capturePcm(durationMs: number): Promise<Buffer> {
		const r = await fetch(this.url("/capture-audio"), {
			method: "POST",
			headers: this.headers(true),
			body: JSON.stringify({ durationMs }),
		});
		if (!r.ok) throw new Error(`HttpWindowsVmBridge captureAudio: ${r.status}`);
		return Buffer.from(await r.arrayBuffer());
	}

	async getDesktopSize(): Promise<{ width: number; height: number }> {
		const r = await fetch(this.url("/resolution"), { headers: this.headers() });
		if (!r.ok) throw new Error(`HttpWindowsVmBridge resolution: ${r.status}`);
		const j = (await r.json()) as { width: number; height: number };
		return j;
	}
}
