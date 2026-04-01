declare interface ScheduledController {
	readonly cron: string;
	readonly scheduledTime: number;
	noRetry(): void;
}

declare module "cloudflare:workers" {
	export abstract class WorkerEntrypoint<Env = unknown, Props = unknown> {
		protected readonly ctx: {
			readonly props: Props;
		};
		protected readonly env: Env;
		protected constructor(ctx: unknown, env: Env);
	}
}
