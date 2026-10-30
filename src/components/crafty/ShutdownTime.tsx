import Timer from "lucide-solid/icons/timer";
import { Show } from "solid-js";
import { m } from "../../paraglide/messages";
import { useCrafty } from "../../provider/CraftyProvider";
import { formatDuration } from "../../utils/heatProgress";
import { StatusNote } from "../TemperatureControls";

/**
 * Shows the Crafty+ automatic shutdown countdown while it is active.
 */
export const ShutdownTime = () => {
  const { state, derived, isOldFirmware } = useCrafty();

  const isVisible = () =>
    !isOldFirmware &&
    derived.isHeaterActive() &&
    state.autoOffRemaining !== null &&
    state.autoOffRemaining > 0;

  return (
    <Show when={isVisible()}>
      <StatusNote icon={Timer}>
        {m.device_shutdownIn({
          time: formatDuration(state.autoOffRemaining ?? 0),
        })}
      </StatusNote>
    </Show>
  );
};
