import { en } from "./locales/en";
import { formatMessage } from "./formatMessage";

export type TranslationKey = keyof typeof en;
type Slots<Text extends string> = Text extends `${string}{{${infer Name}}}${infer Rest}` ? Name | Slots<Rest> : never;
type Arguments<Key extends TranslationKey> = [Slots<(typeof en)[Key]>] extends [never]
	? []
	: [parameters: Record<Slots<(typeof en)[Key]>, string | number>];
type PluralKey = {
	[Key in TranslationKey]: Key extends `${infer Base}.one`
		? `${Base}.other` extends TranslationKey ? Base : never
		: never
}[TranslationKey];

// Phase one deliberately ships English only. No newer host API is needed,
// so this extraction retains Obsidian 1.7.2 support and existing English copy.
const pluralRules = new Intl.PluralRules("en");

export function t<Key extends TranslationKey>(key: Key, ...args: Arguments<Key>): string {
	return formatMessage(en[key], args[0]);
}

export function tCount(key: PluralKey, count: number): string {
	if (!Number.isSafeInteger(count) || count < 0) throw new Error("Message count must be a non-negative safe integer.");
	const form = pluralRules.select(count) === "one" ? "one" : "other";
	return formatMessage(en[`${key}.${form}`], { count });
}
