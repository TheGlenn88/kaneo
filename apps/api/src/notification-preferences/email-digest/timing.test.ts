import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getEmailDigestTiming, isEmailDigestDue } from "./timing";

const MINUTE = 60 * 1000;
const timing = {
  quietMs: 10 * MINUTE,
  maxDelayMs: 60 * MINUTE,
  minIntervalMs: 30 * MINUTE,
};
const now = new Date("2026-11-14T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);

describe("isEmailDigestDue", () => {
  it("waits while notifications are still arriving", () => {
    expect(
      isEmailDigestDue(
        { oldestQueuedAt: ago(9), newestQueuedAt: ago(1), lastSentAt: null },
        now,
        timing,
      ),
    ).toBe(false);
  });

  it("sends once activity has been quiet long enough", () => {
    expect(
      isEmailDigestDue(
        { oldestQueuedAt: ago(14), newestQueuedAt: ago(10), lastSentAt: null },
        now,
        timing,
      ),
    ).toBe(true);
  });

  it("sends a steady trickle once the oldest item hits the max delay", () => {
    expect(
      isEmailDigestDue(
        { oldestQueuedAt: ago(60), newestQueuedAt: ago(2), lastSentAt: null },
        now,
        timing,
      ),
    ).toBe(true);
  });

  it("holds back a digest sent too soon after the last one", () => {
    expect(
      isEmailDigestDue(
        {
          oldestQueuedAt: ago(90),
          newestQueuedAt: ago(20),
          lastSentAt: ago(29),
        },
        now,
        timing,
      ),
    ).toBe(false);
    expect(
      isEmailDigestDue(
        {
          oldestQueuedAt: ago(90),
          newestQueuedAt: ago(20),
          lastSentAt: ago(30),
        },
        now,
        timing,
      ),
    ).toBe(true);
  });
});

describe("getEmailDigestTiming", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 10, 60 and 30 minutes", () => {
    expect(getEmailDigestTiming()).toEqual(timing);
  });

  it("reads overrides and ignores invalid values", () => {
    vi.stubEnv("NOTIFICATION_EMAIL_DIGEST_QUIET_MINUTES", "2");
    vi.stubEnv("NOTIFICATION_EMAIL_DIGEST_MAX_DELAY_MINUTES", "nope");
    vi.stubEnv("NOTIFICATION_EMAIL_DIGEST_MIN_INTERVAL_MINUTES", "0");
    expect(getEmailDigestTiming()).toEqual({
      quietMs: 2 * MINUTE,
      maxDelayMs: 60 * MINUTE,
      minIntervalMs: 0,
    });
  });
});
