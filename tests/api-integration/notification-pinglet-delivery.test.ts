import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import "../../apps/api/src/notification";
import db, { schema } from "../../apps/api/src/database";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  upsertWorkspaceRule,
} from "../../apps/api/src/notification-preferences/service";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import { sendOutboundRequest } from "../../apps/api/src/utils/outbound-request";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

vi.mock("../../apps/api/src/utils/outbound-request", async (original) => ({
  ...(await original<object>()),
  sendOutboundRequest: vi.fn(async () => new Response(null, { status: 200 })),
}));

vi.mock("../../apps/api/src/events", async (original) => {
  const events = await original<typeof import("../../apps/api/src/events")>();
  return {
    ...events,
    publishEvent: (...args: Parameters<typeof events.publishEvent>) =>
      events.publishEvent(args[0], args[1], { waitForHandlers: true }),
  };
});

afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "notification-test-key");
  await resetTestDatabase();
  vi.clearAllMocks();
});

async function fixture(preference: { webhookUrl?: string }) {
  const actor = await createWorkspaceMember();
  const recipient = await createWorkspaceMember();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: actor.workspace.id,
    userId: recipient.user.id,
    joinedAt: new Date(),
  });
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Ship it",
      userId: recipient.user.id,
      status: "to-do",
      number: 42,
    })
    .returning();
  await db.insert(schema.userNotificationPreferenceTable).values({
    userId: recipient.user.id,
    pingletEnabled: true,
    pingletNamespace: "acme",
    pingletTopic: "kaneo",
    pingletToken: encryptSecret("pk_test_key"),
    webhookEnabled: Boolean(preference.webhookUrl),
    webhookUrl: preference.webhookUrl ?? null,
    taskStatusChangeEnabled: true,
  });
  await db.insert(schema.userNotificationWorkspaceRuleTable).values({
    userId: recipient.user.id,
    workspaceId: actor.workspace.id,
    isActive: true,
    projectMode: "all",
    pingletEnabled: true,
    webhookEnabled: Boolean(preference.webhookUrl),
  });
  return { actor, recipient, project, task };
}

describe("Pinglet delivery", () => {
  it("publishes through Pinglet's Kaneo rewrite with the ticket id and without the recipient", async () => {
    const { actor, project, task } = await fixture({});

    await updateTaskStatus({
      id: task.id,
      status: "in-progress",
      currentUserId: actor.user.id,
    });

    await vi.waitFor(() =>
      expect(sendOutboundRequest).toHaveBeenCalledTimes(1),
    );
    const [url, init] = vi.mocked(sendOutboundRequest).mock.calls[0];
    expect(url).toBe("https://pinglet.dev/v1/acme/kaneo/publish?rewrite=kaneo");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer pk_test_key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body.notification.type).toBe("task_status_changed");
    expect(body.project.name).toBe(project.name);
    expect(body.task).toMatchObject({
      id: task.id,
      title: "Ship it",
      key: `${project.slug.toUpperCase()}-42`,
      number: 42,
    });
    expect(body).not.toHaveProperty("user");
  });

  it("adds the ticket id to the generic webhook too", async () => {
    const { actor, project, recipient, task } = await fixture({
      webhookUrl: "https://hooks.example/kaneo",
    });

    await updateTaskStatus({
      id: task.id,
      status: "in-progress",
      currentUserId: actor.user.id,
    });

    await vi.waitFor(() =>
      expect(sendOutboundRequest).toHaveBeenCalledTimes(2),
    );
    const calls = vi.mocked(sendOutboundRequest).mock.calls;
    const urls = calls.map(([url]) => url);
    expect(urls).toContain(
      "https://pinglet.dev/v1/acme/kaneo/publish?rewrite=kaneo",
    );
    const webhook = calls.find(
      ([url]) => url === "https://hooks.example/kaneo",
    );
    const body = JSON.parse(String(webhook?.[1].body));
    expect(body.task.key).toBe(`${project.slug.toUpperCase()}-42`);
    expect(body.user.id).toBe(recipient.user.id);
  });
});

describe("Pinglet settings", () => {
  it("needs a namespace, topic and API key, and never returns the key", async () => {
    const { recipient } = await fixture({});
    await db
      .delete(schema.userNotificationPreferenceTable)
      .where(
        eq(schema.userNotificationPreferenceTable.userId, recipient.user.id),
      );

    await expect(
      updateNotificationPreferences(recipient.user.id, null, {
        pingletEnabled: true,
        pingletNamespace: "acme",
        pingletTopic: "kaneo",
      }),
    ).rejects.toThrow("Pinglet requires a namespace, topic and API key");

    await expect(
      updateNotificationPreferences(recipient.user.id, null, {
        pingletEnabled: true,
        pingletNamespace: "acme/other",
        pingletTopic: "kaneo",
        pingletToken: "pk_secret_value",
      }),
    ).rejects.toThrow("letters, numbers");

    const saved = await updateNotificationPreferences(recipient.user.id, null, {
      pingletEnabled: true,
      pingletNamespace: " acme ",
      pingletTopic: "kaneo",
      pingletToken: "pk_secret_value",
    });
    expect(saved).toMatchObject({
      pingletEnabled: true,
      pingletConfigured: true,
      pingletNamespace: "acme",
      pingletTopic: "kaneo",
      pingletTokenConfigured: true,
      maskedPingletToken: "pk_s…alue",
    });
    expect(JSON.stringify(saved)).not.toContain("pk_secret_value");

    const [row] = await db
      .select({ token: schema.userNotificationPreferenceTable.pingletToken })
      .from(schema.userNotificationPreferenceTable)
      .where(
        eq(schema.userNotificationPreferenceTable.userId, recipient.user.id),
      );
    expect(row?.token).not.toContain("pk_secret_value");
  });

  it("keeps a rule's Pinglet switch when an older client leaves it out, and clears it on disconnect", async () => {
    const { actor, recipient } = await fixture({});
    const ruleInput = {
      isActive: true,
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
      projectMode: "all" as const,
    };

    await upsertWorkspaceRule(
      recipient.user.id,
      actor.workspace.id,
      null,
      ruleInput,
    );
    let prefs = await getNotificationPreferences(recipient.user.id, null);
    expect(prefs.workspaces[0]?.pingletEnabled).toBe(true);

    prefs = await updateNotificationPreferences(recipient.user.id, null, {
      pingletEnabled: false,
      pingletNamespace: null,
      pingletTopic: null,
      pingletToken: null,
    });
    expect(prefs.pingletConfigured).toBe(false);
    expect(prefs.workspaces[0]?.pingletEnabled).toBe(false);
  });
});
