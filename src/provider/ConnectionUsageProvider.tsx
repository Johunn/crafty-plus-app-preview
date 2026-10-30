import {
  type Accessor,
  createContext,
  type JSX,
  useContext,
} from "solid-js";
import { useIndexedDB } from "../hooks/utils/useIndexedDB";
import {
  endLatestConnectionCycle,
  type ConnectionCycle,
  startConnectionCycle,
  touchLatestConnectionCycle,
} from "../utils/connectionUsage";

interface ConnectionUsageContextValue {
  cycles: Accessor<ConnectionCycle[]>;
  start: (device: string, at?: number) => void;
  end: (at?: number) => void;
  touch: (at?: number) => void;
}

const ConnectionUsageContext =
  createContext<ConnectionUsageContextValue>();
const STORAGE_KEY = "craftyConnectionCycles";

export const ConnectionUsageProvider = (props: { children: JSX.Element }) => {
  const [cycles, setCycles] = useIndexedDB<ConnectionCycle[]>(STORAGE_KEY, []);
  const touch = (at = Date.now()) =>
    setCycles((previous) => touchLatestConnectionCycle(previous, at));
  return (
    <ConnectionUsageContext.Provider
      value={{
        cycles,
        start: (device, at = Date.now()) =>
          setCycles((previous) => startConnectionCycle(previous, device, at)),
        end: (at = Date.now()) =>
          setCycles((previous) => endLatestConnectionCycle(previous, at)),
        touch,
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
