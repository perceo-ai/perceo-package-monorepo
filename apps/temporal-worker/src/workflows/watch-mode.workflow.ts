import {
  proxyActivities,
  setHandler,
  defineSignal,
  defineQuery,
  condition,
  sleep,
} from '@temporalio/workflow';
import type * as activities from '../activities';

const {
  analyzeFileChange,
  triggerAffectedTests,
  publishEvent,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '500ms',
    maximumInterval: '10s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface WatchModeInput {
  projectId: string;
  apiConfig: {
    baseUrl: string;
    apiKey?: string;
  };
  eventBusConfig?: {
    redisUrl: string;
  };
  autoTriggerTests?: boolean;
  debounceMs?: number;
}

export interface FileChangeSignal {
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted';
}

// State management
let isRunning = true;
let pendingChanges: FileChangeSignal[] = [];
let processedCount = 0;
let currentlyProcessing = false;

// Define signals
export const fileChangedSignal = defineSignal<[FileChangeSignal]>('fileChanged');
export const stopWatchSignal = defineSignal('stopWatch');

// Define queries
export const watchStatusQuery = defineQuery<{
  isRunning: boolean;
  pendingChanges: number;
  processedCount: number;
}>('status');

export async function watchModeWorkflow(
  input: WatchModeInput
): Promise<{ processedCount: number }> {
  const debounceMs = input.debounceMs || 1000;

  // Set up signal handlers
  setHandler(fileChangedSignal, (change: FileChangeSignal) => {
    if (isRunning) {
      pendingChanges.push(change);
    }
  });

  setHandler(stopWatchSignal, () => {
    isRunning = false;
  });

  // Set up query handler
  setHandler(watchStatusQuery, () => ({
    isRunning,
    pendingChanges: pendingChanges.length,
    processedCount,
  }));

  // Main watch loop
  while (isRunning) {
    // Wait for changes or check every second
    await condition(() => pendingChanges.length > 0 || !isRunning, '1s');

    if (!isRunning) break;

    if (pendingChanges.length > 0 && !currentlyProcessing) {
      currentlyProcessing = true;

      // Debounce: wait for more changes to accumulate
      await sleep(debounceMs);

      // Batch process all pending changes
      const changesToProcess = [...pendingChanges];
      pendingChanges = [];

      try {
        // Deduplicate changes by file path (keep latest)
        const deduplicatedChanges = new Map<string, FileChangeSignal>();
        for (const change of changesToProcess) {
          deduplicatedChanges.set(change.filePath, change);
        }

        const affectedFlows = new Set<string>();

        // Analyze each unique file change
        for (const change of deduplicatedChanges.values()) {
          try {
            const report = await analyzeFileChange(input.apiConfig, {
              projectId: input.projectId,
              filePath: change.filePath,
              changeType: change.changeType,
            });

            // Collect affected flows
            report.affectedFlows.forEach(flow => affectedFlows.add(flow));

            processedCount++;
          } catch (error: any) {
            // Log error but continue processing other files
            console.error(`Failed to analyze ${change.filePath}:`, error.message);
          }
        }

        // Publish batch analysis event
        if (input.eventBusConfig && affectedFlows.size > 0) {
          await publishEvent(input.eventBusConfig, {
            type: 'observer.watch.batch_analyzed',
            payload: {
              projectId: input.projectId,
              fileCount: deduplicatedChanges.size,
              affectedFlowCount: affectedFlows.size,
              affectedFlows: Array.from(affectedFlows),
            },
          });
        }

        // Trigger tests if configured
        if (input.autoTriggerTests && affectedFlows.size > 0) {
          await triggerAffectedTests(input.apiConfig, {
            projectId: input.projectId,
            flowIds: Array.from(affectedFlows),
          });
        }
      } finally {
        currentlyProcessing = false;
      }
    }
  }

  // Publish watch stopped event
  if (input.eventBusConfig) {
    await publishEvent(input.eventBusConfig, {
      type: 'observer.watch.stopped',
      payload: {
        projectId: input.projectId,
        processedCount,
      },
    });
  }

  return { processedCount };
}
