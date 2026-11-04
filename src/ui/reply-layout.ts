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
function avoid(card: LayoutCard, occupied: LayoutCard[]): LayoutCard {
  let y = card.y;
  // Every collision advances below an obstacle, so this terminates even when
  // fixed cards overlap one another or lie outside the visible viewport.
  for (;;) {
    const hits = occupied.filter(
      (other) =>
        card.x < other.x + other.width + GAP &&
        card.x + card.width + GAP > other.x &&
        y < other.y + other.height + GAP &&
        y + card.height + GAP > other.y,
    );
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
    if (area && x > area.x && x + card.width > area.x + area.width) {
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
