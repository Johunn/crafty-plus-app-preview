import type { Accessor, JSX } from "solid-js";
import { createContext, createSignal, Show, useContext } from "solid-js";
import type { CraftyDriver } from "../devices/crafty/driver";
import { type CraftyStore, createCraftyStore } from "../devices/crafty/store";
import { useBluetooth } from "./BluetoothProvider";

type TemperatureUnit = "C" | "F";
type CraftyContextValue = CraftyStore & {
  temperatureUnit: Accessor<TemperatureUnit>;
  setTemperatureUnit: (unit: TemperatureUnit) => void;
};

const CraftyContext = createContext<CraftyContextValue>();

const readTemperatureUnit = (): TemperatureUnit => {
  try {
    return localStorage.getItem("craftyTemperatureUnit") === "F" ? "F" : "C";
  } catch {
    return "C";
  }
};

const CraftyStoreProvider = (props: {
  driver: CraftyDriver;
  children: JSX.Element;
}) => {
  // Read once on purpose: one store per driver instance
  const { reportStartFailure } = useBluetooth();
  const store = createCraftyStore(props.driver, (error) =>
    reportStartFailure(props.driver, error)
  );
  const [temperatureUnit, setTemperatureUnitState] =
    createSignal<TemperatureUnit>(readTemperatureUnit());
  const setTemperatureUnit = (unit: TemperatureUnit) => {
    setTemperatureUnitState(unit);
    try {
      localStorage.setItem("craftyTemperatureUnit", unit);
    } catch {
      // Unit preference remains available for this connection.
    }
  };
  return (
    <CraftyContext.Provider
      value={{ ...store, temperatureUnit, setTemperatureUnit }}
    >
      {props.children}
    </CraftyContext.Provider>
  );
};

/** Renders its children only while a Crafty is connected */
export const CraftyProvider = (props: { children: JSX.Element }) => {
  const { craftyDriver } = useBluetooth();
  return (
    <Show when={craftyDriver()} keyed>
      {(driver) => (
        <CraftyStoreProvider driver={driver}>
          {props.children}
        </CraftyStoreProvider>
      )}
    </Show>
  );
};

export const useCrafty = () => {
  const context = useContext(CraftyContext);
  if (!context) {
    throw new Error("useCrafty must be used within a CraftyProvider");
  }
  return context;
};
