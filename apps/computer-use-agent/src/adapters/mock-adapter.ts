import type { VMAdapter } from "../vma-adapter.js";

/** 1×1 pixel grey JPEG — valid image for APIs that accept JPEG bytes. */
const MINIMAL_JPEG = Buffer.from(
	"/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABmQD/9k=",
	"base64",
);

/**
 * In-memory adapter for unit tests and local plumbing without a VM.
 */
export class MockVMAdapter implements VMAdapter {
	private width = 1920;
	private height = 1080;

	constructor(resolution?: { width: number; height: number }) {
		if (resolution) {
			this.width = resolution.width;
			this.height = resolution.height;
		}
	}

	async getScreenshot(): Promise<Buffer> {
		return Buffer.from(MINIMAL_JPEG);
	}

	async click(): Promise<void> {
		/* no-op */
	}

	async type(): Promise<void> {
		/* no-op */
	}

	async scroll(): Promise<void> {
		/* no-op */
	}

	async injectAudio(): Promise<void> {
		/* no-op */
	}

	async captureAudio(): Promise<Buffer> {
		return Buffer.alloc(0);
	}

	async getResolution(): Promise<{ width: number; height: number }> {
		return { width: this.width, height: this.height };
	}

	async shortcut(): Promise<void> {
		/* no-op */
	}

	async readFile(_filepath: string): Promise<string> {
		return "";
	}

	async listFiles(_dirpath: string): Promise<string[]> {
		return [];
	}

	async getFileSize(_filepath: string): Promise<number> {
		return 0;
	}

	async transcribeAudio(_pcm: Buffer): Promise<string> {
		return "";
	}
}
