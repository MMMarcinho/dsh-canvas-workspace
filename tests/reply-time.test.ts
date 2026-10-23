import test from "node:test";
import assert from "node:assert/strict";
import { formatReplyTime } from "../src/ui/reply-time";

function inZone(zone: string, run: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("reply labels use local calendar days and a zero-padded 24-hour clock", () => {
  inZone("Asia/Shanghai", () => {
    const now = Date.parse("2025-06-01T00:15:00+08:00");
    assert.deepEqual(
      formatReplyTime(Date.parse("2025-06-01T00:03:00+08:00"), now),
      {
        short: "00:03",
        full: "2025年6月1日 00:03",
      },
    );
    assert.equal(
      formatReplyTime(Date.parse("2025-05-31T23:58:00+08:00"), now)?.short,
      "昨天 23:58",
    );
    assert.equal(
      formatReplyTime(Date.parse("2025-05-30T09:04:00+08:00"), now)?.short,
      "前天 09:04",
    );
    assert.equal(
      formatReplyTime(Date.parse("2025-01-02T15:06:00+08:00"), now)?.short,
      "1月2日 15:06",
    );
  });
});

test("yesterday and the day before take precedence across a year boundary", () => {
  inZone("Asia/Shanghai", () => {
    const now = Date.parse("2025-01-01T00:05:00+08:00");
    assert.equal(
      formatReplyTime(Date.parse("2024-12-31T23:55:00+08:00"), now)?.short,
      "昨天 23:55",
    );
    assert.equal(
      formatReplyTime(Date.parse("2024-12-30T21:09:00+08:00"), now)?.short,
      "前天 21:09",
    );
    assert.equal(
      formatReplyTime(Date.parse("2024-12-29T21:09:00+08:00"), now)?.short,
      "2024年12月29日 21:09",
    );
  });
});

test("day boundaries remain calendar-based through daylight-saving changes", () => {
  inZone("America/New_York", () => {
    const now = Date.parse("2025-03-10T00:30:00-04:00");
    assert.equal(
      formatReplyTime(Date.parse("2025-03-09T23:30:00-04:00"), now)?.short,
      "昨天 23:30",
    );
    assert.equal(
      formatReplyTime(Date.parse("2025-03-08T23:30:00-05:00"), now)?.short,
      "前天 23:30",
    );
  });
});

test("future, absent and invalid timestamps have stable output", () => {
  inZone("UTC", () => {
    const now = Date.parse("2025-12-31T23:55:00Z");
    assert.equal(
      formatReplyTime(Date.parse("2026-01-01T00:05:00Z"), now)?.short,
      "2026年1月1日 00:05",
    );
    assert.equal(formatReplyTime(undefined, now), null);
    assert.equal(formatReplyTime(NaN, now), null);
    assert.equal(formatReplyTime(9e15, now), null);
  });
});
