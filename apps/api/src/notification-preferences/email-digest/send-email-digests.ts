import {
  notificationDigestSubject,
  sendNotificationDigestEmail,
  sendNotificationEmail,
} from "@kaneo/email";
import { and, asc, eq, inArray, isNotNull, max, min, sql } from "drizzle-orm";
import db from "../../database";
import {
  notificationTable,
  userNotificationPreferenceTable,
  userTable,
} from "../../database/schema";
import { canReceiveResourceNotification } from "../../notification/resource-access";
import { withJobLease } from "../../scheduler/leader-lock";
import {
  buildDeliveryContent,
  getClientUrl,
  resolveNotificationContext,
} from "../delivery";
import { resolveEmailTask } from "../resolve-email-task";
import { type DigestEntry, groupDigestEntries } from "./group";
import {
  type EmailDigestTiming,
  getEmailDigestTiming,
  isEmailDigestDue,
} from "./timing";

const EMAIL_DIGEST_LEASE = "notification-email-digests";
const EMAIL_DIGEST_LEASE_MS = 5 * 60 * 1000;

export async function sendEmailDigests(now: Date = new Date()) {
  return withJobLease(
    EMAIL_DIGEST_LEASE,
    () => runEmailDigests(now, getEmailDigestTiming()),
    () => ({ degraded: false }),
    EMAIL_DIGEST_LEASE_MS,
  );
}

export async function runEmailDigests(now: Date, timing: EmailDigestTiming) {
  const queues = await db
    .select({
      userId: notificationTable.userId,
      oldestQueuedAt: min(notificationTable.emailDigestQueuedAt),
      newestQueuedAt: max(notificationTable.emailDigestQueuedAt),
      lastSentAt: userNotificationPreferenceTable.lastEmailDigestSentAt,
    })
    .from(notificationTable)
    .leftJoin(
      userNotificationPreferenceTable,
      eq(userNotificationPreferenceTable.userId, notificationTable.userId),
    )
    .where(isNotNull(notificationTable.emailDigestQueuedAt))
    .groupBy(
      notificationTable.userId,
      userNotificationPreferenceTable.lastEmailDigestSentAt,
    );

  let degraded = false;
  for (const queue of queues) {
    if (!queue.oldestQueuedAt || !queue.newestQueuedAt) continue;
    const due = isEmailDigestDue(
      {
        oldestQueuedAt: queue.oldestQueuedAt,
        newestQueuedAt: queue.newestQueuedAt,
        lastSentAt: queue.lastSentAt,
      },
      now,
      timing,
    );
    if (!due) continue;

    try {
      await sendDigestForUser(queue.userId, now);
    } catch (error) {
      degraded = true;
      console.error("Notification email digest failed", {
        userId: queue.userId,
        error,
      });
    }
  }

  return { degraded };
}

async function sendDigestForUser(userId: string, now: Date) {
  const queued = await db
    .select()
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        isNotNull(notificationTable.emailDigestQueuedAt),
      ),
    )
    .orderBy(asc(notificationTable.createdAt));

  const [user] = await db
    .select({ email: userTable.email, locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const preference = await db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, userId),
  });

  const locale = user?.locale ?? null;
  const entries: Array<
    DigestEntry & { taskId: string | null; breadcrumb: string }
  > = [];

  // Anything read in the app since it was queued has already been seen.
  if (user?.email && preference?.emailEnabled) {
    for (const notification of queued) {
      if (notification.isRead) continue;
      const canReceive = await canReceiveResourceNotification(
        notification.userId,
        notification.resourceId,
        notification.resourceType,
      );
      if (!canReceive) continue;
      const context = await resolveNotificationContext(notification);
      if (!context) continue;

      const content = buildDeliveryContent(
        {
          type: notification.type,
          title: notification.title ?? null,
          content: notification.content ?? null,
          eventData:
            notification.eventData && typeof notification.eventData === "object"
              ? (notification.eventData as Record<string, unknown>)
              : null,
        },
        locale,
      );
      const breadcrumb = context.projectName
        ? `${context.workspaceName} / ${context.projectName}`
        : context.workspaceName;

      entries.push({
        id: notification.id,
        key: context.taskId ?? `workspace:${context.workspaceId}`,
        heading: context.taskTitle ?? context.workspaceName,
        breadcrumb,
        url: context.taskUrl,
        title: content.title,
        message: content.body,
        taskId: context.taskId,
      });
    }
  }

  const settingsUrl = `${getClientUrl()}/dashboard/settings/account/notifications`;
  const [single] = entries;
  if (user?.email && entries.length === 1 && single) {
    await sendNotificationEmail(user.email, single.title, {
      title: single.title,
      message: single.message,
      actionUrl: single.url,
      locale,
      breadcrumb: single.breadcrumb,
      task: single.taskId ? await resolveEmailTask(single.taskId) : undefined,
      settingsUrl,
    });
  } else if (user?.email && entries.length > 1) {
    await sendNotificationDigestEmail(
      user.email,
      notificationDigestSubject(entries.length, locale),
      { groups: groupDigestEntries(entries), locale, settingsUrl },
    );
  }

  const queuedIds = queued.map((notification) => notification.id);
  if (queuedIds.length > 0) {
    await db
      .update(notificationTable)
      .set({
        emailDigestQueuedAt: null,
        updatedAt: sql`${notificationTable.updatedAt}`,
      })
      .where(inArray(notificationTable.id, queuedIds));
  }

  if (entries.length > 0 && preference) {
    await db
      .update(userNotificationPreferenceTable)
      .set({ lastEmailDigestSentAt: now, updatedAt: preference.updatedAt })
      .where(eq(userNotificationPreferenceTable.userId, userId));
  }
}
