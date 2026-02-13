import { Context } from "@temporalio/activity";
import { createClient as createRedisClient } from "redis";

export interface EventBusConfig {
	redisUrl: string;
}

/**
 * Publishes an event to Redis event bus
 */
export async function publishEvent(
	config: EventBusConfig,
	event: {
		type: string;
		payload: any;
		timestamp?: string;
	},
): Promise<void> {
	Context.current().heartbeat();

	const client = createRedisClient({ url: config.redisUrl });

	try {
		await client.connect();

		const channel = `perceo:events:${event.type}`;
		const message = JSON.stringify({
			...event,
			timestamp: event.timestamp || new Date().toISOString(),
		});

		await client.publish(channel, message);

		console.log(`Published event to ${channel}:`, event.type);
	} catch (error: any) {
		throw new Error(`Failed to publish event: ${error.message}`);
	} finally {
		await client.quit();
	}
}
