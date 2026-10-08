/** Ticks needed to cover `seconds` of game time (rounded up, so a wait is never cut short). */
export function secondsToTicks(seconds: number, tickSeconds: number): number {
	if (!(seconds >= 0)) throw new Error(`invalid number of seconds: ${seconds}`);
	return Math.ceil(seconds / tickSeconds - 1e-9);
}

/** `12.5 s` */
export function formatSeconds(seconds: number): string {
	return `${Number(seconds.toFixed(3))} s`;
}
