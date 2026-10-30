import type { ConnectionCycle, ConsumptionSession } from "./connectionUsage";

interface AndroidBleBridge {
  postMessage: (message: string) => void;
  saveBackup?: (json: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface NativeResponse {
  kind: "response";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  name?: string;
}

interface NativeNotification {
  kind: "notification";
  serviceUuid: string;
  characteristicUuid: string;
  value: number[];
}

interface NativeConnection {
  kind: "connection";
  state: "connected" | "disconnected" | "stopped";
  deviceId?: string;
}

interface BackgroundSnapshot {
  cycles: ConnectionCycle[];
  sessions: ConsumptionSession[];
}

declare global {
  interface Window {
    CraftyAndroidBle?: AndroidBleBridge;
    __craftyAndroidBleEvent?: (event: string) => void;
    __craftyAndroidNative?: boolean;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const normalizeUuid = (uuid: string) => uuid.toLowerCase();

const toDataView = (bytes: number[]) => {
  const copy = Uint8Array.from(bytes);
  return new DataView(copy.buffer);
};

const toByteArray = (value: BufferSource) => {
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  const view = value as ArrayBufferView;
  return Array.from(
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  );
};

class NativeBluetoothCharacteristic extends EventTarget {
  value: DataView | null = null;
  readonly uuid: string;

  constructor(
    private readonly bluetooth: NativeBluetooth,
    readonly serviceUuid: string,
    characteristicUuid: string
  ) {
    super();
    this.uuid = normalizeUuid(characteristicUuid);
  }

  async readValue() {
    const bytes = (await this.bluetooth.request<number[]>({
      action: "read",
      serviceUuid: this.serviceUuid,
      characteristicUuid: this.uuid,
    })) as number[];
    this.value = toDataView(bytes);
    return this.value;
  }

  async writeValue(value: BufferSource) {
    await this.bluetooth.request({
      action: "write",
      serviceUuid: this.serviceUuid,
      characteristicUuid: this.uuid,
      value: toByteArray(value),
    });
  }

  async startNotifications() {
    await this.bluetooth.request({
      action: "notifyStart",
      serviceUuid: this.serviceUuid,
      characteristicUuid: this.uuid,
    });
    return this;
  }

  async stopNotifications() {
    // The Android service owns these subscriptions for background tracking.
    // A view being disposed must not turn off temperature or battery updates.
    return this;
  }

  receive(bytes: number[]) {
    this.value = toDataView(bytes);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

class NativeBluetoothService {
  readonly uuid: string;

  constructor(
    private readonly bluetooth: NativeBluetooth,
    serviceUuid: string
  ) {
    this.uuid = normalizeUuid(serviceUuid);
  }

  async getCharacteristic(characteristicUuid: string) {
    const exists = await this.bluetooth.request<boolean>({
      action: "hasCharacteristic",
      serviceUuid: this.uuid,
      characteristicUuid: normalizeUuid(characteristicUuid),
    });
    if (!exists) {
      throw new DOMException(
        `Characteristic ${characteristicUuid} not found`,
        "NotFoundError"
      );
    }
    return this.bluetooth.characteristic(this.uuid, characteristicUuid);
  }
}

class NativeBluetoothGattServer {
  connected = false;

  constructor(
    private readonly bluetooth: NativeBluetooth,
    private readonly device: NativeBluetoothDevice
  ) {}

  async connect() {
    await this.bluetooth.request({
      action: "connect",
      deviceId: this.device.id,
    });
    this.connected = true;
    return this;
  }

  disconnect() {
    this.connected = false;
    void this.bluetooth.request({ action: "disconnect" }).catch(() => {});
  }

  async getPrimaryService(serviceUuid: string) {
    const uuid = normalizeUuid(serviceUuid);
    const exists = await this.bluetooth.request<boolean>({
      action: "hasService",
      serviceUuid: uuid,
    });
    if (!exists) {
      throw new DOMException(
        `Service ${serviceUuid} not found`,
        "NotFoundError"
      );
    }
    return new NativeBluetoothService(this.bluetooth, uuid);
  }
}

class NativeBluetoothDevice extends EventTarget {
  readonly gatt: NativeBluetoothGattServer;

  constructor(
    bluetooth: NativeBluetooth,
    readonly id: string,
    readonly name: string
  ) {
    super();
    this.gatt = new NativeBluetoothGattServer(bluetooth, this);
  }

  disconnected(reason: "lost" | "stopped") {
    this.gatt.connected = false;
    this.dispatchEvent(
      new CustomEvent("gattserverdisconnected", { detail: { reason } })
    );
  }
}

class NativeBluetooth extends EventTarget {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly devices = new Map<string, NativeBluetoothDevice>();
  private readonly characteristics = new Map<
    string,
    NativeBluetoothCharacteristic
  >();

  constructor(private readonly bridge: AndroidBleBridge) {
    super();
  }

  request<T = unknown>(
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new DOMException("Bluetooth request timed out", "TimeoutError"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        this.bridge.postMessage(JSON.stringify({ ...payload, id }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async requestDevice(_options: RequestDeviceOptions) {
    const result = (await this.request<{ id: string; name: string }>(
      { action: "scan" },
      20_000
    )) as { id: string; name: string };
    return this.device(result.id, result.name);
  }

  async getDevices() {
    const result = (await this.request<{
      devices: Array<{ id: string; name: string }>;
    }>({ action: "getDevices" })) as {
      devices: Array<{ id: string; name: string }>;
    };
    return result.devices.map((device) => this.device(device.id, device.name));
  }

  characteristic(serviceUuid: string, characteristicUuid: string) {
    const key = `${normalizeUuid(serviceUuid)}:${normalizeUuid(characteristicUuid)}`;
    let characteristic = this.characteristics.get(key);
    if (!characteristic) {
      characteristic = new NativeBluetoothCharacteristic(
        this,
        serviceUuid,
        characteristicUuid
      );
      this.characteristics.set(key, characteristic);
    }
    return characteristic;
  }

  handleRawEvent(raw: string) {
    let event: NativeResponse | NativeNotification | NativeConnection;
    try {
      event = JSON.parse(raw) as
        | NativeResponse
        | NativeNotification
        | NativeConnection;
    } catch {
      return;
    }

    if (event.kind === "response") {
      const pending = this.pending.get(event.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(event.id);
      if (event.ok) pending.resolve(event.value);
      else
        pending.reject(
          new DOMException(
            event.error ?? "Bluetooth failed",
            event.name ?? "NetworkError"
          )
        );
      return;
    }
    if (event.kind === "notification") {
      this.characteristics
        .get(
          `${normalizeUuid(event.serviceUuid)}:${normalizeUuid(event.characteristicUuid)}`
        )
        ?.receive(event.value);
      return;
    }
    if (event.kind === "connection") {
      const device = event.deviceId
        ? this.devices.get(event.deviceId)
        : undefined;
      if (event.state === "connected") {
        if (device) device.gatt.connected = true;
        window.dispatchEvent(
          new CustomEvent(NATIVE_RECONNECTED_EVENT, {
            detail: { deviceId: event.deviceId },
          })
        );
      } else {
        device?.disconnected(event.state === "stopped" ? "stopped" : "lost");
      }
    }
  }

  snapshot() {
    return this.request<BackgroundSnapshot>({ action: "snapshot" });
  }

  getBatteryAlerts() {
    return this.request<boolean>({ action: "getBatteryAlerts" });
  }

  setBatteryAlerts(enabled: boolean) {
    return this.request<boolean>({ action: "setBatteryAlerts", enabled });
  }

  saveBackup(json: string) {
    this.bridge.saveBackup?.(json);
  }

  private device(id: string, name: string) {
    let device = this.devices.get(id);
    if (!device) {
      device = new NativeBluetoothDevice(this, id, name);
      this.devices.set(id, device);
    }
    return device;
  }
}

let nativeBluetooth: NativeBluetooth | undefined;

export const installAndroidBluetoothShim = () => {
  const bridge = window.CraftyAndroidBle;
  if (!bridge) return false;
  nativeBluetooth = new NativeBluetooth(bridge);
  window.__craftyAndroidNative = true;
  window.__craftyAndroidBleEvent = (event) =>
    nativeBluetooth?.handleRawEvent(event);
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    value: nativeBluetooth,
  });
  return true;
};

export const isNativeAndroidBluetooth = () =>
  Boolean(window.__craftyAndroidNative);

export const getNativeBackgroundSnapshot = () =>
  nativeBluetooth?.snapshot() ?? Promise.resolve({ cycles: [], sessions: [] });

export const saveNativeBackup = (json: string) =>
  nativeBluetooth?.saveBackup(json);

export const getNativeBatteryAlerts = () =>
  nativeBluetooth?.getBatteryAlerts() ?? Promise.resolve(false);

export const setNativeBatteryAlerts = (enabled: boolean) =>
  nativeBluetooth?.setBatteryAlerts(enabled) ?? Promise.resolve(false);

export const NATIVE_RESUME_EVENT = "crafty-android-resume";
export const NATIVE_RECONNECTED_EVENT = "crafty-android-reconnected";
