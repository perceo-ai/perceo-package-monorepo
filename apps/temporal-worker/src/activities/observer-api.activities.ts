import { Context } from '@temporalio/activity';
import fetch from 'node-fetch';
import { GitDiffFile } from './git.activities';

export interface ObserverApiConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface BootstrapResult {
  flows: any[];
  personas: any[];
  projectId: string;
}

export interface ImpactReport {
  affectedFlows: string[];
  affectedPersonas: string[];
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
}

/**
 * Calls the Observer Bootstrap API
 */
export async function callObserverBootstrapApi(
  config: ObserverApiConfig,
  input: {
    projectName: string;
    projectDir: string;
    framework: string;
  }
): Promise<BootstrapResult> {
  const context = Context.current();
  context.heartbeat();

  const url = `${config.baseUrl}/observer/bootstrap`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        projectName: input.projectName,
        projectDir: input.projectDir,
        framework: input.framework,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Bootstrap API call failed: ${response.status} ${response.statusText}. ${errorBody}`
      );
    }

    const result = await response.json();
    return result as BootstrapResult;
  } catch (error: any) {
    throw new Error(`Failed to call bootstrap API: ${error.message}`);
  }
}

/**
 * Calls the Observer Analyze API
 */
export async function callObserverAnalyzeApi(
  config: ObserverApiConfig,
  input: {
    projectId: string;
    changes: GitDiffFile[];
    baseSha: string;
    headSha: string;
  }
): Promise<ImpactReport> {
  const context = Context.current();
  context.heartbeat();

  const url = `${config.baseUrl}/observer/analyze`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        projectId: input.projectId,
        changes: input.changes,
        baseSha: input.baseSha,
        headSha: input.headSha,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Analyze API call failed: ${response.status} ${response.statusText}. ${errorBody}`
      );
    }

    const result = await response.json();
    return result as ImpactReport;
  } catch (error: any) {
    throw new Error(`Failed to call analyze API: ${error.message}`);
  }
}

/**
 * Analyzes a single file change (used in watch mode)
 */
export async function analyzeFileChange(
  config: ObserverApiConfig,
  input: {
    projectId: string;
    filePath: string;
    changeType: 'added' | 'modified' | 'deleted';
  }
): Promise<ImpactReport> {
  const context = Context.current();
  context.heartbeat();

  const url = `${config.baseUrl}/observer/analyze-file`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        projectId: input.projectId,
        filePath: input.filePath,
        changeType: input.changeType,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `File analysis API call failed: ${response.status} ${response.statusText}. ${errorBody}`
      );
    }

    const result = await response.json();
    return result as ImpactReport;
  } catch (error: any) {
    throw new Error(`Failed to analyze file change: ${error.message}`);
  }
}

/**
 * Triggers test execution for affected flows
 */
export async function triggerAffectedTests(
  config: ObserverApiConfig,
  input: {
    projectId: string;
    flowIds: string[];
  }
): Promise<{ testRunId: string }> {
  const context = Context.current();
  context.heartbeat();

  const url = `${config.baseUrl}/observer/trigger-tests`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        projectId: input.projectId,
        flowIds: input.flowIds,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Trigger tests API call failed: ${response.status} ${response.statusText}. ${errorBody}`
      );
    }

    const result = await response.json();
    return result as { testRunId: string };
  } catch (error: any) {
    throw new Error(`Failed to trigger tests: ${error.message}`);
  }
}
