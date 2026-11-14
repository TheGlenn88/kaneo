const MINUTE_MS = 60 * 1000;

export type EmailDigestTiming = {
  quietMs: number;
  maxDelayMs: number;
  minIntervalMs: number;
};

function readMinutes(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name]?.trim() || "", 10);
  return (
    (Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback) * MINUTE_MS
  );
}

export function getEmailDigestTiming(): EmailDigestTiming {
  return {
    quietMs: readMinutes("NOTIFICATION_EMAIL_DIGEST_QUIET_MINUTES", 10),
    maxDelayMs: readMinutes("NOTIFICATION_EMAIL_DIGEST_MAX_DELAY_MINUTES", 60),
    minIntervalMs: readMinutes(
      "NOTIFICATION_EMAIL_DIGEST_MIN_INTERVAL_MINUTES",
      30,
    ),
  };
}

// Send once activity has paused for quietMs, or the oldest item has waited
// maxDelayMs, but never sooner than minIntervalMs after the previous digest.
export function isEmailDigestDue(
  queue: {
    oldestQueuedAt: Date;
    newestQueuedAt: Date;
    lastSentAt: Date | null;
  },
  now: Date,
  timing: EmailDigestTiming,
) {
  const nowMs = now.getTime();
  if (
    queue.lastSentAt &&
    nowMs - queue.lastSentAt.getTime() < timing.minIntervalMs
  ) {
    return false;
  }
  return (
    nowMs - queue.newestQueuedAt.getTime() >= timing.quietMs ||
    nowMs - queue.oldestQueuedAt.getTime() >= timing.maxDelayMs
  );
}
