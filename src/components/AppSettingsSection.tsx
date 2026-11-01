import Download from "lucide-solid/icons/download";
import ExternalLink from "lucide-solid/icons/external-link";
import Upload from "lucide-solid/icons/upload";
import { createSignal, For, onMount, Show } from "solid-js";
import { m } from "../paraglide/messages";
import { useBluetooth } from "../provider/BluetoothProvider";
import {
  EFFECTS_LEVELS,
  type EffectsLevel,
  useEffects,
} from "../provider/EffectsProvider";
import { useToast } from "../provider/ToastProvider";
import {
  getNativeBatteryAlerts,
  isNativeAndroidBluetooth,
  saveNativeBackup,
  setNativeBatteryAlerts,
} from "../utils/androidBluetooth";
import { createAppBackup, restoreAppBackup } from "../utils/appBackup";
import {
  loadBackgroundTrackingPreference,
  updateBackgroundTrackingPreference,
} from "../utils/backgroundTracking";
import {
  getLowBatteryNotifyPreference,
  getLowBatteryNotifyPreferenceSetting,
  getNotifyPreference,
  getSoundPreference,
  isNotificationSupported,
  setLowBatteryNotifyPreference,
  setNotifyPreference,
  setSoundPreference,
  storeLowBatteryNotifyPreference,
} from "../utils/notify";
import { DeviceType } from "../utils/uuids";
import { SettingSwitch, SettingsSection } from "./Settings";
import { Button } from "./ui/button";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const effectsLabels: Record<EffectsLevel, () => string> = {
  off: () => m.settings_effectsOff(),
  subtle: () => m.settings_effectsSubtle(),
  strong: () => m.settings_effectsStrong(),
};

/** Browser-side preferences that apply to every device */
export const AppSettingsSection = () => {
  const showToast = useToast();
  const effects = useEffects();
  const { deviceInfo } = useBluetooth();
  const [notify, setNotify] = createSignal(getNotifyPreference());
  const [notifyLowBattery, setNotifyLowBattery] = createSignal(
    isNativeAndroidBluetooth()
      ? getLowBatteryNotifyPreferenceSetting()
      : getLowBatteryNotifyPreference()
  );
  const [sound, setSound] = createSignal(getSoundPreference());
  const [backgroundTracking, setBackgroundTracking] = createSignal(true);
  const [backgroundTrackingLoaded, setBackgroundTrackingLoaded] =
    createSignal(false);
  let backupInput!: HTMLInputElement;

  onMount(() => {
    if (isNativeAndroidBluetooth()) {
      void getNativeBatteryAlerts()
        .then(setNotifyLowBattery)
        .catch(() => {});
      void loadBackgroundTrackingPreference()
        .then((enabled) => {
          setBackgroundTracking(enabled);
          setBackgroundTrackingLoaded(true);
        })
        .catch(() =>
          showToast({ message: m.settings_backgroundTrackingSaveFailed() })
        );
    }
  });

  const toggleBackgroundTracking = async (enabled: boolean) => {
    try {
      const saved = await updateBackgroundTrackingPreference(enabled);
      setBackgroundTracking(saved);
    } catch (error) {
      console.error("Saving the background tracking preference failed:", error);
      showToast({ message: m.settings_backgroundTrackingSaveFailed() });
    }
  };

  const toggleNotify = async (enabled: boolean) => {
    const effective = await setNotifyPreference(enabled);
    setNotify(effective);
    if (enabled && !effective) {
      showToast({ message: m.settings_notifyBlocked() });
    }
  };

  const toggleLowBatteryNotify = async (enabled: boolean) => {
    if (isNativeAndroidBluetooth()) {
      try {
        const effective = await setNativeBatteryAlerts(enabled);
        setNotifyLowBattery(effective);
        storeLowBatteryNotifyPreference(effective);
        if (enabled && !effective) {
          showToast({ message: m.settings_notifyBlocked() });
        }
      } catch {
        setNotifyLowBattery(false);
        storeLowBatteryNotifyPreference(false);
        showToast({ message: m.settings_notifyBlocked() });
      }
      return;
    }
    const effective = await setLowBatteryNotifyPreference(enabled);
    setNotifyLowBattery(effective);
    if (enabled && !effective) {
      showToast({ message: m.settings_notifyBlocked() });
    }
  };

  const exportBackup = async () => {
    try {
      const json = await createAppBackup();
      if (isNativeAndroidBluetooth()) {
        saveNativeBackup(json);
      } else {
        const url = URL.createObjectURL(
          new Blob([json], { type: "application/json" })
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `crafty-plus-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
      showToast({ message: m.settings_backupExported() });
    } catch (error) {
      console.error("Creating the CRAFTY+ backup failed:", error);
      showToast({ message: m.settings_backupFailed() });
    }
  };

  const importBackup = async (
    event: Event & { currentTarget: HTMLInputElement }
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const restored = await restoreAppBackup(await file.text());
      if (isNativeAndroidBluetooth()) {
        const enabled = await setNativeBatteryAlerts(
          restored.batteryAlertsEnabled
        );
        setNotifyLowBattery(enabled);
        storeLowBatteryNotifyPreference(enabled);
      }
      showToast({
        message: m.settings_backupImported(),
        actionLabel: m.settings_backupReload(),
        onAction: () => window.location.reload(),
        persistent: true,
      });
    } catch (error) {
      console.error("Restoring the CRAFTY+ backup failed:", error);
      showToast({ message: m.settings_backupFailed() });
    }
  };

  return (
    <SettingsSection title={m.settings_sectionApp()}>
      <div class="flex flex-col gap-2.5 px-4 py-3.5">
        <div class="flex flex-col gap-0.5">
          <span id="effects-label" class="font-medium text-sm">
            {m.settings_effects()}
          </span>
          <span class="text-muted-foreground text-xs">
            {m.settings_effectsHint()}
          </span>
        </div>
        <ToggleGroup
          aria-labelledby="effects-label"
          value={effects.level()}
          onChange={(level) => level && effects.setLevel(level as EffectsLevel)}
        >
          <For each={EFFECTS_LEVELS}>
            {(level) => (
              <ToggleGroupItem value={level}>
                {effectsLabels[level]()}
              </ToggleGroupItem>
            )}
          </For>
        </ToggleGroup>
      </div>
      <SettingSwitch
        label={m.settings_notifyReached()}
        description={
          isNotificationSupported()
            ? m.settings_notifyReachedHint()
            : m.settings_notifyUnsupported()
        }
        checked={notify()}
        disabled={!isNotificationSupported()}
        onChange={toggleNotify}
      />
      <Show when={deviceInfo().type === DeviceType.CRAFTY}>
        <SettingSwitch
          label={m.settings_notifyLowBattery()}
          description={
            isNativeAndroidBluetooth()
              ? m.settings_backgroundBatteryHint()
              : isNotificationSupported()
                ? m.settings_notifyLowBatteryHint()
                : m.settings_notifyUnsupported()
          }
          checked={notifyLowBattery()}
          disabled={!isNativeAndroidBluetooth() && !isNotificationSupported()}
          onChange={toggleLowBatteryNotify}
        />
      </Show>
      <SettingSwitch
        label={m.settings_sound()}
        description={m.settings_soundHint()}
        checked={sound()}
        onChange={(enabled) => {
          setSoundPreference(enabled);
          setSound(enabled);
        }}
      />
      <Show when={isNativeAndroidBluetooth()}>
        <SettingSwitch
          label={m.settings_backgroundTrackingTitle()}
          description={m.settings_backgroundTrackingHint()}
          checked={backgroundTracking()}
          disabled={!backgroundTrackingLoaded()}
          onChange={toggleBackgroundTracking}
        />
      </Show>
      <div class="flex flex-col gap-2 border-t px-4 py-3.5">
        <div class="flex flex-col gap-1">
          <span class="font-medium text-sm">{m.settings_backupTitle()}</span>
          <span class="text-muted-foreground text-xs leading-relaxed">
            {m.settings_backupHint()}
          </span>
        </div>
        <div class="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={exportBackup}>
            <Download /> {m.settings_backupExport()}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => backupInput.click()}
          >
            <Upload /> {m.settings_backupImport()}
          </Button>
          <input
            ref={backupInput}
            type="file"
            accept="application/json,.json"
            class="hidden"
            onChange={importBackup}
          />
        </div>
      </div>
      <div class="flex flex-col gap-2 border-t px-4 py-3.5">
        <span class="font-medium text-sm">
          {m.settings_officialResources()}
        </span>
        <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <a
            href="https://app.storz-bickel.com/"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {m.settings_officialWebApp()} <ExternalLink class="size-3" />
          </a>
          <a
            href="https://www.storz-bickel.com/en/downloads"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {m.settings_manuals()} <ExternalLink class="size-3" />
          </a>
          <a
            href="https://www.storz-bickel.com/en/legal/warranty"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {m.settings_warranty()} <ExternalLink class="size-3" />
          </a>
          <a
            href="https://www.storz-bickel.com/en/support/crafty"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {m.settings_craftySupport()} <ExternalLink class="size-3" />
          </a>
        </div>
      </div>
      <div class="border-t px-4 py-3.5">
        <a
          href="https://github.com/Johunn/crafty-plus-app-preview"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {m.settings_sourceCode()} <ExternalLink class="size-3" />
        </a>
      </div>
    </SettingsSection>
  );
};
