import { onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type { AnalysisResult } from "../shared/analysis";
import { createDebouncedWriter } from "../shared/debouncedWriter";
import type { CraftyDriver, CraftyUpdate, CraftyValues } from "./driver";
import {
  analyzeCrafty,
  clamp,
  hasBit,
  isHeaterActive,
  isPermanentBluetoothEnabled,
  isSetpointReached,
  Limits,
  ProjectRegisterBit,
  StatusRegister2Bit,
} from "./protocol";

// Sliders and +/- buttons fire many changes; only the last one is written.
// Values held by the writer are not overwritten by incoming updates.
const WRITE_DEBOUNCE_MS = 300;
const IGNORE_UPDATES_AFTER_WRITE_MS = 1000;

type DebouncedField =
  | "targetTemp"
  | "boostTemp"
  | "ledBrightness"
  | "autoOffCountdown";

export interface CraftyState extends CraftyValues {
  loaded: boolean;
  statusRegister2Verified: boolean;
  statusRegister2Pending: boolean;
}

/**
 * Reactive state for a connected Crafty. Must be called inside a Solid owner
 * (component/provider); starts the driver and unsubscribes on cleanup.
 */
export const createCraftyStore = (
  driver: CraftyDriver,
  /** Told when the first reads fail, so the app can report it */
  onStartFailed?: (error: unknown) => void
) => {
  const [state, setState] = createStore<CraftyState>({
    loaded: false,
    targetTemp: 0,
    currentTemp: 0,
    boostTemp: 0,
    batteryLevel: 0,
    ledBrightness: 0,
    useHours: 0,
    projectRegister: 0,
    statusRegister2: 0,
    statusRegister2Verified: false,
    statusRegister2Pending: false,
    bleFirmwareVersion: null,
    useMinutes: null,
    autoOffCountdown: null,
    autoOffRemaining: null,
    systemStatus: null,
    akkuStatus: null,
    akkuStatus2: null,
  });

  const writer = createDebouncedWriter<DebouncedField>({
    debounceMs: WRITE_DEBOUNCE_MS,
    holdAfterWriteMs: IGNORE_UPDATES_AFTER_WRITE_MS,
  });

  const handleUpdate = (update: CraftyUpdate) => {
    const next: CraftyUpdate = { ...update };
    for (const field of Object.keys(next) as (keyof CraftyUpdate)[]) {
      if (writer.isHeld(field as DebouncedField)) delete next[field];
    }
    setState({
      ...next,
      ...(next.statusRegister2 !== undefined && {
        statusRegister2Verified: true,
      }),
    });
  };

  // Subscribe before starting so the initial reads arrive
  const unsubscribe = driver.subscribe(handleUpdate);
  driver
    .start()
    .then(() => setState("loaded", true))
    .catch((error) => {
      console.error("Crafty start failed:", error);
      onStartFailed?.(error);
    });

  onCleanup(() => {
    unsubscribe();
    writer.dispose();
  });

  const logError = (action: string) => (error: unknown) =>
    console.error(`Crafty ${action} failed:`, error);

  const confirmStatusRegister2 = async (read: () => Promise<number>) => {
    if (!state.loaded || state.statusRegister2Pending) return;
    setState("statusRegister2Pending", true);
    try {
      const register = await read();
      setState({ statusRegister2: register, statusRegister2Verified: true });
      return register;
    } catch (error) {
      setState("statusRegister2Verified", false);
      throw error;
    } finally {
      setState("statusRegister2Pending", false);
    }
  };

  const setStatusRegister2Bit = async (
    bit: number,
    set: boolean,
    action: string
  ) => {
    try {
      const register = await confirmStatusRegister2(() =>
        driver.setStatusRegister2Bit(bit, set)
      );
      if (register !== undefined && hasBit(register, bit) !== set) {
        throw new Error("The Crafty did not confirm the requested setting");
      }
    } catch (error) {
      logError(action)(error);
      throw error;
    }
  };

  const actions = {
    /** Target temperature in °C */
    setTargetTemp(celsius: number) {
      const value = clamp(celsius, Limits.MIN_TEMP, Limits.MAX_TEMP);
      setState("targetTemp", value);
      writer.schedule("targetTemp", () => driver.setTargetTemperature(value));
    },
    /** Boost offset in °C; target + boost must not exceed the maximum */
    setBoostTemp(celsius: number) {
      const value = clamp(
        celsius,
        Limits.MIN_BOOST,
        Math.min(Limits.MAX_BOOST, Limits.MAX_TEMP - state.targetTemp)
      );
      setState("boostTemp", value);
      writer.schedule("boostTemp", () => driver.setBoostTemperature(value));
    },
    setLedBrightness(value: number) {
      const brightness = clamp(
        value,
        Limits.MIN_BRIGHTNESS,
        Limits.MAX_BRIGHTNESS
      );
      setState("ledBrightness", brightness);
      writer.schedule("ledBrightness", () =>
        driver.setLedBrightness(brightness)
      );
    },
    setAutoOffCountdown(seconds: number) {
      const value = clamp(seconds, Limits.MIN_AUTO_OFF, Limits.MAX_AUTO_OFF);
      setState("autoOffCountdown", value);
      writer.schedule("autoOffCountdown", () =>
        driver.setAutoOffCountdown(value)
      );
    },
    toggleHeater() {
      const turnOn = !isHeaterActive(state.projectRegister);
      // Show the new state right away; the project register notification
      // confirms it
      setState(
        "projectRegister",
        (register) => register ^ ProjectRegisterBit.HEATER_ACTIVE
      );
      const command = turnOn ? driver.heaterOn() : driver.heaterOff();
      return command.catch(logError("heater toggle"));
    },
    factoryReset() {
      return driver.factoryReset().catch(logError("factory reset"));
    },
    setVibration(enabled: boolean) {
      return setStatusRegister2Bit(
        StatusRegister2Bit.DISABLE_VIBRATION,
        !enabled,
        "vibration"
      );
    },
    setChargeLed(enabled: boolean) {
      return setStatusRegister2Bit(
        StatusRegister2Bit.DISABLE_CHARGE_LED,
        !enabled,
        "charge LED"
      );
    },
    setPermanentBluetooth(enabled: boolean) {
      return setStatusRegister2Bit(
        StatusRegister2Bit.PERMANENT_BLUETOOTH,
        enabled,
        "permanent bluetooth"
      );
    },
    async refreshStatusRegister2() {
      await confirmStatusRegister2(driver.readStatusRegister2);
    },
    /** Reads the registers and runs the self-check (not on old firmware) */
    async runAnalysis(): Promise<AnalysisResult> {
      await driver.readDiagnostics();
      return analyzeCrafty({
        projectRegister: state.projectRegister,
        statusRegister2: state.statusRegister2,
        akkuStatus: state.akkuStatus ?? 0,
        akkuStatus2: state.akkuStatus2 ?? 0,
        systemStatus: state.systemStatus ?? 0,
        ledBrightness: state.ledBrightness,
        serialNumber: driver.serialNumber,
        now: new Date(),
      });
    },
    /** Lets the device beep and blink; it stops by itself after ~30 s */
    findMyDevice() {
      if (derived.isFindMyActive()) return Promise.resolve();
      return setStatusRegister2Bit(
        StatusRegister2Bit.FIND_DEVICE,
        true,
        "find my device"
      );
    },
  };

  const derived = {
    isHeaterActive: () => isHeaterActive(state.projectRegister),
    isBoostActive: () =>
      hasBit(state.projectRegister, ProjectRegisterBit.BOOST_MODE),
    isSuperBoostActive: () =>
      hasBit(state.projectRegister, ProjectRegisterBit.SUPERBOOST_MODE),
    effectiveTargetTemp: () => {
      const baseTemperature = state.targetTemp;
      if (hasBit(state.projectRegister, ProjectRegisterBit.SUPERBOOST_MODE)) {
        return clamp(
          baseTemperature + state.boostTemp + 15,
          Limits.MIN_TEMP,
          Limits.MAX_TEMP
        );
      }
      if (hasBit(state.projectRegister, ProjectRegisterBit.BOOST_MODE)) {
        return clamp(
          baseTemperature + state.boostTemp,
          Limits.MIN_TEMP,
          Limits.MAX_TEMP
        );
      }
      return baseTemperature;
    },
    isSetpointReached: () => isSetpointReached(state.statusRegister2),
    isVibrationOn: () =>
      !hasBit(state.statusRegister2, StatusRegister2Bit.DISABLE_VIBRATION),
    isChargeLedOn: () =>
      !hasBit(state.statusRegister2, StatusRegister2Bit.DISABLE_CHARGE_LED),
    isPermanentBluetooth: () =>
      isPermanentBluetoothEnabled(state.statusRegister2),
    isFindMyActive: () =>
      hasBit(state.statusRegister2, StatusRegister2Bit.FIND_DEVICE),
  };

  return {
    state,
    actions,
    derived,
    firmwareVersion: driver.firmwareVersion,
    isOldFirmware: driver.isOldFirmware,
    isCraftyPlus: driver.isCraftyPlus,
  };
};

export type CraftyStore = ReturnType<typeof createCraftyStore>;
