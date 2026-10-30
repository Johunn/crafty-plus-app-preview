import { m } from "../paraglide/messages";

/** App preferences for the "target reached" alert, stored per browser */
const NOTIFY_KEY = "notifyTargetReached";
const SOUND_KEY = "soundTargetReached";
const LOW_BATTERY_KEY = "notifyCraftyBatteryLow";
const LOW_BATTERY_LAST_LEVEL_KEY = "craftyBatteryLastNotifiedLevel";
const LOW_BATTERY_THRESHOLD = 20;

const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};

const writeFlag = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable (private mode); the setting is then lost
  }
};

export const isNotificationSupported = () =>
  typeof window !== "undefined" && "Notification" in window;

export const getNotifyPreference = () =>
  readFlag(NOTIFY_KEY) &&
  isNotificationSupported() &&
  Notification.permission === "granted";

/** Asks for permission when switching on; resolves to the effective state */
export const setNotifyPreference = async (enabled: boolean) => {
  if (enabled && isNotificationSupported()) {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    enabled = permission === "granted";
  }
  writeFlag(NOTIFY_KEY, enabled);
  return enabled && isNotificationSupported();
};

export const getLowBatteryNotifyPreference = () =>
  readFlag(LOW_BATTERY_KEY) &&
  isNotificationSupported() &&
  Notification.permission === "granted";

export const getLowBatteryNotifyPreferenceSetting = () =>
  readFlag(LOW_BATTERY_KEY);

export const storeLowBatteryNotifyPreference = (enabled: boolean) =>
  writeFlag(LOW_BATTERY_KEY, enabled);

export const setLowBatteryNotifyPreference = async (enabled: boolean) => {
  if (enabled && isNotificationSupported()) {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    enabled = permission === "granted";
  }
  writeFlag(LOW_BATTERY_KEY, enabled);
  return enabled && isNotificationSupported();
};

export const getSoundPreference = () => readFlag(SOUND_KEY);

let audioContext: AudioContext | undefined;

/** Browsers only allow audio after a user gesture, so unlock it on one */
const unlockAudio = () => {
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
};

export const setSoundPreference = (enabled: boolean) => {
  writeFlag(SOUND_KEY, enabled);
  if (enabled) {
    unlockAudio();
    playChime();
  }
};

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      if (getSoundPreference()) unlockAudio();
    },
    { passive: true }
  );
}

/** Two soft rising tones */
const playChime = () => {
  if (audioContext?.state !== "running") return;
  const start = audioContext.currentTime;
  for (const [index, frequency] of [660, 880].entries()) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const at = start + index * 0.18;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.5);
  }
};

const showNotification = async (
  title: string,
  body: string,
  tag = "target-reached"
) => {
  const options: NotificationOptions = {
    body,
    icon: `${import.meta.env.BASE_URL}pwa-192x192.png`,
    tag,
  };
  // Mobile Chrome only allows notifications through the service worker
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(title, options);
  } else {
    new Notification(title, options);
  }
};

/** Notify once when the Crafty battery crosses the low threshold. */
export const alertCraftyBatteryLow = (level: number) => {
  if (!getLowBatteryNotifyPreference() || !Number.isFinite(level)) return;
  const previousLevel = Number(
    (() => {
      try {
        return localStorage.getItem(LOW_BATTERY_LAST_LEVEL_KEY) ?? "100";
      } catch {
        return "100";
      }
    })()
  );
  try {
    localStorage.setItem(LOW_BATTERY_LAST_LEVEL_KEY, String(level));
  } catch {
    // The notification can still be shown without persisting its threshold.
  }
  if (level > LOW_BATTERY_THRESHOLD || previousLevel <= LOW_BATTERY_THRESHOLD) {
    return;
  }
  showNotification(
    m.notify_lowBatteryTitle(),
    m.notify_lowBatteryBody({ percent: Math.round(level) }),
    "crafty-low-battery"
  ).catch((error) =>
    console.error("Showing the low battery notification failed:", error)
  );
};

/** Chime and/or notification once the target temperature is reached */
export const alertTargetReached = (title: string, body: string) => {
  if (getSoundPreference()) playChime();
  // In the foreground the gauge already shows it
  if (getNotifyPreference() && document.visibilityState === "hidden") {
    showNotification(title, body).catch((error) =>
      console.error("Showing the notification failed:", error)
    );
  }
};
