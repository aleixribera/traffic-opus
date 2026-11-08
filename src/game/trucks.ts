// Truck classes (docs/design.md, "Freight"): the company's fleets all run the best class unlocked by milestones,
// with nothing to buy or pick per building. A bigger class carries more per trip, so the same flow needs fewer
// trucks on the road, but each one takes more road: it is longer, slower to pull away and slower on the open road,
// so it holds a junction longer. The price is paid in junction time, not money. The body (tipper, tanker,
// flatbed, box) still comes from what it carries.

import type { Unit } from "../sim/traffic";

export type TruckClass = "light" | "heavy" | "roadtrain";

export interface TruckClassDef {
  id: TruckClass;
  name: string;
  /** loads per trip, times the company's load per truck (milestones raise that for every class) */
  payload: number;
  /** length on the road (m) */
  len: number;
  /** share of the speed limit it drives at */
  speed: number;
  /** share of a car's acceleration */
  accel: number;
  /** fuel per km, against a light truck's */
  fuel: number;
  /** rigid pieces drawn along the path (a road train: tractor and two trailers) */
  units?: Unit[];
  blurb: string;
}

/**
 * A road train (B-double): a tractor, a lead trailer riding its fifth wheel, and a second trailer riding the lead
 * trailer's rear one. Offsets from the front bumper (m); each piece's pivot is where it rides, its axle where its
 * rear wheels are. The models (tools/blender/build_models.py: rt_tractor, rt_*) are built to these numbers.
 */
export const ROAD_TRAIN_UNITS: Unit[] = [
  { at: 0, len: 6.4, pivot: 1.3, axle: 5.1 },
  { at: 4.3, len: 9.4, pivot: 0.8, axle: 8.3 },
  { at: 12.0, len: 10.0, pivot: 0.6, axle: 8.6 },
];

/** The heavy rigid, drawn from its wheels: the twin steer axles 2 m behind the bumper, the rear tandem at 10 m. It
 * swings through a turn about them like the real thing, not as a 12 m plank laid along the path. */
export const HEAVY_UNITS: Unit[] = [{ at: 0, len: 12, pivot: 2.0, axle: 10.0 }];

export const TRUCK_CLASSES: Record<TruckClass, TruckClassDef> = {
  light: {
    id: "light", name: "Light truck", payload: 1, len: 8.5, speed: 0.85, accel: 1, fuel: 1,
    blurb: "A rigid two-axle truck: quick away from a junction and short in a queue.",
  },
  heavy: {
    id: "heavy", name: "Heavy truck", payload: 2, len: 12, speed: 0.82, accel: 0.8, fuel: 1.5,
    units: HEAVY_UNITS,
    blurb: "A four-axle rigid: twice the load for half as much fuel again, a little slower off the line.",
  },
  roadtrain: {
    id: "roadtrain", name: "Road train", payload: 4, len: 22, speed: 0.75, accel: 0.6, fuel: 2.6,
    units: ROAD_TRAIN_UNITS,
    blurb: "A tractor with two trailers: four times the load, but 22 m long and slow to clear a junction.",
  },
};

export const TRUCK_CLASS_ORDER: TruckClass[] = ["light", "heavy", "roadtrain"];

/** A class's numbers (a trip from before classes, or a light truck's: unset). */
export const classOf = (c: TruckClass | undefined): TruckClassDef => TRUCK_CLASSES[c ?? "light"];
