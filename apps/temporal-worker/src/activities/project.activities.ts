import { Context } from '@temporalio/activity';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Detects the framework used in a project by reading package.json
 */
export async function detectFramework(projectDir: string): Promise<string> {
  Context.current().heartbeat();

  const packageJsonPath = join(projectDir, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  // Framework detection logic
  if (dependencies['next']) return 'next';
  if (dependencies['@remix-run/react']) return 'remix';
  if (dependencies['react']) return 'react';
  if (dependencies['vue']) return 'vue';
  if (dependencies['@angular/core']) return 'angular';
  if (dependencies['svelte']) return 'svelte';

  return 'unknown';
}

/**
 * Reads multiple project files in batch
 */
export async function readProjectFiles(
  projectDir: string,
  paths: string[]
): Promise<Record<string, string>> {
  Context.current().heartbeat();

  const result: Record<string, string> = {};

  for (const path of paths) {
    const fullPath = join(projectDir, path);
    if (existsSync(fullPath)) {
      result[path] = readFileSync(fullPath, 'utf-8');
    }
  }

  return result;
}

/**
 * Scans a directory for files matching glob patterns
 */
export async function scanDirectory(
  projectDir: string,
  patterns: string[]
): Promise<string[]> {
  Context.current().heartbeat();

  const files: string[] = [];

  function scanRecursive(dir: string) {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      // Skip node_modules and hidden directories
      if (stat.isDirectory()) {
        if (entry !== 'node_modules' && !entry.startsWith('.')) {
          scanRecursive(fullPath);
        }
      } else if (stat.isFile()) {
        const relativePath = relative(projectDir, fullPath);

        // Check if file matches any pattern
        const matches = patterns.some(pattern => {
          // Simple glob matching (*.tsx, *.ts, etc.)
          if (pattern.startsWith('*.')) {
            const ext = pattern.slice(1);
            return relativePath.endsWith(ext);
          }
          // Exact match or contains
          return relativePath.includes(pattern);
        });

        if (matches) {
          files.push(relativePath);
        }
      }
    }
  }

  scanRecursive(projectDir);
  return files;
}
