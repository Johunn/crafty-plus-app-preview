import { A, type RouteSectionProps, useNavigate } from "@solidjs/router";
import Activity from "lucide-solid/icons/activity";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Battery from "lucide-solid/icons/battery";
import ChevronRight from "lucide-solid/icons/chevron-right";
import MapPin from "lucide-solid/icons/map-pin";
import Minus from "lucide-solid/icons/minus";
import History from "lucide-solid/icons/rotate-ccw-clock";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Thermometer from "lucide-solid/icons/thermometer";
import TrendingDown from "lucide-solid/icons/trending-down";
import TrendingUp from "lucide-solid/icons/trending-up";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { ShutdownTime } from "../components/crafty/ShutdownTime";
import { Temperature } from "../components/crafty/Temperature";
import { DeviceShell } from "../components/DeviceShell";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import { useBluetooth } from "../provider/BluetoothProvider";
import { useConnectionUsage } from "../provider/ConnectionUsageProvider";
import { CraftyProvider, useCrafty } from "../provider/CraftyProvider";
import { LiveSessionProvider } from "../provider/LiveSessionProvider";
import { useToast } from "../provider/ToastProvider";
import { buildRoute } from "../routes";
import { isNativeAndroidBluetooth } from "../utils/androidBluetooth";
import {
  backgroundTrackingEnabled,
  loadBackgroundTrackingPreference,
} from "../utils/backgroundTracking";
import {
  countConsumptionSessionsBetween,
  ESTIMATED_GRAMS_PER_SESSION,
  SESSION_COOLING_GRACE_MS,
  SESSION_MIN_HOT_MS,
  SESSION_TEMP_THRESHOLD_C,
} from "../utils/connectionUsage";
import { alertCraftyBatteryLow } from "../utils/notify";
import { isPlausibleTemp } from "../utils/sessionHistory";
import { ConnectionState } from "../utils/uuids";

export const CraftyView: Component = () => {
  const { actions, derived, isCraftyPlus, state } = useCrafty();
  const showToast = useToast();

  // Keep the screen on while the device heats

  return (
    <>
      <CraftyBatteryCard />
      <Show when={!isNativeAndroidBluetooth() || backgroundTrackingEnabled()}>
        <CraftyConsumptionSummary />
      </Show>
      <ShutdownTime />
      <Temperature />
      {/* Find My Device - only Crafty+ */}
      <Show when={isCraftyPlus}>
        <button
          type="button"
          disabled={
            !state.loaded ||
            !state.statusRegister2Verified ||
            state.statusRegister2Pending ||
            derived.isFindMyActive()
          }
          onClick={() => {
            void actions
              .findMyDevice()
              .catch(() =>
                showToast({ message: m.settings_deviceSettingSaveFailed() })
              );
          }}
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

const CraftyBatteryCard = () => {
  const { state } = useCrafty();
  const level = () =>
    state.loaded ? Math.max(0, Math.min(100, state.batteryLevel)) : undefined;
  const levelState = () => {
    const value = level();
    if (value === undefined || value > 50) return "normal";
    if (value > 20) return "medium";
    return "low";
  };
  return (
    <section
      class="rounded-3xl border border-success/20 bg-gradient-to-br from-success-soft/70 via-card to-success-soft/25 p-4 shadow-sm"
      aria-label={m.device_battery()}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="grid size-11 shrink-0 place-items-center rounded-2xl bg-success-soft text-success">
            <Battery class="size-6" />
          </div>
          <h2 class="font-semibold text-sm">{m.device_battery()}</h2>
        </div>
        <span
          class="font-bold text-3xl tabular-nums"
          classList={{
            "text-success": levelState() === "normal",
            "text-amber-600 dark:text-amber-400": levelState() === "medium",
            "text-destructive": levelState() === "low",
          }}
        >
          {level() === undefined ? "–" : `${level()} %`}
        </span>
      </div>
      <div
        class="mt-4 h-3 overflow-hidden rounded-full bg-success/10 p-0.5"
        role="progressbar"
        aria-label={m.device_battery()}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={level()}
      >
        <div
          class="h-full rounded-full transition-[width] duration-500"
          classList={{
            "bg-success": levelState() === "normal",
            "bg-amber-500": levelState() === "medium",
            "bg-destructive": levelState() === "low",
          }}
          style={{ width: `${level() ?? 0}%` }}
        />
      </div>
    </section>
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
  const dailyAverage = createMemo(() => week() / 7);
  const dailyTrend = createMemo(() => {
    if (week() === 0) return "empty";
    if (today() > dailyAverage()) return "above";
    if (today() < dailyAverage()) return "below";
    return "equal";
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
          <Show when={dailyTrend() !== "empty"}>
            <span
              class="mt-0.5 flex w-fit animate-pulse items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[9px]"
              role="status"
              classList={{
                "bg-red-500/10 text-red-600 dark:text-red-400":
                  dailyTrend() === "above",
                "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400":
                  dailyTrend() === "below",
                "bg-muted text-muted-foreground": dailyTrend() === "equal",
              }}
              aria-label={
                dailyTrend() === "above"
                  ? m.usage_trendAbove()
                  : dailyTrend() === "below"
                    ? m.usage_trendBelow()
                    : m.usage_trendEqual()
              }
              title={
                dailyTrend() === "above"
                  ? m.usage_trendAbove()
                  : dailyTrend() === "below"
                    ? m.usage_trendBelow()
                    : m.usage_trendEqual()
              }
            >
              <Show
                when={dailyTrend() === "above"}
                fallback={
                  <Show
                    when={dailyTrend() === "below"}
                    fallback={<Minus class="size-3" />}
                  >
                    <TrendingDown class="size-3" />
                  </Show>
                }
              >
                <TrendingUp class="size-3" />
              </Show>
              <span>
                {dailyTrend() === "above"
                  ? m.usage_trendAboveShort()
                  : dailyTrend() === "below"
                    ? m.usage_trendBelowShort()
                    : m.usage_trendEqualShort()}
              </span>
            </span>
          </Show>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-muted-foreground text-[11px]">
            {m.usage_summaryWeekTotal()}
          </span>
          <span class="font-semibold text-lg tabular-nums">
            {formatGrams(week())} <span class="font-normal text-sm">g</span>
          </span>
          <span class="text-muted-foreground text-[11px]">
            {m.usage_summaryConnections({ count: week() })}
          </span>
          <span class="text-muted-foreground text-[10px]">
            {m.usage_dailyAverage()}: {formatGrams(dailyAverage())} g
          </span>
        </div>
      </div>
    </A>
  );
};

const CraftyBatteryLowAlert = () => {
  const { state } = useCrafty();
  createEffect(() => {
    if (state.loaded && !isNativeAndroidBluetooth()) {
      alertCraftyBatteryLow(state.batteryLevel);
    }
  });
  return null;
};

const CraftyLiveSession = (props: { children: JSX.Element }) => {
  const { state, derived } = useCrafty();
  return (
    <>
      <CraftyConsumptionTracker />
      <LiveSessionProvider
        reading={() => ({
          current: state.currentTemp,
          target: derived.effectiveTargetTemp(),
          heating: derived.isHeaterActive(),
          reached: derived.isHeaterActive() && derived.isSetpointReached(),
          batteryLevel: state.batteryLevel,
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
  if (isNativeAndroidBluetooth()) return null;
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
  onMount(() => {
    void loadBackgroundTrackingPreference().catch(() => {});
  });

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
        <CraftyBatteryLowAlert />
        <DeviceShell
          tabs={() => [
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
            ...(!isNativeAndroidBluetooth() || backgroundTrackingEnabled()
              ? [
                  {
                    href: buildRoute.usage(),
                    label: m.nav_usage(),
                    icon: Activity,
                  },
                ]
              : []),
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
