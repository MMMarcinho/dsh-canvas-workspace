import test from "node:test";
import assert from "node:assert/strict";
import { arrangeReplies, type LayoutCard } from "../src/ui/reply-layout";
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
