import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { loadWorkerConfig } from './config';
import { readFileSync } from 'fs';

async function run() {
  const config = loadWorkerConfig();

  console.log('Starting Perceo Temporal Worker...');
  console.log(`Server: ${config.serverAddress}`);
  console.log(`Namespace: ${config.namespace}`);
  console.log(`Task Queue: ${config.taskQueue}`);

  // Create connection to Temporal server
  const connection = await NativeConnection.connect({
    address: config.serverAddress,
    tls: config.tls
      ? {
          clientCertPair: {
            crt: readFileSync(config.tls.certPath),
            key: readFileSync(config.tls.keyPath),
          },
        }
      : undefined,
  });

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: config.taskQueue,
  });

  console.log('Worker created successfully. Starting to poll for tasks...');

  // Run the worker until it's told to shutdown
  await worker.run();

  console.log('Worker stopped.');
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
