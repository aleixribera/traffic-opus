// Town orders in the panels (docs/design.md, "Town orders"): a town's open orders with how far along each is, the
// buildings its filled ones brought and the perk each gives, and the Towns window's short list of every open order.
// Plain words, the needs panel's: loads, days left, "Plenty".

import { formatMoney } from "../core/math";
import type { Game } from "../game/city";
import { CIVICS } from "../game/civics";
import { PRODUCTS, type Product } from "../game/industry";
import { fairRate, fairWant, orderLine, type Order } from "../game/orders";
import type { Town } from "../game/settlements";
import { DAY, HOUR } from "../game/society";
import { TOWN_SIZES } from "../game/towns";
import { productIcon } from "./icons";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const loads = (n: number) => (n < 10 && n % 1 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));
const low = (p: Product) => PRODUCTS[p].name.toLowerCase();

/** Time left on an order, in words: "3 days left", "20 hours left", "under an hour left". */
export function timeLeft(o: Order, now: number): string {
  const s = Math.max(0, o.until - now);
  if (s >= DAY * 1.5) return `${Math.round(s / DAY)} days left`;
  if (s >= HOUR) return `${plural(Math.round(s / HOUR), "hour")} left`;
  return "under an hour left";
}

/** "a schoolhouse", "an ..." */
const an = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name.toLowerCase()}`;

/** What an order asks, short: "30 planks and 20 cement", or "food and milk at Plenty, 3 days". */
export function orderAsk(o: Order): string {
  const ps = Object.keys(o.goods) as Product[];
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
  return o.type === "fair"
    ? `Keep ${list(ps.map(low))} at Plenty for ${plural(o.days ?? 1, "day")}`
    : list(ps.map((p) => `${loads(o.goods[p]!)} ${low(p)}`));
}

/** The order's title: "Schoolhouse", or for a fair its event ("Opening Day for the ballpark"). */
const title = (o: Order) => (o.type === "fair" ? `${CIVICS[o.kind].fair?.event ?? "Fair"}` : CIVICS[o.kind].name);

/** A bar filled `k` of the way, in the product's colour on the plate. */
const bar = (k: number, cls = "") => `<span class="od-bar ${cls}" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, k)) * 100)}%"></i></span>`;

/** One open order in its town's panel: what it wants and how far along it is, and what it brings. */
function openRow(g: Game, t: Town, o: Order): string {
  const C = CIVICS[o.kind];
  const ps = Object.keys(o.goods) as Product[];
  const left = timeLeft(o, g.time);
  const urgent = o.until - g.time < DAY * 0.75;
  let rows: string;
  if (o.type === "deliver") {
    rows = ps.map((p) => {
      const need = o.goods[p]!, got = Math.min(need, o.got[p] ?? 0);
      return `<li class="od-p${got >= need ? " full" : ""}"><span class="od-ic" aria-hidden="true">${productIcon(p)}</span><span class="od-pn">${PRODUCTS[p].name}</span>${bar(got / need)}<span class="od-n">${loads(Math.floor(got))} <span class="muted">of ${loads(need)}</span></span></li>`;
    }).join("");
  } else {
    // a fair: each product in plenty for the crowds right now (loads over the last day against what they want), and
    // the days held so far
    rows = ps.map((p) => {
      const have = fairRate(t, p), want = fairWant(t, p), on = have >= want - 1e-9;
      return `<li class="od-p${on ? " full" : ""}" title="${loads(have)} loads came over the last day; the fair's crowds want ${loads(want)} a day, a quarter more than the town alone"><span class="od-ic" aria-hidden="true">${productIcon(p)}</span><span class="od-pn">${PRODUCTS[p].name}</span>${bar(have / want)}<span class="od-n ${on ? "good" : ""}">${on ? "Plenty" : `${loads(have)} <span class="muted">of ${loads(want)} a day</span>`}</span></li>`;
    }).join("");
    const held = Math.floor((o.held ?? 0) / 24 * 10) / 10, days = o.days ?? 1;
    rows += `<li class="od-p od-held"><span class="od-pn">Days in plenty</span>${bar((o.held ?? 0) / (days * 24), "held")}<span class="od-n">${held % 1 ? held.toFixed(1) : held} <span class="muted">of ${days}</span></span></li>`;
  }
  return `<li class="od">
      <p class="od-top"><b>${esc(title(o))}</b><span class="od-left${urgent ? " bad" : ""}">${left}</span></p>
      ${o.type === "fair" ? `<p class="od-ask">${esc(orderAsk(o))}</p>` : ""}
      <ul class="od-ps">${rows}</ul>
      <p class="od-pay"><span class="od-pay-k">Brings</span> ${an(C.name)} and a <span class="od-grant">${formatMoney(o.grant)}</span> grant</p>
      <p class="od-perk">${esc(C.perkText)}</p>
    </li>`;
}

/**
 * The Orders section of a town's panel: "4 of 7 done", its open orders, the buildings its filled ones brought and their
 * perks, and when the rest come.
 */
export function townOrders(g: Game, t: Town): string {
  const set = g.orders.setOf(t.id);
  const { done, of } = g.orders.tally(t.id);
  const open = g.orders.openIn(t.id);
  const finished = set.filter((s) => s.state === "done");
  const waiting = set.filter((s) => s.state === "waiting");
  const later = waiting.filter((s) => CIVICS[s.kind].size > t.size);
  const nextSize = later.length ? Math.min(...later.map((s) => CIVICS[s.kind].size)) : -1;
  const openHtml = open.map((o) => openRow(g, t, o)).join("");
  const doneHtml = finished.map((s) => {
    const C = CIVICS[s.kind];
    const b = s.b !== undefined ? g.buildings.byId.get(s.b) : undefined;
    const state = !b ? `<span class="muted">· waiting for room in town</span>` : b.built < 1 ? `<span class="muted">· building, ${Math.round(b.built * 100)}%</span>` : "";
    return `<li class="od-done"><b>${esc(C.name)}</b> ${state}<span class="od-perk">${esc(C.perkText)}</span></li>`;
  }).join("");
  // what is still to come, in words (which buildings stays a surprise)
  let more = "";
  if (!open.length && waiting.length) {
    const now = waiting.length - later.length;
    more = !now
      ? `Its next ${waiting.length === 1 ? "order comes" : "orders come"} once it is a ${TOWN_SIZES[nextSize].name}.`
      : !g.orders.canTake(t)
      ? `Orders come once your trucks have brought it something and a few families have settled.`
      : `Another order comes when the town is ready: keep its needs coming.`;
  } else if (later.length) more = `${plural(later.length, "more order")} once it is a ${TOWN_SIZES[nextSize].name}.`;
  return `<h3 class="sub-h od-h">Orders <span class="num">${done} of ${of} filled</span></h3>
    ${open.length ? `<ul class="ods">${openHtml}</ul>` : ""}
    ${more ? `<p class="od-more">${esc(more)}</p>` : ""}
    ${finished.length ? `<ul class="od-dones">${doneHtml}</ul>` : ""}`;
}

/** The Towns window's list of every open order, soonest due first: town, building, how far along, time left. */
export function openOrders(g: Game): string {
  if (!g.orders.open.length) return "";
  const rows = [...g.orders.open].sort((a, b) => a.until - b.until).map((o) => {
    const t = g.towns.byId.get(o.town);
    if (!t) return "";
    const what = o.type === "fair" ? `${title(o)} · ${orderAsk(o).replace(/^Keep /, "")}` : `${CIVICS[o.kind].name} · ${orderAsk(o)}`;
    return `<li><button class="tw-order" data-id="${t.id}" title="${esc(orderLine(o, t.name))}"><span class="tw-name"><b>${esc(t.name)}</b><span class="small muted">${esc(what)}</span></span>${bar(g.orders.progress(o))}<span class="tw-o-left">${timeLeft(o, g.time).replace(" left", "")}</span></button></li>`;
  }).join("");
  return `<h3 class="sub-h">Open orders <span class="num">${g.orders.open.length}</span></h3><ul class="tw-orders">${rows}</ul>`;
}
