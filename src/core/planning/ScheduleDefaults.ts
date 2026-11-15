export type SchedulePreset = "developmental" | "copy" | "mixed";
export type WorkPhase = "structure" | "rewrite" | "polish";
/** Which work has first call on the time when goals and an editor's work want the same days. */
export type Balance = "deliverables" | "split" | "goals";
export interface ScheduleDefaults {
	preset: SchedulePreset; sessionMinutes: number; useEstimates: boolean;
	/** The author's last choice in Fill my days, kept on the goals' plan. */
	balance?: Balance;
	/** With "split": the minutes kept for goals each day. */
	reserveMinutes?: number;
}
export const DEFAULT_SCHEDULE: ScheduleDefaults = { preset: "mixed", sessionMinutes: 60, useEstimates: true };
