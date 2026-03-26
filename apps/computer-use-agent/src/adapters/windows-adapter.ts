import type { VMAdapter } from "../vma-adapter.js";

/**
 * Low-level RDP / pyrdp / FreeRDP bridge injected from the worker host.
 * Implement this in Python or native code; keep desktop logic in TypeScript only here.
 */
export type WindowsVmBridge = {
	captureJpeg(): Promise<Buffer>;
	sendClick(x: number, y: number): Promise<void>;
	sendType(text: string): Promise<void>;
	sendScroll(x: number, y: number, direction: "up" | "down", clicks: number): Promise<void>;
	sendShortcut(keys: string[]): Promise<void>;
	injectAudioFromFile(filepath: string): Promise<void>;
	capturePcm(durationMs: number): Promise<Buffer>;
	getDesktopSize(): Promise<{ width: number; height: number }>;
};

/**
 * Windows-specific transport: maps normalized coordinates to pixels and delegates to `bridge`.
 */
export class WindowsVMAdapter implements VMAdapter {
	constructor(private readonly bridge: WindowsVmBridge) {}

	async getScreenshot(): Promise<Buffer> {
		return this.bridge.captureJpeg();
	}

	async click(nx: number, ny: number): Promise<void> {
		const { width, height } = await this.bridge.getDesktopSize();
		const x = Math.round(nx * width);
		const y = Math.round(ny * height);
		await this.bridge.sendClick(x, y);
	}

	async type(text: string): Promise<void> {
		await this.bridge.sendType(text);
	}

	async scroll(nx: number, ny: number, direction: "up" | "down", clicks: number): Promise<void> {
		const { width, height } = await this.bridge.getDesktopSize();
		const x = Math.round(nx * width);
		const y = Math.round(ny * height);
		await this.bridge.sendScroll(x, y, direction, clicks);
	}

	async injectAudio(filepath: string): Promise<void> {
		await this.bridge.injectAudioFromFile(filepath);
	}

	async captureAudio(durationMs: number): Promise<Buffer> {
		return this.bridge.capturePcm(durationMs);
	}

	async getResolution(): Promise<{ width: number; height: number }> {
		return this.bridge.getDesktopSize();
	}

	async shortcut(keys: string[]): Promise<void> {
		await this.bridge.sendShortcut(keys);
	}

	// The HTTP Windows bridge is currently VM-control only; file/audio assertions
	// for the local testing framework will be implemented in a separate adapter
	// layer. For now, these throw to make failures explicit if invoked.
	async readFile(_filepath: string): Promise<string> {
		throw new Error("readFile is not implemented for HttpWindowsVmBridge");
	}
	async listFiles(_dirpath: string): Promise<string[]> {
		throw new Error("listFiles is not implemented for HttpWindowsVmBridge");
	}
	async getFileSize(_filepath: string): Promise<number> {
		throw new Error("getFileSize is not implemented for HttpWindowsVmBridge");
	}
	async transcribeAudio(_pcm: Buffer): Promise<string> {
		throw new Error("transcribeAudio is not implemented for HttpWindowsVmBridge");
	}
}
