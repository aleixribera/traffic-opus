// @ts-expect-error: the project has no Node types (the game runs in the browser); vitest runs this under Node
import { constants, setPriority } from "node:os";

// Tests run at the lowest CPU priority so they never slow a game or anything else on this PC: they only get CPU no
// one else wants. On Windows PRIORITY_LOW is the Idle class.
try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // not allowed here: run at normal priority
}
