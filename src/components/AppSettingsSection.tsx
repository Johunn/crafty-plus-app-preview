import { createSignal, For, Show } from "solid-js";
import ExternalLink from "lucide-solid/icons/external-link";
import { m } from "../paraglide/messages";
import { useBluetooth } from "../provider/BluetoothProvider";
import {
  EFFECTS_LEVELS,
  type EffectsLevel,
  useEffects,
} from "../provider/EffectsProvider";
import { useToast } from "../provider/ToastProvider";
import {
  getNotifyPreference,
  getLowBatteryNotifyPreference,
  getSoundPreference,
  isNotificationSupported,
  setLowBatteryNotifyPreference,
  setNotifyPreference,
  setSoundPreference,
} from "../utils/notify";
import { DeviceType } from "../utils/uuids";
import { SettingSwitch, SettingsSection } from "./Settings";
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
    getLowBatteryNotifyPreference()
  );
  const [sound, setSound] = createSignal(getSoundPreference());

  const toggleNotify = async (enabled: boolean) => {
    const effective = await setNotifyPreference(enabled);
    setNotify(effective);
    if (enabled && !effective) {
      showToast({ message: m.settings_notifyBlocked() });
    }
  };

  const toggleLowBatteryNotify = async (enabled: boolean) => {
    const effective = await setLowBatteryNotifyPreference(enabled);
    setNotifyLowBattery(effective);
    if (enabled && !effective) {
      showToast({ message: m.settings_notifyBlocked() });
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
            isNotificationSupported()
              ? m.settings_notifyLowBatteryHint()
              : m.settings_notifyUnsupported()
          }
          checked={notifyLowBattery()}
          disabled={!isNotificationSupported()}
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
      <div class="flex flex-col gap-2 border-t px-4 py-3.5">
        <span class="font-medium text-sm">{m.settings_officialResources()}</span>
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
