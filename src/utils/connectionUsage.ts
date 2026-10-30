/**
 * A usage cycle is one successful BLE connection to the Crafty. It is kept
 * separate from heater sessions, which are recorded from device telemetry.
 */
export interface ConnectionCycle {
  id: string;
  device: string;
  startedAt: number;
  endedAt: number | null;
  /** Last time the app observed this BLE link as active. */
  lastSeenAt?: number;
  /** True when the app had to close a stale cycle after it was reopened. */
  estimatedEnd?: boolean;
}

export const TRACKING_REST_MS = 6 * 60 * 60 * 1000;
export const ESTIMATED_GRAMS_PER_CONNECTION = 0.25;

export const startConnectionCycle = (
  cycles: ConnectionCycle[],
  device: string,
  startedAt: number
): ConnectionCycle[] => {
  // A browser can be terminated without delivering the BLE disconnect event.
  // Close any such record at the next observed connection and mark its end as
  // estimated so the UI does not present it as an exact device power-off time.
  const closed = cycles.map((cycle) => {
    if (cycle.endedAt !== null) return cycle;
    return {
      ...cycle,
      endedAt: Math.min(startedAt, cycle.lastSeenAt ?? cycle.startedAt),
      estimatedEnd: true,
    };
  });
  return [
    ...closed,
    {
      id: crypto.randomUUID(),
      device,
      startedAt,
      endedAt: null,
      lastSeenAt: startedAt,
    },
  ];
};

export const touchLatestConnectionCycle = (
  cycles: ConnectionCycle[],
  seenAt: number
): ConnectionCycle[] => {
  let index = -1;
  for (let cursor = cycles.length - 1; cursor >= 0; cursor--) {
    if (cycles[cursor].endedAt === null) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return cycles;
  return cycles.map((cycle, cycleIndex) =>
    cycleIndex === index ? { ...cycle, lastSeenAt: seenAt } : cycle
  );
};

export const endLatestConnectionCycle = (
  cycles: ConnectionCycle[],
  endedAt: number
): ConnectionCycle[] => {
  let index = -1;
  for (let cursor = cycles.length - 1; cursor >= 0; cursor--) {
    if (cycles[cursor].endedAt === null) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return cycles;
  return cycles.map((cycle, cycleIndex) =>
    cycleIndex === index ? { ...cycle, endedAt } : cycle
  );
};

const csvField = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const connectionCyclesToCsv = (cycles: ConnectionCycle[]) =>
  [
    [
      "start_iso",
      "end_iso",
      "duration_seconds",
      "end_estimated",
      "device",
      "grams_estimated",
    ],
    ...cycles.map((cycle) => [
      new Date(cycle.startedAt).toISOString(),
      cycle.endedAt === null ? "" : new Date(cycle.endedAt).toISOString(),
      cycle.endedAt === null
        ? ""
        : Math.max(0, Math.round((cycle.endedAt - cycle.startedAt) / 1000)),
      cycle.estimatedEnd ? "true" : "false",
      cycle.device,
      ESTIMATED_GRAMS_PER_CONNECTION.toFixed(2),
    ]),
  ]
    .map((row) => row.map(csvField).join(","))
    .join("\n");
