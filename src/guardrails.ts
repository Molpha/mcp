import { type GuardrailConfig } from "./config.js";

interface DailyCounter {
  day: string;
  count: number;
}

const jobCreates: DailyCounter = { day: "", count: 0 };
const executes: DailyCounter = { day: "", count: 0 };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function bump(counter: DailyCounter, max: number, label: string): void {
  const day = todayKey();
  if (counter.day !== day) {
    counter.day = day;
    counter.count = 0;
  }

  if (counter.count >= max) {
    throw new Error(`${label} cap reached (${max} per day). Adjust MOLPHA_MAX_${label.toUpperCase().replace(/ /g, "_")}_PER_DAY or wait until tomorrow.`);
  }

  counter.count += 1;
}

/** Reset counters — exposed for tests. */
export function resetGuardrailCounters(): void {
  jobCreates.day = "";
  jobCreates.count = 0;
  executes.day = "";
  executes.count = 0;
}

export function enforceJobCreateCap(config: GuardrailConfig): void {
  bump(jobCreates, config.maxJobsPerDay, "job creation");
}

export function enforceExecuteCap(config: GuardrailConfig): void {
  bump(executes, config.maxExecutesPerDay, "execute");
}

export interface WritePreview {
  dryRun: true;
  action: string;
  summary: Record<string, unknown>;
}

export function previewWrite(action: string, summary: Record<string, unknown>): WritePreview {
  return { dryRun: true, action, summary };
}
