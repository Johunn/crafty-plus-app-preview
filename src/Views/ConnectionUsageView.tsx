import { useNavigate } from "@solidjs/router";
import Activity from "lucide-solid/icons/activity";
import Download from "lucide-solid/icons/download";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import History from "lucide-solid/icons/rotate-ccw-clock";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Thermometer from "lucide-solid/icons/thermometer";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { DeviceShell, type NavTab, PageTitle } from "../components/DeviceShell";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import { useConnectionUsage } from "../provider/ConnectionUsageProvider";
import { buildRoute } from "../routes";
import { isNativeAndroidBluetooth } from "../utils/androidBluetooth";
import {
  backgroundTrackingEnabled,
  loadBackgroundTrackingPreference,
} from "../utils/backgroundTracking";
import {
  type ConsumptionSession,
  connectionCyclesToCsv,
  consumptionSessionsToCsv,
  countConsumptionSessionsBetween,
  ESTIMATED_GRAMS_PER_SESSION,
  localDayKey,
  TRACKING_REST_MS,
} from "../utils/connectionUsage";

const formatTime = (time: number) =>
  new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);

const formatDate = (time: number) =>
  new Intl.DateTimeFormat(getLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(time);

const formatDuration = (seconds: number) => {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  if (minutes === 0) {
    return m.usage_durationSeconds({
      seconds: Math.max(0, Math.floor(seconds)),
    });
  }
  return hours > 0
    ? m.usage_durationHoursMinutes({
        hours,
        minutes: String(minutes % 60).padStart(2, "0"),
      })
    : m.usage_durationMinutes({ minutes });
};

const formatGrams = (count: number) =>
  new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(count * ESTIMATED_GRAMS_PER_SESSION);

const currentPeriod = (sessions: ConsumptionSession[], now: number) => {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  let first = 0;
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous.endedAt !== null &&
      current.startedAt - previous.endedAt >= TRACKING_REST_MS
    ) {
      first = index;
    }
  }
  const latest = sorted[sorted.length - 1];
  if (latest.endedAt !== null && now - latest.endedAt >= TRACKING_REST_MS) {
    return [];
  }
  return sorted.slice(first);
};

const lastSevenDays = (
  sessions: ConsumptionSession[],
  now: number,
  dailyResets: Record<string, number>
) => {
  const days: { count: number; label: string }[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const count = countConsumptionSessionsBetween(
      sessions,
      date.getTime(),
      next.getTime(),
      dailyResets
    );
    days.push({
      count,
      label: new Intl.DateTimeFormat(getLocale(), { weekday: "short" })
        .format(date)
        .replace(".", ""),
    });
  }
  return days;
};

const downloadCsv = (csv: string, name: string) => {
  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

const tabs: NavTab[] = [
  { href: buildRoute.craftyRoot(), label: m.nav_control(), icon: Thermometer },
  { href: buildRoute.craftyHistory(), label: m.nav_history(), icon: History },
  { href: buildRoute.usage(), label: m.nav_usage(), icon: Activity },
  {
    href: buildRoute.craftySettings(),
    label: m.settings_title(),
    icon: SlidersHorizontal,
  },
];

export const ConnectionUsageView = () => {
  const navigate = useNavigate();
  const usage = useConnectionUsage();
  onMount(() => {
    void loadBackgroundTrackingPreference().catch(() => {});
  });
  createEffect(() => {
    if (isNativeAndroidBluetooth() && !backgroundTrackingEnabled()) {
      navigate(buildRoute.craftyRoot(), { replace: true });
    }
  });
  const [now, setNow] = createSignal(Date.now());
  const [confirmReset, setConfirmReset] = createSignal(false);
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const sortedSessions = createMemo(() =>
    [...usage.sessions()].sort((a, b) => b.startedAt - a.startedAt)
  );
  const sortedConnections = createMemo(() =>
    [...usage.cycles()].sort((a, b) => b.startedAt - a.startedAt)
  );
  const current = createMemo(() =>
    currentPeriod(usage.sessions(), now()).filter((session) => {
      const resetAt = usage.dailyResets()[localDayKey(session.qualifiedAt)];
      return resetAt === undefined || session.qualifiedAt >= resetAt;
    })
  );
  const week = createMemo(() =>
    lastSevenDays(usage.sessions(), now(), usage.dailyResets())
  );
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
  const todayResetAt = createMemo(
    () => usage.dailyResets()[localDayKey(now())]
  );
  const weeklyCount = createMemo(() =>
    week().reduce((sum, day) => sum + day.count, 0)
  );
  const weeklyAverage = createMemo(() => weeklyCount() / 7);
  const peak = createMemo(() => Math.max(1, ...week().map((day) => day.count)));

  return (
    <DeviceShell tabs={tabs}>
      <PageTitle
        actions={
          <div class="flex gap-2">
            <Show when={usage.sessions().length > 0}>
              <Button
                variant="outline"
                size="icon"
                class="text-muted-foreground"
                aria-label={m.usage_exportSessions()}
                title={m.usage_exportSessions()}
                onClick={() =>
                  downloadCsv(
                    consumptionSessionsToCsv(usage.sessions()),
                    "crafty-sessions"
                  )
                }
              >
                <Download />
              </Button>
            </Show>
            <Show when={usage.cycles().length > 0}>
              <Button
                variant="outline"
                size="icon"
                class="text-muted-foreground"
                aria-label={m.usage_exportConnections()}
                title={m.usage_exportConnections()}
                onClick={() =>
                  downloadCsv(
                    connectionCyclesToCsv(usage.cycles()),
                    "crafty-connexions"
                  )
                }
              >
                <Download />
              </Button>
            </Show>
          </div>
        }
      >
        {m.usage_title()}
      </PageTitle>

      <Card class="flex flex-col gap-3 p-4">
        <div>
          <h2 class="font-medium text-sm">{m.usage_period()}</h2>
          <p class="mt-1 text-muted-foreground text-xs">
            {m.usage_periodHint()}
          </p>
        </div>
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="font-semibold text-3xl text-primary tabular-nums">
            {formatGrams(current().length)} g
          </span>
          <span class="text-muted-foreground text-xs">
            {m.usage_summaryConnections({ count: current().length })}
          </span>
        </div>
        <div class="text-muted-foreground text-xs">
          {current().length === 0
            ? m.usage_periodWaiting()
            : m.usage_periodStarted({
                time: formatDate(current()[0].startedAt),
              })}
        </div>
      </Card>

      <Card class="flex items-center justify-between gap-3 p-4">
        <div class="min-w-0">
          <h2 class="font-medium text-sm">{m.usage_summaryToday()}</h2>
          <p class="mt-1 font-semibold text-xl tabular-nums">
            {today()} · {formatGrams(today())} g
          </p>
          <Show when={todayResetAt()}>
            {(resetAt) => (
              <p class="mt-1 text-muted-foreground text-xs">
                {m.usage_dailyResetAt({ time: formatTime(resetAt()) })}
              </p>
            )}
          </Show>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw />
          {m.usage_resetToday()}
        </Button>
      </Card>

      <section class="grid grid-cols-2 gap-2.5">
        <Card class="flex flex-col gap-1 p-3.5">
          <span class="font-semibold text-xl tabular-nums">
            {weeklyCount()} · {formatGrams(weeklyCount())} g
          </span>
          <span class="text-[11px] text-muted-foreground leading-tight">
            {m.usage_week()}
          </span>
          <span class="text-[10px] text-muted-foreground">
            {m.usage_dailyAverage()}: {formatGrams(weeklyAverage())} g
          </span>
        </Card>
        <Card class="flex flex-col gap-1 p-3.5">
          <span class="font-semibold text-xl tabular-nums">
            {usage.sessions().length} · {formatGrams(usage.sessions().length)} g
          </span>
          <span class="text-[11px] text-muted-foreground leading-tight">
            {m.usage_total()}
          </span>
        </Card>
      </section>

      <Card class="flex flex-col gap-4 p-4">
        <div>
          <h2 class="font-medium text-sm">{m.usage_chartTitle()}</h2>
          <p class="mt-1 text-muted-foreground text-xs">
            {m.usage_chartHint()}
          </p>
        </div>
        <div
          class="grid h-32 grid-cols-7 items-end gap-2"
          role="img"
          aria-label={m.usage_chartTitle()}
        >
          <For each={week()}>
            {(day, index) => (
              <div class="flex h-full flex-col items-center justify-end gap-2">
                <span class="text-[9px] text-muted-foreground tabular-nums">
                  {day.count > 0 ? formatGrams(day.count) : ""}
                </span>
                <div class="flex h-full w-full items-end justify-center rounded-t-md bg-muted/40">
                  <div
                    class="w-1/2 min-w-3 rounded-t-md bg-primary transition-[height]"
                    classList={{ "bg-primary/60": index() < 6 }}
                    style={{
                      height: `${Math.max(4, (day.count / peak()) * 100)}%`,
                    }}
                  />
                </div>
                <span class="text-[10px] text-muted-foreground">
                  {day.label}
                </span>
              </div>
            )}
          </For>
        </div>
      </Card>

      <Card class="flex flex-col gap-2 p-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium text-sm">{m.usage_recent()}</h2>
          <span class="text-muted-foreground text-xs">
            {m.usage_perSession()}
          </span>
        </div>
        <Show
          when={sortedSessions().length > 0}
          fallback={
            <p class="py-5 text-center text-muted-foreground text-sm">
              {m.usage_sessionsEmpty()}
            </p>
          }
        >
          <ul class="divide-y">
            <For each={sortedSessions().slice(0, 50)}>
              {(session) => {
                const active = () => session.endedAt === null;
                const elapsed = () =>
                  ((session.endedAt ?? now()) - session.startedAt) / 1000;
                return (
                  <li class="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
                    <div class="min-w-0">
                      <div class="font-medium text-sm tabular-nums">
                        {formatDate(session.startedAt)} ·{" "}
                        {formatTime(session.startedAt)}
                      </div>
                      <div class="mt-1 text-muted-foreground text-xs">
                        {active()
                          ? m.usage_sessionActive()
                          : `${formatTime(session.endedAt ?? session.qualifiedAt)} · ${formatDuration(elapsed())}`}
                        <Show when={session.estimatedEnd}>
                          {` · ${m.usage_endEstimated()}`}
                        </Show>
                      </div>
                    </div>
                    <span class="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 font-mono text-primary text-xs">
                      {`+${formatGrams(1)} g`}
                    </span>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Card>

      <Card class="flex flex-col gap-2 p-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium text-sm">{m.usage_connectionsRecent()}</h2>
          <span class="text-muted-foreground text-xs">
            {m.usage_connectionHint()}
          </span>
        </div>
        <Show
          when={sortedConnections().length > 0}
          fallback={
            <p class="py-5 text-center text-muted-foreground text-sm">
              {m.usage_connectionsEmpty()}
            </p>
          }
        >
          <ul class="divide-y">
            <For each={sortedConnections().slice(0, 50)}>
              {(cycle) => {
                const active = () => cycle.endedAt === null;
                const elapsed = () =>
                  ((cycle.endedAt ?? now()) - cycle.startedAt) / 1000;
                return (
                  <li class="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
                    <div class="min-w-0">
                      <div class="font-medium text-sm tabular-nums">
                        {formatDate(cycle.startedAt)} ·{" "}
                        {formatTime(cycle.startedAt)}
                      </div>
                      <div class="mt-1 text-muted-foreground text-xs">
                        {active()
                          ? m.usage_connected()
                          : `${formatTime(cycle.endedAt ?? cycle.startedAt)} · ${formatDuration(elapsed())}`}
                        <Show when={cycle.estimatedEnd}>
                          {` · ${m.usage_endEstimated()}`}
                        </Show>
                      </div>
                    </div>
                    <span class="shrink-0 rounded-full bg-muted px-2.5 py-1 font-mono text-muted-foreground text-xs">
                      {formatDuration(elapsed())}
                    </span>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Card>

      <p class="px-1 text-muted-foreground text-[11px] leading-relaxed">
        {m.usage_estimateNote()}
      </p>

      <AlertDialog open={confirmReset()} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.usage_resetTitle()}</AlertDialogTitle>
            <AlertDialogDescription>
              {m.usage_resetDescription()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose variant="outline">
              {m.common_cancel()}
            </AlertDialogClose>
            <AlertDialogClose
              variant="destructive"
              onClick={() => usage.resetToday(now())}
            >
              <RotateCcw />
              {m.usage_resetToday()}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DeviceShell>
  );
};
