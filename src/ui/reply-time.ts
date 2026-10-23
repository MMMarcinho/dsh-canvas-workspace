/** Format a durable reply timestamp in the viewer's local calendar and 24-hour clock. */
export function formatReplyTime(
  value?: number,
  now = Date.now(),
): { short: string; full: string } | null {
  if (value === undefined || !Number.isFinite(value) || !Number.isFinite(now))
    return null;
  const date = new Date(value);
  const today = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(today.getTime()))
    return null;

  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  const full = `${date.getFullYear()}年${day}`;
  // Compare local calendar dates rather than elapsed milliseconds, which vary
  // across daylight-saving changes and near midnight.
  const calendarDay = (item: Date) =>
    Date.UTC(item.getFullYear(), item.getMonth(), item.getDate()) / 86_400_000;
  const daysAgo = calendarDay(today) - calendarDay(date);
  const short =
    daysAgo === 0
      ? time
      : daysAgo === 1
        ? `昨天 ${time}`
        : daysAgo === 2
          ? `前天 ${time}`
          : date.getFullYear() === today.getFullYear()
            ? day
            : full;
  return { short, full };
}
