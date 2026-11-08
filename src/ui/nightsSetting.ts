// The Nights setting's button in the pause menu: shows the current choice and steps through Full cycle, Soft nights
// and Always day on each click (render/daylight.ts has the setting; it is kept in localStorage).

import { NIGHT_MODES } from "../render/daylight";
import type { DayCycle } from "../render/daycycle";

/** Wire a pause-menu button to the setting. */
export function wireNights(b: HTMLButtonElement | null, cycle: DayCycle, click: () => void) {
  if (!b) return;
  const show = () => {
    const m = NIGHT_MODES.find((x) => x.id === cycle.mode) ?? NIGHT_MODES[0];
    b.innerHTML = `Nights <span class="muted">· ${m.name}</span>`;
    b.title = `${m.blurb}. Click to change.`;
    b.setAttribute("aria-label", `Nights: ${m.name}. ${m.blurb}. Click to change.`);
  };
  b.onclick = () => {
    click();
    const i = NIGHT_MODES.findIndex((x) => x.id === cycle.mode);
    cycle.setMode(NIGHT_MODES[(i + 1) % NIGHT_MODES.length].id);
    show();
  };
  show();
}
