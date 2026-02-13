import { proxyActivities, setHandler, defineQuery } from '@temporalio/workflow';
import type * as activities from '../activities';

// Proxy activities with retry policies (faster retries for analysis)
const {
  computeGitDiff,
  callObserverAnalyzeApi,
  publishEvent,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 minutes',
  retry: {
    initialInterval: '500ms',
    maximumInterval: '10s',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

export interface AnalyzeChangesInput {
  projectId: string;
  projectRoot: string;
  baseSha: string;
  headSha: string;
  apiConfig: {
    baseUrl: string;
    apiKey?: string;
  };
  eventBusConfig?: {
    redisUrl: string;
  };
}

export interface AnalyzeChangesResult {
  affectedFlows: string[];
  affectedPersonas: string[];
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  changeCount: number;
}

// Progress tracking
let currentProgress = {
  stage: 'initializing',
  message: 'Starting change analysis...',
  percentage: 0,
};

export const analyzeProgressQuery = defineQuery<typeof currentProgress>('progress');

export async function analyzeChangesWorkflow(
  input: AnalyzeChangesInput
): Promise<AnalyzeChangesResult> {
  // Set up progress query handler
  setHandler(analyzeProgressQuery, () => currentProgress);

  // Step 1: Compute Git diff
  currentProgress = {
    stage: 'computing_diff',
    message: `Computing diff between ${input.baseSha} and ${input.headSha}...`,
    percentage: 20,
  };

  const changes = await computeGitDiff(
    input.projectRoot,
    input.baseSha,
    input.headSha
  );

  if (changes.length === 0) {
    currentProgress = {
      stage: 'complete',
      message: 'No changes detected',
      percentage: 100,
    };

    return {
      affectedFlows: [],
      affectedPersonas: [],
      riskLevel: 'low',
      summary: 'No changes detected between the specified commits',
      changeCount: 0,
    };
  }

  // Step 2: Call impact analysis API
  currentProgress = {
    stage: 'analyzing_impact',
    message: `Analyzing impact of ${changes.length} changed files...`,
    percentage: 50,
  };

  const impactReport = await callObserverAnalyzeApi(input.apiConfig, {
    projectId: input.projectId,
    changes,
    baseSha: input.baseSha,
    headSha: input.headSha,
  });

  // Step 3: Publish completion event if configured
  if (input.eventBusConfig) {
    currentProgress = {
      stage: 'publishing_event',
      message: 'Publishing analysis event...',
      percentage: 90,
    };

    await publishEvent(input.eventBusConfig, {
      type: 'observer.analysis.complete',
      payload: {
        projectId: input.projectId,
        baseSha: input.baseSha,
        headSha: input.headSha,
        changeCount: changes.length,
        affectedFlowCount: impactReport.affectedFlows.length,
        riskLevel: impactReport.riskLevel,
      },
    });
  }

  currentProgress = {
    stage: 'complete',
    message: 'Analysis completed successfully!',
    percentage: 100,
  };

  return {
    affectedFlows: impactReport.affectedFlows,
    affectedPersonas: impactReport.affectedPersonas,
    riskLevel: impactReport.riskLevel,
    summary: impactReport.summary,
    changeCount: changes.length,
  };
}
