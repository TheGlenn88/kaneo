import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import db, { schema } from "../../apps/api/src/database";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
import { runEmailDigests } from "../../apps/api/src/notification-preferences/email-digest/send-email-digests";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { sendEmail, sendDigest } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  sendDigest: vi.fn(async () => ({ success: true })),
}));
vi.mock("@kaneo/email", async (original) => ({
  ...(await original<object>()),
  sendNotificationEmail: sendEmail,
  sendNotificationDigestEmail: sendDigest,
  notificationDigestSubject: (count: number) => `${count} new notifications`,
}));

const MINUTE = 60 * 1000;
const timing = {
  quietMs: 10 * MINUTE,
  maxDelayMs: 60 * MINUTE,
  minIntervalMs: 30 * MINUTE,
};

async function fixture({ digest = true } = {}) {
  const { user, workspace } = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const tasks = await db
    .insert(schema.taskTable)
    .values(
      ["Fix login", "Ship digests", "Write docs"].map((title, index) => ({
        title,
        projectId: project.id,
        userId: user.id,
        columnId: columns.todo.id,
        status: columns.todo.slug,
        number: index + 1,
      })),
    )
    .returning();
  await db.insert(schema.userNotificationPreferenceTable).values({
    userId: user.id,
    emailEnabled: true,
    emailDigestEnabled: digest,
  });
  await db.insert(schema.userNotificationWorkspaceRuleTable).values({
    userId: user.id,
    workspaceId: workspace.id,
    isActive: true,
    emailEnabled: true,
  });

  const notify = async (taskIndex: number, isRead = false) => {
    const task = tasks[taskIndex];
    if (!task) throw new Error("missing task");
    const [notification] = await db
      .insert(schema.notificationTable)
      .values({
        userId: user.id,
        type: "task_comment",
        resourceType: "task",
        resourceId: task.id,
        isRead,
        eventData: { taskTitle: task.title, commenterName: "Pete" },
      })
      .returning();
    if (!notification) throw new Error("missing notification");
    await deliverNotification(notification.id);
    return notification;
  };

  const queuedCount = async () =>
    (
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, user.id))
    ).filter((row) => row.emailDigestQueuedAt).length;

  return { user, tasks, notify, queuedCount };
}

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * MINUTE);

describe("notification email digests", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    sendEmail.mockClear();
    sendDigest.mockClear();
  });

  it("still emails each notification when grouping is off", async () => {
    const { notify, queuedCount } = await fixture({ digest: false });
    await notify(0);
    await notify(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(await queuedCount()).toBe(0);
  });

  it("queues a burst and sends one grouped email once it goes quiet", async () => {
    const { user, notify, queuedCount } = await fixture();
    for (const index of [0, 1, 0, 2, 1]) {
      await notify(index);
    }
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedCount()).toBe(5);

    await runEmailDigests(minutesFromNow(5), timing);
    expect(sendDigest).not.toHaveBeenCalled();

    await runEmailDigests(minutesFromNow(11), timing);
    expect(sendDigest).toHaveBeenCalledTimes(1);
    const [to, subject, props] = sendDigest.mock.calls[0] as unknown as [
      string,
      string,
      { groups: Array<{ heading: string; items: unknown[] }> },
    ];
    expect(to).toBe(user.email);
    expect(subject).toBe("5 new notifications");
    expect(
      props.groups.map((group) => [group.heading, group.items.length]),
    ).toEqual([
      ["Fix login", 2],
      ["Ship digests", 2],
      ["Write docs", 1],
    ]);
    expect(await queuedCount()).toBe(0);

    await runEmailDigests(minutesFromNow(12), timing);
    expect(sendDigest).toHaveBeenCalledTimes(1);
  });

  it("leaves out notifications already read in the app", async () => {
    const { notify } = await fixture();
    await notify(0, true);
    await notify(1, true);
    await notify(2);

    await runEmailDigests(minutesFromNow(11), timing);
    expect(sendDigest).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.any(String),
      "Pete commented on your task",
      expect.objectContaining({ breadcrumb: expect.any(String) }),
    );
  });

  it("clears the queue without email when everything was read", async () => {
    const { notify, queuedCount } = await fixture();
    await notify(0, true);
    await runEmailDigests(minutesFromNow(11), timing);
    expect(sendDigest).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedCount()).toBe(0);
  });

  it("waits out the minimum gap before the next digest", async () => {
    const { notify, queuedCount } = await fixture();
    await notify(0);
    await notify(1);
    await runEmailDigests(minutesFromNow(11), timing);
    expect(sendDigest).toHaveBeenCalledTimes(1);

    await notify(2);
    await notify(0);
    await runEmailDigests(minutesFromNow(25), timing);
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(await queuedCount()).toBe(2);

    await runEmailDigests(minutesFromNow(42), timing);
    expect(sendDigest).toHaveBeenCalledTimes(2);
  });
});
