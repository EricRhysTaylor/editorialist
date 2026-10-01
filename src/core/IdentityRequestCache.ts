// Results of asynchronous lookups, held per identity so one item can never
// display another's answer.
//
// The panel asks for context each render and keeps the last answer on screen
// while a refreshed one loads. Without an identity boundary that "last
// answer" could belong to a different scene whose suggestion happens to
// share an id, and a slow or failed request could leave it there. Here:
//   - a result is shown only for the identity it was requested for;
//   - only the newest request for an identity may store its result, so a
//     slow older response cannot overwrite a newer one;
//   - a failed newest request clears that identity's result instead of
//     leaving stale evidence up, and is not retried until the request changes.

export class IdentityRequestCache<T> {
	private readonly results = new Map<string, T>();
	private readonly latest = new Map<string, string>();

	/** The result to display for this identity right now, if any. */
	get(identity: string): T | undefined {
		return this.results.get(identity);
	}

	/** Records a request and reports whether it needs to be made. */
	begin(identity: string, requestKey: string): boolean {
		if (this.latest.get(identity) === requestKey) return false;
		this.latest.set(identity, requestKey);
		return true;
	}

	/** Stores a result if it answers the newest request; reports whether what is displayed changed. */
	complete(identity: string, requestKey: string, value: T, same: (left: T, right: T) => boolean): boolean {
		if (this.latest.get(identity) !== requestKey) return false;
		const previous = this.results.get(identity);
		this.results.set(identity, value);
		return previous === undefined || !same(previous, value);
	}

	/** Clears the identity's result if the failed request was the newest; reports whether anything changed. */
	fail(identity: string, requestKey: string): boolean {
		if (this.latest.get(identity) !== requestKey) return false;
		return this.results.delete(identity);
	}
}
