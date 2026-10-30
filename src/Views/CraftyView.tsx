import { A, type RouteSectionProps, useNavigate } from "@solidjs/router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Activity from "lucide-solid/icons/activity";
import MapPin from "lucide-solid/icons/map-pin";
import History from "lucide-solid/icons/rotate-ccw-clock";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Thermometer from "lucide-solid/icons/thermometer";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { BatteryChip } from "../components/BatteryChip";
import { ShutdownTime } from "../components/crafty/ShutdownTime";
import { Temperature } from "../components/crafty/Temperature";
import { DeviceShell } from "../components/DeviceShell";
import { m } from "../paraglide/messages";
import { useBluetooth } from "../provider/BluetoothProvider";
import { CraftyProvider, useCrafty } from "../provider/CraftyProvider";
import { useConnectionUsage } from "../provider/ConnectionUsageProvider";
import { LiveSessionProvider } from "../provider/LiveSessionProvider";
import { buildRoute } from "../routes";
import { ConnectionState } from "../utils/uuids";
import {
  countConsumptionSessionsBetween,
  ESTIMATED_GRAMS_PER_SESSION,
  SESSION_COOLING_GRACE_MS,
  SESSION_MIN_HOT_MS,
  SESSION_TEMP_THRESHOLD_C,
} from "../utils/connectionUsage";
import { isPlausibleTemp } from "../utils/sessionHistory";
import { getLocale } from "../paraglide/runtime";
import { alertCraftyBatteryLow } from "../utils/notify";

export const CraftyView: Component = () => {
  const { actions, derived, isCraftyPlus } = useCrafty();

  // Keep the screen on while the device heats

  return (
    <>
      <CraftyConsumptionSummary />
      <ShutdownTime />
      <Temperature />
      {/* Find My Device - only Crafty+ */}
      <Show when={isCraftyPlus}>
        <button
          type="button"
          disabled={derived.isFindMyActive()}
          onClick={actions.findMyDevice}
          class="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:opacity-60"
        >
          <MapPin class="size-[18px] text-muted-foreground" />
          <span class="flex flex-1 flex-col gap-0.5">
            <span class="font-medium text-sm">{m.settings_findMyDevice()}</span>
            <Show when={derived.isFindMyActive()}>
              <span class="text-primary text-xs">
                {m.settings_findMyDeviceRunning()}
              </span>
            </Show>
          </span>
          <ChevronRight class="size-4 text-muted-foreground" />
        </button>
      </Show>
    </>
  );
};

const CraftyConsumptionSummary = () => {
  const usage = useConnectionUsage();
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(timer));

  const today = createMemo(() => {
    const start = new Date(now());
    start.setHours(0, 0, 0, 0);
    return countConsumptionSessionsBetween(
      usage.sessions(),
      start.getTime(),
      now(),
      usage.dailyResets()
    );
  });
  const week = createMemo(() => {
    const end = new Date(now());
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return countConsumptionSessionsBetween(
      usage.sessions(),
      start.getTime(),
      now(),
      usage.dailyResets()
    );
  });
  const formatGrams = (count: number) =>
    new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(count * ESTIMATED_GRAMS_PER_SESSION);

  return (
    <A
      href={buildRoute.usage()}
      class="rounded-card border bg-card p-3.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      aria-label={m.connect_openUsage()}
    >
      <div class="flex items-center gap-2">
        <Activity class="size-4 shrink-0 text-primary" />
        <h2 class="flex-1 font-semibold text-sm">{m.usage_title()}</h2>
        <ArrowRight class="size-4 text-muted-foreground" />
      </div>
      <div class="mt-2.5 grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-0.5">
          <span class="text-muted-foreground text-[11px]">
            {m.usage_summaryToday()}
          </span>
          <span class="font-semibold text-lg tabular-nums">
            {formatGrams(today())} <span class="font-normal text-sm">g</span>
          </span>
          <span class="text-muted-foreground text-[11px]">
            {m.usage_summaryConnections({ count: today() })}
          </span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-muted-foreground text-[11px]">
            {m.usage_summaryWeek()}
          </span>
          <span class="font-semibold text-lg tabular-nums">
            {formatGrams(week())} <span class="font-normal text-sm">g</span>
          </span>
          <span class="text-muted-foreground text-[11px]">
            {m.usage_summaryConnections({ count: week() })}
          </span>
        </div>
      </div>
    </A>
  );
};

const CraftyBattery = () => {
  const { state } = useCrafty();
  createEffect(() => {
    if (state.loaded) alertCraftyBatteryLow(state.batteryLevel);
  });
  return <BatteryChip level={state.loaded ? state.batteryLevel : undefined} />;
};

const CraftyLiveSession = (props: { children: JSX.Element }) => {
  const { state, derived } = useCrafty();
  return (
    <>
      <CraftyConsumptionTracker />
      <LiveSessionProvider
        reading={() => ({
          current: state.currentTemp,
          target: state.targetTemp,
          heating: derived.isHeaterActive(),
          reached: derived.isHeaterActive() && derived.isSetpointReached(),
          ready: state.loaded,
        })}
      >
        {props.children}
      </LiveSessionProvider>
    </>
  );
};

/** Confirms one consumption session after three continuous hot minutes. */
const CraftyConsumptionTracker = () => {
  const { state } = useCrafty();
  const usage = useConnectionUsage();
  let initialized = false;
  let candidateStartedAt: number | undefined;
  let candidateTimer: ReturnType<typeof setTimeout> | undefined;
  let activeSessionId: string | undefined;
  let coolingTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    if (!state.loaded) return;
    const temperature = state.currentTemp;
    const hot =
      isPlausibleTemp(temperature) && temperature > SESSION_TEMP_THRESHOLD_C;

    if (!initialized) {
      initialized = true;
      const openSession = untrack(() => usage.openSession());
      if (openSession && hot) {
        activeSessionId = openSession.id;
        usage.touchSession(openSession.id, Date.now());
        return;
      }
      if (openSession) usage.recoverOpenSessions(Date.now());
    }

    if (hot) {
      if (coolingTimer !== undefined) {
        clearTimeout(coolingTimer);
        coolingTimer = undefined;
      }
      if (activeSessionId) {
        usage.touchSession(activeSessionId, Date.now());
        return;
      }
      if (candidateTimer === undefined) {
        const startedAt = Date.now();
        candidateStartedAt = startedAt;
        candidateTimer = setTimeout(() => {
          candidateTimer = undefined;
          if (candidateStartedAt !== startedAt) return;
          const latestTemperature = untrack(() => state.currentTemp);
          if (
            !isPlausibleTemp(latestTemperature) ||
            latestTemperature <= SESSION_TEMP_THRESHOLD_C
          ) {
            candidateStartedAt = undefined;
            return;
          }
          const qualifiedAt = Date.now();
          activeSessionId = usage.startSession(
            "CRAFTY+",
            startedAt,
            qualifiedAt
          );
          usage.touchSession(activeSessionId, qualifiedAt);
        }, SESSION_MIN_HOT_MS);
      }
      return;
    }

    if (candidateTimer !== undefined) {
      clearTimeout(candidateTimer);
      candidateTimer = undefined;
      candidateStartedAt = undefined;
    }
    if (activeSessionId && coolingTimer === undefined) {
      const sessionId = activeSessionId;
      const belowThresholdAt = Date.now();
      coolingTimer = setTimeout(() => {
        coolingTimer = undefined;
        const latestTemperature = untrack(() => state.currentTemp);
        if (
          !isPlausibleTemp(latestTemperature) ||
          latestTemperature <= SESSION_TEMP_THRESHOLD_C
        ) {
          usage.endSession(sessionId, belowThresholdAt);
          activeSessionId = undefined;
        }
      }, SESSION_COOLING_GRACE_MS);
    }
  });

  onCleanup(() => {
    if (candidateTimer !== undefined) clearTimeout(candidateTimer);
    if (coolingTimer !== undefined) clearTimeout(coolingTimer);
    if (activeSessionId) usage.endSession(activeSessionId, Date.now());
    else usage.recoverOpenSessions(Date.now());
  });

  return null;
};

/** Wrapper for all Crafty routes: device store, header and tabs */
export const CraftyShell = (props: RouteSectionProps) => {
  const navigate = useNavigate();
  const { connectionState } = useBluetooth();

  // Redirect to connect page if not connected (the provider renders nothing
  // without a connected device, so this must live outside of it)
  createEffect(() => {
    const state = connectionState();
    if (
      state === ConnectionState.NOT_CONNECTED ||
      state === ConnectionState.RECONNECTING ||
      state === ConnectionState.CONNECTION_FAILED
    ) {
      navigate(buildRoute.root());
    }
  });

  return (
    <CraftyProvider>
      <CraftyLiveSession>
        <DeviceShell
          headerTrailing={<CraftyBattery />}
          tabs={[
            {
              href: buildRoute.craftyRoot(),
              label: m.nav_control(),
              icon: Thermometer,
            },
            {
              href: buildRoute.craftyHistory(),
              label: m.nav_history(),
              icon: History,
            },
            {
              href: buildRoute.usage(),
              label: m.nav_usage(),
              icon: Activity,
            },
            {
              href: buildRoute.craftySettings(),
              label: m.settings_title(),
              icon: SlidersHorizontal,
            },
          ]}
        >
          {props.children}
        </DeviceShell>
      </CraftyLiveSession>
    </CraftyProvider>
  );
};
