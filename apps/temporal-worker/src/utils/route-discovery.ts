/**
 * Phase 1: Route graph discovery (no LLM).
 * Discovers routes/pages via framework conventions and parses Link/navigate/router.push for edges.
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface Route {
	path: string;
	filePath: string;
}

export interface RouteGraphResult {
	routes: Route[];
	navigationGraph: { from: string; to: string }[];
}

const ROUTE_PATTERNS: Record<string, string[]> = {
	nextjs: [
		"app/**/page.tsx",
		"app/**/page.ts",
		"app/**/page.jsx",
		"app/**/page.js",
		"app/**/layout.tsx",
		"pages/**/*.tsx",
		"pages/**/*.ts",
		"pages/**/*.jsx",
		"pages/**/*.js",
		"src/app/**/page.tsx",
		"src/app/**/page.ts",
		"src/pages/**/*.tsx",
		"src/pages/**/*.ts",
	],
	remix: ["app/routes/**/*.tsx", "app/routes/**/*.ts", "app/routes/**/*.jsx", "app/routes/**/*.js"],
	react: ["src/**/pages/**/*.tsx", "src/**/*.tsx", "pages/**/*.tsx", "src/**/routes/**/*.tsx"],
};

/**
 * Map file path to route path for Next.js App Router (app/.../page.tsx -> /segment/segment)
 */
function appRouterFilePathToRoute(filePath: string, projectDir: string): string {
	const relative = filePath.replace(projectDir, "").replace(/^\//, "");
	// app/page.tsx -> /
	// app/dashboard/page.tsx -> /dashboard
	// app/(auth)/login/page.tsx -> /login (strip route groups)
	const withoutApp = relative.replace(/^app\//, "").replace(/^src\/app\//, "");
	const withoutPage = withoutApp.replace(/\/page\.(tsx?|jsx?)$/, "").replace(/\/layout\.(tsx?|jsx?)$/, "");
	const segments = withoutPage.split("/").filter(Boolean);
	// Remove route groups like (auth)
	const pathSegments = segments.filter((s) => !s.startsWith("(") || !s.endsWith(")"));
	return "/" + pathSegments.join("/") || "/";
}

/**
 * Map file path to route for Next.js Pages Router (pages/foo.tsx -> /foo)
 */
function pagesRouterFilePathToRoute(filePath: string, projectDir: string): string {
	const relative = filePath.replace(projectDir, "").replace(/^\//, "");
	const match = relative.match(/^(?:src\/)?pages\/(.+)\.(tsx?|jsx?)$/);
	if (!match) return "/";
	let path = "/" + match[1];
	if (path === "/index") path = "/";
	return path;
}

/**
 * Map file path to route for Remix (app/routes/foo.tsx -> /foo, app/routes/foo.$id.tsx -> /foo/:id)
 */
function remixFilePathToRoute(filePath: string, projectDir: string): string {
	const relative = filePath.replace(projectDir, "").replace(/^\//, "");
	const match = relative.match(/^app\/routes\/(.+)\.(tsx?|jsx?)$/);
	if (!match) return "/";
	let segment = match[1] ?? "";
	// Remove $param -> :param
	segment = segment.replace(/\$(\w+)/g, ":$1");
	// index -> /
	if (segment === "index") return "/";
	return "/" + segment;
}

function filePathToRoute(filePath: string, projectDir: string, framework: string): string {
	const normalizedPath = filePath.replace(projectDir, "").replace(/^\//, "");
	if (framework === "nextjs") {
		if (normalizedPath.includes("/app/") || normalizedPath.includes("/src/app/")) {
			return appRouterFilePathToRoute(filePath, projectDir);
		}
		if (normalizedPath.includes("/pages/") || normalizedPath.includes("/src/pages/")) {
			return pagesRouterFilePathToRoute(filePath, projectDir);
		}
	}
	if (framework === "remix") {
		return remixFilePathToRoute(filePath, projectDir);
	}
	// Generic: use path without extension
	const base = normalizedPath
		.replace(/\.(tsx?|jsx?)$/, "")
		.replace(/^src\//, "")
		.replace(/^pages\//, "")
		.replace(/^app\/routes\//, "");
	return "/" + (base === "index" ? "" : base);
}

/**
 * Find files matching glob-like patterns using find
 */
function findFiles(projectDir: string, patterns: string[]): string[] {
	const allFiles: string[] = [];
	for (const pattern of patterns) {
		const clean = pattern.replace(/^\.\//, "").replace(/\*\*\//g, "*");
		const parts = clean.split("*");
		const baseDir = parts[0]?.split("/")[0] ?? ".";
		const hasSubdirs = pattern.includes("**");
		let cmd: string;
		if (hasSubdirs) {
			// find app -type f -name "page.tsx"
			const namePart = pattern.split("/").pop() ?? "*";
			cmd = `find ${baseDir} -type f -name "${namePart}" 2>/dev/null`;
		} else {
			cmd = `find . -path "./${clean}" -type f 2>/dev/null`;
		}
		try {
			const out = execSync(cmd, { cwd: projectDir, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 }).trim();
			if (out)
				allFiles.push(
					...out
						.split("\n")
						.map((f) => join(projectDir, f.replace(/^\.\//, "")))
						.filter(Boolean),
				);
		} catch {
			// ignore
		}
	}
	return Array.from(new Set(allFiles));
}

/** Strip query and hash from path for graph edges */
function pathOnly(s: string): string {
	const beforeHash = s.split("#")[0];
	return beforeHash !== undefined ? beforeHash : s;
}

/**
 * Extract href from <Link href="..."> or <Link href={...}>
 */
function extractLinkHrefs(content: string): string[] {
	const hrefs: string[] = [];
	// href="/path" or href='/path' or href={"/path"} or href={pathVar}
	const regex = /<Link[^>]+href=(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(content)) !== null) {
		const h = m[1] ?? m[2] ?? m[3];
		if (typeof h === "string" && !h.startsWith("{")) hrefs.push(pathOnly(h.split("?")[0] ?? h));
	}
	// next/link and similar
	const regex2 = /href\s*=\s*["']([^"']+)["']/g;
	while ((m = regex2.exec(content)) !== null) {
		const h = m[1];
		if (typeof h === "string") hrefs.push(pathOnly(h.split("?")[0] ?? h));
	}
	return hrefs;
}

/**
 * Extract navigation targets from router.push(...), navigate(...), redirect(...)
 */
function extractNavigateTargets(content: string): string[] {
	const targets: string[] = [];
	// router.push("/path") or router.push(`/path`)
	const pushRegex = /(?:router|useRouter)\.push\s*\(\s*["'`]([^"'`]+)["'`]/g;
	let m: RegExpExecArray | null;
	while ((m = pushRegex.exec(content)) !== null) {
		if (typeof m[1] === "string") targets.push(pathOnly(m[1].split("?")[0] ?? m[1]));
	}
	// navigate("/path") or navigate(`/path`)
	const navRegex = /navigate\s*\(\s*["'`]([^"'`]+)["'`]/g;
	while ((m = navRegex.exec(content)) !== null) {
		if (typeof m[1] === "string") targets.push(pathOnly(m[1].split("?")[0] ?? m[1]));
	}
	// redirect("/path")
	const redirRegex = /redirect\s*\(\s*["'`]([^"'`]+)["'`]/g;
	while ((m = redirRegex.exec(content)) !== null) {
		if (typeof m[1] === "string") targets.push(pathOnly(m[1].split("?")[0] ?? m[1]));
	}
	return targets;
}

/**
 * Discover routes and navigation graph for a project.
 */
export function discoverRouteGraph(projectDir: string, framework: string): RouteGraphResult {
	const patterns: string[] = ROUTE_PATTERNS[framework] ?? ROUTE_PATTERNS.nextjs ?? [];
	const files = findFiles(projectDir, patterns);

	const routes: Route[] = [];
	const edgeSet = new Set<string>();
	const normalizedProjectDir = projectDir.endsWith("/") ? projectDir : projectDir + "/";

	for (const filePath of files) {
		if (!existsSync(filePath)) continue;
		const routePath = filePathToRoute(filePath, normalizedProjectDir, framework);
		routes.push({ path: routePath, filePath });
	}

	// Dedupe routes by path (keep one file per path)
	const pathToRoute = new Map<string, Route>();
	for (const r of routes) {
		if (!pathToRoute.has(r.path)) pathToRoute.set(r.path, r);
	}
	const uniqueRoutes = Array.from(pathToRoute.values());

	// Build navigation graph by parsing files
	for (const route of uniqueRoutes) {
		const filePath = route?.filePath;
		const fromPath = route?.path;
		if (!filePath || fromPath === undefined) continue;
		try {
			const content = readFileSync(filePath, "utf-8");
			for (const href of extractLinkHrefs(content)) {
				const raw = href.startsWith("/") ? href : "/" + href;
				const toPath = href.startsWith("http") ? "" : pathOnly(raw.split("?")[0] ?? raw);
				if (toPath && toPath !== fromPath) edgeSet.add(JSON.stringify({ from: fromPath, to: toPath }));
			}
			for (const toPath of extractNavigateTargets(content)) {
				const normalized = toPath.startsWith("/") ? toPath : "/" + toPath;
				if (normalized !== fromPath) edgeSet.add(JSON.stringify({ from: fromPath, to: normalized }));
			}
		} catch {
			// skip unreadable files
		}
	}

	const navigationGraph = Array.from(edgeSet).map((s) => JSON.parse(s) as { from: string; to: string });

	return {
		routes: uniqueRoutes,
		navigationGraph,
	};
}
