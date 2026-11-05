import test from "node:test";
import assert from "node:assert/strict";
import {
  arrangeReplies,
  repairReplyGrowth,
  type LayoutCard,
} from "../src/ui/reply-layout";
const card = (id: string, patch: Partial<LayoutCard> = {}): LayoutCard => ({
  id,
  x: 0,
  y: 0,
  width: 600,
  height: 100,
  fixed: false,
  ...patch,
});
test("packs in order at world-space width without shrinking tall cards", () => {
  const result = arrangeReplies(
    [card("a", { height: 900 }), card("b"), card("c")],
    { x: -100, y: 20, width: 1230 },
  );
  assert.deepEqual(
    result.map(({ x, y }) => [x, y]),
    [
      [-100, 20],
      [530, 20],
      [-100, 950],
    ],
  );
  assert.equal(result[0].height, 900);
  const narrow = arrangeReplies([card("a"), card("b")], {
    x: 0,
    y: 0,
    width: 300,
  });
  assert.equal(narrow[1].y, 130);
  assert.equal(narrow[0].width, 600);
});
test("respects fixed obstacles including later cards and viewport boundaries", () => {
  const fixed = card("fixed", { x: 400, y: 50, fixed: true });
  const result = arrangeReplies([card("a"), fixed, card("b")], {
    x: 0,
    y: 0,
    width: 1230,
  });
  assert.deepEqual(result[1], fixed);
  assert.equal(result[0].y, 180);
  assert.equal(result[2].y, 180);
});
test("late image growth pushes only colliding automatic cards and settles", () => {
  const input = [
    card("a", { height: 900 }),
    card("b", { x: 630 }),
    card("c", { y: 130 }),
    card("fixed", { y: 1000, fixed: true }),
  ];
  const result = arrangeReplies(input);
  assert.equal(result[1].y, 0);
  assert.equal(result[2].y, 1130);
  assert.deepEqual(result[3], input[3]);
  assert.deepEqual(arrangeReplies(result), result);
});

test("subpixel widths do not collapse neighboring columns", () => {
  const input = [
    card("a", { width: 600.00001 }),
    card("b", { x: 630 }),
    card("c", { x: 1260, width: 600.0001 }),
  ];
  assert.deepEqual(arrangeReplies(input), input);
  assert.deepEqual(repairReplyGrowth(input, new Set()), input);
});
test("growth repairs only its visual collision chain, preserving distant rows and columns", () => {
  const input = [
    card("c", { y: 260 }),
    card("b", { y: 130 }),
    card("a", { height: 300 }),
    card("side", { x: 630 }),
    card("pin", { y: 500, fixed: true }),
    card("far", { y: 900 }),
  ];
  const output = repairReplyGrowth(input, new Set(["a"]));
  assert.equal(output[0].y, 630);
  assert.equal(output[1].y, 330);
  for (const index of [2, 3, 4, 5])
    assert.deepEqual(output[index], input[index]);
  assert.deepEqual(repairReplyGrowth(output, new Set()), output);
});
test("unrelated notifications never normalize deliberate overlaps", () => {
  const input = [
    card("manual", { fixed: true }),
    card("a", { y: 20 }),
    card("far-grow", { x: 1600, height: 800 }),
  ];
  assert.deepEqual(repairReplyGrowth(input, new Set(["far-grow"])), input);
});
test("a taller automatic card avoids a fixed obstacle and propagates from its original visual order", () => {
  const input = [
    card("grow", { height: 400 }),
    card("next", { y: 200, height: 350 }),
    card("pin", { y: 300, fixed: true }),
    card("side", { x: 630 }),
  ];
  const output = repairReplyGrowth(input, new Set(["grow"]));
  assert.equal(output[0].y, 430);
  assert.equal(output[1].y, 860);
  assert.deepEqual(output[2], input[2]);
  assert.deepEqual(output[3], input[3]);
});
test("fixed growth keeps its coordinates while making room below", () => {
  const input = [
    card("pin", { height: 400, fixed: true }),
    card("next", { y: 130 }),
    card("side", { x: 630 }),
  ];
  const output = repairReplyGrowth(input, new Set(["pin"]));
  assert.deepEqual(output[0], input[0]);
  assert.equal(output[1].y, 430);
  assert.deepEqual(output[2], input[2]);
});
