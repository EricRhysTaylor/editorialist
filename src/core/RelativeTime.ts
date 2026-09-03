// "5m ago" / "2w ago" style labels for timestamps. Used by the review
// panel's idle sections and by the duplicate-import prompt, so it lives in
// core rather than in either caller.
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
	const diff = now - timestamp;
	if (diff < 60_000) return "just now";
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	const years = Math.floor(days / 365);
	return `${years}y ago`;
}
