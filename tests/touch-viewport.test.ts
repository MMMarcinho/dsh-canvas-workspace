import test from "node:test";
import assert from "node:assert/strict";
import {
  TouchViewportGesture,
  type TouchViewport,
} from "../src/ui/touch-viewport";
const point = (id: number, x: number, y = 0) => ({ id, x, y });
const initial = { x: 10, y: 20, zoom: 1 };

test("one finger does not claim native content", () => {
  const gesture = new TouchViewportGesture();
  assert.equal(gesture.sample([point(1, 10)], initial), null);
  assert.equal(gesture.sample([point(1, 40)], initial), null);
  assert.equal(gesture.active, false);
});
test("pinch scales around the moving midpoint, including viewport offsets", () => {
  const gesture = new TouchViewportGesture();
  gesture.sample([point(1, 50, 40), point(2, 150, 40)], initial);
  assert.deepEqual(
    gesture.sample([point(2, 220, 70), point(1, 20, 70)], initial),
    { x: -60, y: 30, zoom: 2 },
  );
});
test("parallel two-finger movement pans without changing scale", () => {
  const gesture = new TouchViewportGesture();
  gesture.sample([point(1, 0), point(2, 100)], initial);
  assert.deepEqual(
    gesture.sample([point(1, 25, 50), point(2, 125, 50)], initial),
    { x: 35, y: 70, zoom: 1 },
  );
});
test("1 → 2 → 1 → 2 transitions rebase without jumps", () => {
  const gesture = new TouchViewportGesture();
  gesture.sample([point(1, 0)], initial);
  gesture.sample([point(1, 20), point(2, 120)], initial);
  let view = gesture.sample([point(1, 40), point(2, 240)], initial)!;
  assert.equal(gesture.sample([point(2, 240)], view), null);
  view = gesture.sample([point(2, 250, 10)], view)!;
  assert.deepEqual(view, { x: 30, y: 50, zoom: 2 });
  assert.equal(
    gesture.sample([point(2, 250, 10), point(3, 300, 10)], view),
    null,
  );
  assert.deepEqual(
    gesture.sample([point(2, 250, 10), point(3, 300, 10)], view),
    view,
  );
  gesture.sample([], view);
  assert.equal(gesture.active, false);
});
test("third fingers do not perturb the selected pair and replacements rebase", () => {
  const gesture = new TouchViewportGesture();
  gesture.sample([point(2, 0), point(3, 100)], initial);
  assert.deepEqual(
    gesture.sample([point(2, 0), point(3, 100), point(4, 900)], initial),
    initial,
  );
  assert.equal(gesture.sample([point(3, 100), point(4, 900)], initial), null);
  assert.deepEqual(gesture.sample([point(3, 110), point(4, 910)], initial), {
    ...initial,
    x: 20,
  });
});
test("zoom bounds preserve the midpoint anchor rather than accumulating drift", () => {
  for (const [span, zoom] of [
    [1000, 2],
    [1, 0.25],
  ]) {
    const gesture = new TouchViewportGesture();
    gesture.sample([point(1, 0), point(2, 100)], initial);
    const result = gesture.sample(
      [point(1, 50 - span / 2), point(2, 50 + span / 2)],
      initial,
    )!;
    assert.equal(result.zoom, zoom);
    assert.equal((50 - result.x) / result.zoom, 40);
  }
});
test("coincident or invalid touches never produce non-finite camera values", () => {
  const gesture = new TouchViewportGesture();
  gesture.sample([point(1, 0), point(2, 0)], initial);
  assert.equal(gesture.sample([point(1, 0), point(2, 10)], initial), null);
  const result = gesture.sample([point(1, 0), point(2, 20)], initial)!;
  assert.ok(Object.values(result).every(Number.isFinite));
  gesture.reset();
  assert.equal(gesture.sample([point(1, NaN), point(2, 10)], initial), null);
});
test("cancellation leaves a new sequence independent of the previous camera", () => {
  const gesture = new TouchViewportGesture();
  gesture.sample([point(1, 0), point(2, 100)], initial);
  gesture.reset();
  const view: TouchViewport = { x: -300, y: -40, zoom: 0.5 };
  gesture.sample([point(7, 0), point(8, 100)], view);
  assert.deepEqual(gesture.sample([point(7, 10), point(8, 110)], view), {
    ...view,
    x: -290,
  });
});
