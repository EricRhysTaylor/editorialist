export type SchedulePreset = "developmental" | "copy" | "mixed";
export type WorkPhase = "structure" | "rewrite" | "polish";
export interface ScheduleDefaults { preset: SchedulePreset; sessionMinutes: number; useEstimates: boolean }
export const DEFAULT_SCHEDULE: ScheduleDefaults = { preset: "mixed", sessionMinutes: 60, useEstimates: true };
