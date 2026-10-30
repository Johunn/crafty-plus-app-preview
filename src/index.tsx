import { render } from "solid-js/web";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { BluetoothProvider } from "./provider/BluetoothProvider";
import { DarkModeProvider } from "./provider/DarkModeProvider";
import { EffectsProvider } from "./provider/EffectsProvider";
import { HistoryProvider } from "./provider/HistoryProvider";
import { ConnectionUsageProvider } from "./provider/ConnectionUsageProvider";
import { ToastProvider } from "./provider/ToastProvider";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./css/main.css";
import { getLocale } from "./paraglide/runtime";
import { Routes } from "./Router";
import { capturePendingWorkflow } from "./utils/workflowShare";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");
document.documentElement.lang = getLocale();
// Before the router starts, so the redirect to /connect keeps the workflow
capturePendingWorkflow();

const dispose = render(
  () => (
    <DarkModeProvider>
      <EffectsProvider>
        <ToastProvider>
          <ConnectionUsageProvider>
            <BluetoothProvider>
              <HistoryProvider>
                <Routes />
                <UpdatePrompt />
              </HistoryProvider>
            </BluetoothProvider>
          </ConnectionUsageProvider>
        </ToastProvider>
      </EffectsProvider>
    </DarkModeProvider>
  ),
  root
);
/** Hot Module Replacement */
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(dispose);
}
