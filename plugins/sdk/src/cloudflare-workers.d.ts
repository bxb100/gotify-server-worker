declare interface ScheduledController {
	readonly cron: string;
	readonly scheduledTime: number;
	noRetry(): void;
}
