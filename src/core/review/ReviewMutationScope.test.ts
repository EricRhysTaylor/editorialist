import { describe, expect, it } from "vitest";
import { ReviewMutationScope } from "./ReviewMutationScope";

describe("ReviewMutationScope.rollback", () => {
	it("replays compensations last-in first-out and empties itself", async () => {
		const scope = new ReviewMutationScope();
		const order: string[] = [];
		scope.onRollback(() => {
			order.push("first");
		});
		scope.onRollback(async () => {
			order.push("second");
		});

		expect(scope.hasPendingCompensations).toBe(true);
		await expect(scope.rollback()).resolves.toBe(true);
		expect(order).toEqual(["second", "first"]);
		expect(scope.hasPendingCompensations).toBe(false);
	});

	it("keeps unwinding past a throwing compensation and reports the failure", async () => {
		const scope = new ReviewMutationScope();
		const order: string[] = [];
		scope.onRollback(() => {
			order.push("first");
		});
		scope.onRollback(() => {
			throw new Error("inverse failed");
		});
		scope.onRollback(() => {
			order.push("third");
		});

		await expect(scope.rollback()).resolves.toBe(false);
		// The failing inverse sat between the other two and neither was skipped.
		expect(order).toEqual(["third", "first"]);
		expect(scope.hasPendingCompensations).toBe(false);
	});

	it("reports success for an empty scope", async () => {
		await expect(new ReviewMutationScope().rollback()).resolves.toBe(true);
	});
});
