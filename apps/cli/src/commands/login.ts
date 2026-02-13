import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createInterface } from "node:readline";
import type { AuthScope } from "../auth.js";
import { getAuthPath, setStoredAuth, getStoredAuth, type StoredAuth } from "../auth.js";
import { createSupabaseAuthClient, sendMagicLink, sessionFromRedirectUrl } from "@perceo/supabase";

type LoginOptions = {
	scope: "project" | "global";
	dir: string;
};

function question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => resolve((answer || "").trim()));
	});
}

/**
 * Start a local HTTP server to capture the magic-link redirect and resolve with the full redirect URL.
 */
function startCallbackServer(port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "/", `http://localhost:${port}`);
			if (url.pathname === "/capture" && url.searchParams.has("url")) {
				const redirectUrl = url.searchParams.get("url") ?? "";
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					`<!DOCTYPE html><html><head><title>Perceo login</title></head><body style="font-family:system-ui;padding:2rem;text-align:center;"><p>Login successful. You can close this window and return to the terminal.</p></body></html>`,
				);
				server.close();
				resolve(redirectUrl);
				return;
			}
			if (url.pathname === "/callback" || url.pathname === "/") {
				// Serve a page that sends the full URL (including hash) to /capture
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					`<!DOCTYPE html><html><head><title>Perceo login</title></head><body style="font-family:system-ui;padding:2rem;text-align:center;"><p>Completing login...</p><script>
var u = window.location.href;
fetch('/capture?url=' + encodeURIComponent(u)).then(function() { document.body.innerHTML = '<p>Login successful. You can close this window.</p>'; });
</script></body></html>`,
				);
				return;
			}
			res.writeHead(404);
			res.end("Not found");
		});

		server
			.listen(port, "127.0.0.1", () => {})
			.on("error", (err) => {
				server.close();
				reject(err);
			});
	});
}

/**
 * Find an available port starting from the given base.
 */
async function findPort(base: number): Promise<number> {
	const net = await import("node:net");
	return new Promise((resolve) => {
		const server = net.createServer();
		server.listen(base, "127.0.0.1", () => {
			const address = server.address();
			const port = address && typeof address !== "string" ? address.port : base;
			server.close(() => resolve(port));
		});
		server.on("error", () => resolve(findPort(base + 1)));
	});
}

export const loginCommand = new Command("login")
	.description("Log in to Perceo using Supabase Auth (required before init)")
	.option("-s, --scope <scope>", "Where to store the login: 'project' (this repo) or 'global' (all projects)", "project")
	.option("-d, --dir <directory>", "Project directory (for project scope)", process.cwd())
	.action(async (options: LoginOptions) => {
		const scope = (options.scope?.toLowerCase() === "global" ? "global" : "project") as AuthScope;
		const projectDir = path.resolve(options.dir || process.cwd());

		if (scope === "project") {
			const perceoDir = path.join(projectDir, ".perceo");
			try {
				await fs.mkdir(perceoDir, { recursive: true });
			} catch (e) {
				console.error(chalk.red("Could not create .perceo directory: " + (e instanceof Error ? e.message : String(e))));
				process.exit(1);
			}
		}

		const existing = await getStoredAuth(scope, scope === "project" ? projectDir : undefined);
		if (existing?.access_token) {
			console.log(chalk.yellow(`Already logged in (${scope} scope). Use \`perceo logout --scope ${scope}\` to log out first.`));
			return;
		}

		let email = process.env.PERCEO_LOGIN_EMAIL;
		if (!email) {
			const rl = createInterface({ input: process.stdin, output: process.stdout });
			email = await question(rl, "Email for magic link: ");
			rl.close();
		}
		if (!email) {
			console.error(chalk.red("Email is required. Set PERCEO_LOGIN_EMAIL or run the command interactively."));
			process.exit(1);
		}

		const spinner = ora("Starting login...").start();
		try {
			const supabase = createSupabaseAuthClient();
			const port = await findPort(38473);
			const redirectUrl = `http://127.0.0.1:${port}/callback`;

			spinner.text = "Sending magic link to your email...";
			const { error: sendError } = await sendMagicLink(supabase, email, redirectUrl);
			if (sendError) {
				spinner.fail("Failed to send magic link");
				console.error(chalk.red(sendError.message));
				process.exit(1);
			}

			spinner.succeed("Magic link sent! Check your email.");
			console.log(chalk.cyan(`Click the link in the email. It will open your browser and complete login (redirect: ${redirectUrl}).`));
			console.log(chalk.gray("Waiting for you to complete the link..."));

			const redirectReceivedUrl = await startCallbackServer(port);
			const session = await sessionFromRedirectUrl(supabase, redirectReceivedUrl);

			const toStore: StoredAuth = {
				...session,
				scope,
			};
			await setStoredAuth(toStore, scope === "project" ? projectDir : undefined);

			const where = scope === "project" ? path.relative(process.cwd(), getAuthPath(scope, projectDir)) : getAuthPath(scope);
			console.log(chalk.green("\nLogged in successfully."));
			console.log(chalk.gray(`Auth saved to: ${where}`));
			console.log(chalk.gray(`Scope: ${scope}. You can now run \`perceo init\`.`));
		} catch (error) {
			spinner.fail("Login failed");
			console.error(chalk.red(error instanceof Error ? error.message : String(error)));
			process.exit(1);
		}
	});
