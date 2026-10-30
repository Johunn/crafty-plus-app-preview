import { type Accessor, createContext, type JSX, useContext } from "solid-js";
import { useIndexedDB } from "../hooks/utils/useIndexedDB";
import {
  closeOpenConsumptionSessions,
  dailyConsumptionReset,
  endLatestConnectionCycle,
  endConsumptionSession,
  type ConnectionCycle,
  type ConsumptionSession,
  type DailyConsumptionResets,
  startConnectionCycle,
  startConsumptionSession,
  touchLatestConnectionCycle,
  touchConsumptionSession,
} from "../utils/connectionUsage";

interface ConnectionUsageContextValue {
  cycles: Accessor<ConnectionCycle[]>;
  sessions: Accessor<ConsumptionSession[]>;
  dailyResets: Accessor<DailyConsumptionResets>;
  start: (device: string, at?: number) => void;
  end: (at?: number) => void;
  touch: (at?: number) => void;
  openSession: () => ConsumptionSession | undefined;
  startSession: (
    device: string,
    startedAt: number,
    qualifiedAt: number
  ) => string;
  endSession: (id: string, at?: number) => void;
  touchSession: (id: string, at?: number) => void;
  recoverOpenSessions: (at?: number) => void;
  resetToday: (at?: number) => void;
}

const ConnectionUsageContext = createContext<ConnectionUsageContextValue>();
const STORAGE_KEY = "craftyConnectionCycles";
const SESSION_STORAGE_KEY = "craftyConsumptionSessions";
const DAILY_RESET_STORAGE_KEY = "craftyDailyConsumptionResets";

export const ConnectionUsageProvider = (props: { children: JSX.Element }) => {
  const [cycles, setCycles] = useIndexedDB<ConnectionCycle[]>(STORAGE_KEY, []);
  const [sessions, setSessions] = useIndexedDB<ConsumptionSession[]>(
    SESSION_STORAGE_KEY,
    []
  );
  const [dailyResets, setDailyResets] = useIndexedDB<DailyConsumptionResets>(
    DAILY_RESET_STORAGE_KEY,
    {}
  );
  const touch = (at = Date.now()) =>
    setCycles((previous) => touchLatestConnectionCycle(previous, at));
  return (
    <ConnectionUsageContext.Provider
      value={{
        cycles,
        sessions,
        dailyResets,
        start: (device, at = Date.now()) =>
          setCycles((previous) => startConnectionCycle(previous, device, at)),
        end: (at = Date.now()) =>
          setCycles((previous) => endLatestConnectionCycle(previous, at)),
        touch,
        openSession: () =>
          [...sessions()].reverse().find((session) => session.endedAt === null),
        startSession: (device, startedAt, qualifiedAt) => {
          const id = crypto.randomUUID();
          setSessions((previous) =>
            startConsumptionSession(
              previous,
              id,
              device,
              startedAt,
              qualifiedAt
            )
          );
          return id;
        },
        endSession: (id, at = Date.now()) =>
          setSessions((previous) => endConsumptionSession(previous, id, at)),
        touchSession: (id, at = Date.now()) =>
          setSessions((previous) => touchConsumptionSession(previous, id, at)),
        recoverOpenSessions: (at = Date.now()) =>
          setSessions((previous) => closeOpenConsumptionSessions(previous, at)),
        resetToday: (at = Date.now()) =>
          setDailyResets((previous) => dailyConsumptionReset(previous, at)),
      }}
    >
      {props.children}
    </ConnectionUsageContext.Provider>
  );
};

export const useConnectionUsage = () => {
  const context = useContext(ConnectionUsageContext);
  if (!context) {
    throw new Error("useConnectionUsage must be used within its provider");
  }
  return context;
};
