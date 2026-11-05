import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { type Component, Show } from "solid-js";
import { AnalysisSection } from "../components/AnalysisSection";
import { AppSettingsSection } from "../components/AppSettingsSection";
import { PageTitle } from "../components/DeviceShell";
import { FactoryReset } from "../components/FactoryReset";
import {
  InfoRow,
  SettingRow,
  SettingSlider,
  SettingSwitch,
  SettingsSection,
} from "../components/Settings";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Limits } from "../devices/crafty/protocol";
import { m } from "../paraglide/messages";
import { useCrafty } from "../provider/CraftyProvider";
import { useToast } from "../provider/ToastProvider";
import { formatDuration } from "../utils/heatProgress";

export const CraftySettingsView: Component = () => {
  const showToast = useToast();
  const {
    state,
    actions,
    derived,
    firmwareVersion,
    isOldFirmware,
    temperatureUnit,
    setTemperatureUnit,
  } = useCrafty();

  const saveDeviceSetting = (action: () => Promise<void>) => {
    void action().catch(() =>
      showToast({ message: m.settings_deviceSettingSaveFailed() })
    );
  };

  return (
    <>
      <PageTitle>{m.settings_title()}</PageTitle>

      <Show when={isOldFirmware}>
        <Alert variant="accent">
          <TriangleAlert />
          <AlertDescription>{m.crafty_oldDetected()}</AlertDescription>
        </Alert>
      </Show>

      <SettingsSection title={m.settings_sectionDevice()}>
        <SettingRow
          label={m.settings_temperatureUnit()}
          description={m.settings_temperatureUnitHint()}
        >
          <ToggleGroup
            aria-label={m.settings_temperatureUnit()}
            value={temperatureUnit()}
            onChange={(unit) => unit && setTemperatureUnit(unit as "C" | "F")}
          >
            <ToggleGroupItem value="C" aria-label={m.settings_celsius()}>
              °C
            </ToggleGroupItem>
            <ToggleGroupItem value="F" aria-label={m.settings_fahrenheit()}>
              °F
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
        <Show when={state.loaded}>
          <SettingSlider
            label={m.settings_deviceBrightness()}
            valueLabel={`${state.ledBrightness} %`}
            value={state.ledBrightness}
            min={Limits.MIN_BRIGHTNESS}
            max={Limits.MAX_BRIGHTNESS}
            step={10}
            onChange={actions.setLedBrightness}
          />
          {/* Auto shutdown - only on Crafty+ */}
          <Show when={!isOldFirmware}>
            <SettingSlider
              label={m.settings_autoShutdownTime()}
              valueLabel={
                state.autoOffCountdown === null
                  ? "-"
                  : formatDuration(state.autoOffCountdown)
              }
              value={state.autoOffCountdown ?? Limits.MIN_AUTO_OFF}
              min={Limits.MIN_AUTO_OFF}
              max={Limits.MAX_AUTO_OFF}
              step={30}
              onChange={actions.setAutoOffCountdown}
            />
          </Show>
        </Show>
      </SettingsSection>

      <Show when={!state.loaded}>
        <div class="rounded-card border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {m.settings_waitingDeviceRead()}
        </div>
      </Show>

      <Show when={state.loaded}>
        <SettingsSection title={m.settings_sectionBehavior()}>
          <Show
            when={state.statusRegister2Verified}
            fallback={
              <SettingRow label={m.settings_deviceSettingsUnconfirmed()}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.statusRegister2Pending}
                  onClick={() =>
                    saveDeviceSetting(actions.refreshStatusRegister2)
                  }
                >
                  {m.connect_retry()}
                </Button>
              </SettingRow>
            }
          >
            <SettingSwitch
              label={m.settings_vibration()}
              description={m.settings_enableVibration()}
              checked={derived.isVibrationOn()}
              disabled={state.statusRegister2Pending}
              onChange={(enabled) =>
                saveDeviceSetting(() => actions.setVibration(enabled))
              }
            />
            <SettingSwitch
              label={m.settings_chargeIndicatorLamp()}
              description={m.settings_enableChargeLed()}
              checked={derived.isChargeLedOn()}
              disabled={state.statusRegister2Pending}
              onChange={(enabled) =>
                saveDeviceSetting(() => actions.setChargeLed(enabled))
              }
            />
            {/* Permanent Bluetooth - not on old firmware */}
            <Show when={!isOldFirmware}>
              <SettingSwitch
                label={m.settings_permanentBluetooth()}
                description={m.settings_keepBluetoothAlwaysOn()}
                checked={derived.isPermanentBluetooth()}
                disabled={state.statusRegister2Pending}
                onChange={(enabled) =>
                  saveDeviceSetting(() =>
                    actions.setPermanentBluetooth(enabled)
                  )
                }
              />
            </Show>
          </Show>
        </SettingsSection>

        <AppSettingsSection />

        <SettingsSection title={m.device_info()}>
          <InfoRow label={m.device_battery()}>{state.batteryLevel} %</InfoRow>
          <InfoRow label={m.crafty_usageTime()}>
            {state.useHours} h
            {!isOldFirmware && ` ${state.useMinutes ?? 0} min`}
          </InfoRow>
          <Show when={!isOldFirmware}>
            <InfoRow label={m.crafty_autoOffRemaining()}>
              {formatDuration(state.autoOffRemaining ?? 0)}
            </InfoRow>
          </Show>
          <InfoRow label={m.device_firmware()}>{firmwareVersion}</InfoRow>
          <Show when={!isOldFirmware}>
            <InfoRow label={m.crafty_bleFirmware()}>
              {state.bleFirmwareVersion ?? "-"}
            </InfoRow>
          </Show>
          <InfoRow label={m.crafty_statusRegister2()}>
            {state.statusRegister2}
          </InfoRow>
          {/* System status - only on Crafty+ */}
          <Show when={!isOldFirmware}>
            <InfoRow label={m.crafty_systemStatus()}>
              {state.systemStatus ?? "-"}
            </InfoRow>
            <InfoRow label={m.crafty_batteryStatus({ number: 1 })}>
              {state.akkuStatus ?? "-"}
            </InfoRow>
            <InfoRow label={m.crafty_batteryStatus({ number: 2 })}>
              {state.akkuStatus2 ?? "-"}
            </InfoRow>
          </Show>
        </SettingsSection>

        {/* Analysis and factory reset - not on old firmware */}
        <Show when={!isOldFirmware}>
          <SettingsSection title={m.settings_sectionInfo()}>
            <AnalysisSection run={actions.runAnalysis} />
          </SettingsSection>
          <SettingsSection title={m.settings_sectionDanger()}>
            <FactoryReset onReset={actions.factoryReset} />
          </SettingsSection>
        </Show>
      </Show>
    </>
  );
};
