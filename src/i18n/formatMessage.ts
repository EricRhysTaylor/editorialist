export type MessageParameters = Readonly<Record<string, string | number>>;

/** Replace each named slot once; author-supplied values are never reparsed. */
export function formatMessage(template: string, parameters: MessageParameters = {}): string {
	const slots = [...template.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map(match => match[1]!);
	const expected = new Set(slots);
	for (const name of expected) {
		if (!Object.prototype.hasOwnProperty.call(parameters, name)) {
			throw new Error(`Missing message parameter: ${name}`);
		}
	}
	for (const name of Object.keys(parameters)) {
		if (!expected.has(name)) throw new Error(`Unexpected message parameter: ${name}`);
	}
	return template.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name: string) => String(parameters[name]));
}
