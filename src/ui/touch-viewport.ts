export type TouchPoint = { id: number; x: number; y: number };
export type TouchViewport = { x: number; y: number; zoom: number };
const center = (points: TouchPoint[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});
const distance = (points: TouchPoint[]) =>
  points.length === 2
    ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
    : 0;

// Touch IDs, rather than event order, define the gesture. Changing the active
// pair rebases against the live camera so 1 → 2 → 1 and third fingers cannot jump.
export class TouchViewportGesture {
  active = false;
  private points: TouchPoint[] = [];
  private viewport: TouchViewport = { x: 0, y: 0, zoom: 1 };

  reset() {
    this.active = false;
    this.points = [];
  }

  sample(points: TouchPoint[], viewport: TouchViewport): TouchViewport | null {
    const next = points
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((a, b) => a.id - b.id)
      .slice(0, 2);
    if (!next.length) {
      this.reset();
      return null;
    }
    if (!this.active && next.length < 2) return null;
    if (
      !this.active ||
      next.length !== this.points.length ||
      next.some((point, index) => point.id !== this.points[index].id)
    ) {
      this.active = true;
      this.points = next;
      this.viewport = { ...viewport };
      return null;
    }
    const before = center(this.points);
    const after = center(next);
    const span = distance(this.points);
    // Coincident fingers have no meaningful scale; rebase once they separate.
    if (next.length === 2 && span < 1) {
      this.points = next;
      this.viewport = { ...viewport };
      return null;
    }
    const zoom = Math.max(
      0.25,
      Math.min(2, this.viewport.zoom * (span ? distance(next) / span : 1)),
    );
    return {
      zoom,
      x: after.x - ((before.x - this.viewport.x) * zoom) / this.viewport.zoom,
      y: after.y - ((before.y - this.viewport.y) * zoom) / this.viewport.zoom,
    };
  }
}
