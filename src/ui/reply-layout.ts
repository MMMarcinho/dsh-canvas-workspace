/** World-space rectangles; sizes are measured before applying camera zoom. */
export type LayoutCard = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fixed: boolean;
};
const GAP = 30;
// Subpixel measurement noise must not turn the intended gap into a collision.
const EPSILON = 0.5;
function collides(card: LayoutCard, other: LayoutCard): boolean {
  return (
    card.x < other.x + other.width + GAP - EPSILON &&
    card.x + card.width + GAP - EPSILON > other.x &&
    card.y < other.y + other.height + GAP - EPSILON &&
    card.y + card.height + GAP - EPSILON > other.y
  );
}
function avoid(card: LayoutCard, occupied: LayoutCard[]): LayoutCard {
  let y = card.y;
  // Every collision advances below an obstacle, so this terminates even when
  // fixed cards overlap one another or lie outside the visible viewport.
  for (;;) {
    const hits = occupied.filter((other) => collides({ ...card, y }, other));
    if (!hits.length) return { ...card, y };
    y = Math.max(...hits.map((other) => other.y + other.height + GAP));
  }
}
/** Stable reading order, fixed card obstacles, no text resizing or camera moves. */
export function arrangeReplies(
  cards: LayoutCard[],
  area?: { x: number; y: number; width: number },
): LayoutCard[] {
  const occupied = cards.filter((card) => card.fixed);
  let x = area?.x ?? 0;
  let y = area?.y ?? 0;
  let rowBottom = y;
  return cards.map((card) => {
    if (card.fixed) return card;
    if (area && x > area.x && x + card.width > area.x + area.width + EPSILON) {
      x = area.x;
      y = rowBottom + GAP;
    }
    const placed = avoid(area ? { ...card, x, y } : card, occupied);
    occupied.push(placed);
    if (area) {
      x = placed.x + placed.width + GAP;
      y = placed.y;
      rowBottom = Math.max(rowBottom, placed.y + placed.height);
    }
    return placed;
  });
}

/** Repair only the collision chain caused by genuinely taller content.
 * Visual order, rather than history order, preserves the user's arrangement.
 * Unrelated overlaps and later fixed obstacles do not initiate a repair. */
export function repairReplyGrowth(
  cards: LayoutCard[],
  grown: ReadonlySet<string>,
): LayoutCard[] {
  if (!grown.size) return cards;
  const result = new Map(cards.map((card) => [card.id, card]));
  const occupied = cards.filter((card) => card.fixed);
  const active = cards
    .filter((card) => card.fixed && grown.has(card.id))
    .map((card) => ({ card, originY: card.y }));
  const ordered = cards
    .map((card, index) => ({ card, index }))
    .sort(
      (a, b) => a.card.y - b.card.y || a.card.x - b.card.x || a.index - b.index,
    );
  for (const { card } of ordered) {
    if (card.fixed) continue;
    const affected =
      active.some(
        (blocker) =>
          blocker.originY <= card.y + EPSILON && collides(card, blocker.card),
      ) ||
      (grown.has(card.id) &&
        occupied.some((other) => other.fixed && collides(card, other)));
    const placed = affected ? avoid(card, occupied) : card;
    result.set(card.id, placed);
    occupied.push(placed);
    if (grown.has(card.id) || placed.y > card.y + EPSILON)
      active.push({ card: placed, originY: card.y });
  }
  return cards.map((card) => result.get(card.id)!);
}
