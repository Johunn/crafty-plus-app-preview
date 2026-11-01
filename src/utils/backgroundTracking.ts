import { createSignal } from "solid-js";
import {
  getNativeBackgroundTracking,
  isNativeAndroidBluetooth,
  setNativeBackgroundTracking,
} from "./androidBluetooth";

const [enabled, setEnabled] = createSignal(true);

export const backgroundTrackingEnabled = enabled;

export const loadBackgroundTrackingPreference = async () => {
  if (!isNativeAndroidBluetooth()) return enabled();
  const value = await getNativeBackgroundTracking();
  setEnabled(value);
  return value;
};

export const updateBackgroundTrackingPreference = async (value: boolean) => {
  if (isNativeAndroidBluetooth()) {
    const saved = await setNativeBackgroundTracking(value);
    setEnabled(saved);
    return saved;
  }
  setEnabled(value);
  return value;
};
