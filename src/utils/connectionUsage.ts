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

/** A counted usage session, based on observed temperature rather than BLE link time. */
export interface ConsumptionSession {
  id: string;
  device: string;
  /** First observed moment above the temperature threshold. */
  startedAt: number;
  /** Moment at which the minimum hot-time was confirmed. */
  qualifiedAt: number;
  endedAt: number | null;
  /** Most recent temperature observation while the session was hot. */
  lastSeenAt: number;
  /** True when the app had to recover an open record after it was closed. */
  estimatedEnd?: boolean;
}

export type DailyConsumptionResets = Record<string, number>;

export const TRACKING_REST_MS = 8 * 60 * 60 * 1000;
export const SESSION_TEMP_THRESHOLD_C = 170;
export const SESSION_MIN_HOT_MS = 3 * 60 * 1000;
export const SESSION_COOLING_GRACE_MS = 90 * 1000;
export const ESTIMATED_GRAMS_PER_SESSION = 0.25;

export const localDayKey = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const countConsumptionSessionsBetween = (
  sessions: ConsumptionSession[],
  startInclusive: number,
  endExclusive: number,
  dailyResets: DailyConsumptionResets = {}
) =>
  sessions.filter((session) => {
    const dayReset = dailyResets[localDayKey(session.qualifiedAt)];
    return (
      session.qualifiedAt >= startInclusive &&
      session.qualifiedAt < endExclusive &&
      (dayReset === undefined || session.qualifiedAt >= dayReset)
    );
  }).length;

export const startConsumptionSession = (
  sessions: ConsumptionSession[],
  id: string,
  device: string,
  startedAt: number,
  qualifiedAt: number
): ConsumptionSession[] => {
  const closed = closeOpenConsumptionSessions(sessions, startedAt);
  return [
    ...closed,
    {
      id,
      device,
      startedAt,
      qualifiedAt,
      endedAt: null,
      lastSeenAt: qualifiedAt,
    },
  ];
};

export const touchConsumptionSession = (
  sessions: ConsumptionSession[],
  id: string,
  seenAt: number
) =>
  sessions.map((session) =>
    session.id === id && session.endedAt === null
      ? { ...session, lastSeenAt: seenAt }
      : session
  );

export const endConsumptionSession = (
  sessions: ConsumptionSession[],
  id: string,
  endedAt: number
) =>
  sessions.map((session) =>
    session.id === id && session.endedAt === null
      ? { ...session, endedAt }
      : session
  );

export const closeOpenConsumptionSessions = (
  sessions: ConsumptionSession[],
  recoveredAt: number
) =>
  sessions.map((session) => {
    if (session.endedAt !== null) return session;
    return {
      ...session,
      endedAt: Math.min(recoveredAt, session.lastSeenAt),
      estimatedEnd: true,
    };
  });

export const consumptionSessionsToCsv = (sessions: ConsumptionSession[]) =>
  [
    [
      "start_iso",
      "qualified_iso",
      "end_iso",
      "time_above_170_seconds",
      "end_estimated",
      "device",
      "grams_estimated",
    ],
    ...sessions.map((session) => [
      new Date(session.startedAt).toISOString(),
      new Date(session.qualifiedAt).toISOString(),
      session.endedAt === null ? "" : new Date(session.endedAt).toISOString(),
      session.endedAt === null
        ? ""
        : Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000)),
      session.estimatedEnd ? "true" : "false",
      session.device,
      ESTIMATED_GRAMS_PER_SESSION.toFixed(2),
    ]),
  ]
    .map((row) => row.map(csvField).join(","))
    .join("\n");

export const dailyConsumptionReset = (
  resets: DailyConsumptionResets,
  at: number
): DailyConsumptionResets => ({
  ...resets,
  [localDayKey(at)]: at,
});

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
    ["start_iso", "end_iso", "duration_seconds", "end_estimated", "device"],
    ...cycles.map((cycle) => [
      new Date(cycle.startedAt).toISOString(),
      cycle.endedAt === null ? "" : new Date(cycle.endedAt).toISOString(),
      cycle.endedAt === null
        ? ""
        : Math.max(0, Math.round((cycle.endedAt - cycle.startedAt) / 1000)),
      cycle.estimatedEnd ? "true" : "false",
      cycle.device,
    ]),
  ]
    .map((row) => row.map(csvField).join(","))
    .join("\n");
