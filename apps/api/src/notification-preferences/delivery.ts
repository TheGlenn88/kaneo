import { createHmac } from "node:crypto";
import { sendNotificationEmail } from "@kaneo/email";
import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { canReceiveResourceNotification } from "../notification/resource-access";
import {
  safeOutboundError,
  sendOutboundRequest,
} from "../utils/outbound-request";
import { getLocalizedDeliveryContent } from "./delivery-copy";
import { queueForEmailDigest } from "./email-digest/queue";
import { resolveEmailTask } from "./resolve-email-task";
import { decryptSecret } from "./secrets";

type ResolvedNotificationContext = {
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  /** The ticket id people know the task by, e.g. "WEB-42". */
  taskKey: string | null;
  taskNumber: number | null;
  taskUrl: string | null;
};

type DeliveryContent = {
  title: string;
  body: string;
};

export function getClientUrl() {
  return process.env.KANEO_CLIENT_URL || "http://localhost:5173";
}

function buildTaskUrl(workspaceId: string, projectId: string, taskId: string) {
  return `${getClientUrl()}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}

export function buildTaskKey(
  projectSlug: string | null | undefined,
  taskNumber: number | null | undefined,
) {
  if (!projectSlug || taskNumber === null || taskNumber === undefined) {
    return null;
  }
  return `${projectSlug.toUpperCase()}-${taskNumber}`;
}

function getStringValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

function getNumberValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
}

function formatLeadTime(minutes: number | null) {
  if (!minutes) return "soon";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `in ${minutes} minutes`;
}

export function buildDeliveryContent(
  notification: {
    type: string;
    content: string | null;
    title: string | null;
    eventData: Record<string, unknown> | null;
  },
  locale: string | null,
): DeliveryContent {
  if (notification.title && notification.content) {
    return {
      title: notification.title,
      body: notification.content,
    };
  }

  if (notification.eventData) {
    const localized = getLocalizedDeliveryContent(
      notification.type,
      notification.eventData,
      locale,
    );
    if (localized) return localized;
  }

  switch (notification.type) {
    case "task_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "New task created",
        body: taskTitle
          ? `A new task was created: ${taskTitle}`
          : "A new task was created in Kaneo.",
      };
    }
    case "workspace_created": {
      const workspaceName = getStringValue(
        notification.eventData,
        "workspaceName",
      );
      return {
        title: "Workspace created",
        body: workspaceName
          ? `Workspace created: ${workspaceName}`
          : "A new workspace was created in Kaneo.",
      };
    }
    case "task_status_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const oldStatus = getStringValue(notification.eventData, "oldStatus");
      const newStatus = getStringValue(notification.eventData, "newStatus");
      return {
        title: "Task status changed",
        body:
          taskTitle && oldStatus && newStatus
            ? `${taskTitle} moved from ${oldStatus} to ${newStatus}.`
            : "A task status changed in Kaneo.",
      };
    }
    case "task_assignee_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task assigned to you",
        body: taskTitle
          ? `You were assigned to ${taskTitle}.`
          : "A task was assigned to you in Kaneo.",
      };
    }
    case "time_entry_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Time entry created",
        body: taskTitle
          ? `A time entry was created for ${taskTitle}.`
          : "A time entry was created in Kaneo.",
      };
    }
    case "due_date_reminder": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const label = formatLeadTime(
        getNumberValue(notification.eventData, "leadTimeMinutes"),
      );
      return {
        title: "Task due soon",
        body: taskTitle
          ? `"${taskTitle}" is due ${label}.`
          : `A task is due ${label}.`,
      };
    }
    case "task_overdue": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task overdue",
        body: taskTitle
          ? `"${taskTitle}" is past its due date.`
          : "A task is past its due date.",
      };
    }
    case "task_mention": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const mentionerName = getStringValue(
        notification.eventData,
        "mentionerName",
      );
      return {
        title: mentionerName
          ? `${mentionerName} mentioned you`
          : "You were mentioned",
        body: taskTitle
          ? `You were mentioned in ${taskTitle}.`
          : "You were mentioned in a Kaneo task.",
      };
    }
    case "task_comment": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const commenterName = getStringValue(
        notification.eventData,
        "commenterName",
      );
      return {
        title: commenterName
          ? `${commenterName} commented on your task`
          : "New task comment",
        body: taskTitle
          ? `A new comment was added to ${taskTitle}.`
          : "A new comment was added to a Kaneo task.",
      };
    }
    default:
      return {
        title: notification.title ?? "New Kaneo notification",
        body: notification.content ?? "You have a new notification in Kaneo.",
      };
  }
}

export async function resolveNotificationContext(notification: {
  resourceType: string | null;
  resourceId: string | null;
}): Promise<ResolvedNotificationContext | null> {
  if (!notification.resourceType || !notification.resourceId) {
    return null;
  }

  if (notification.resourceType === "task") {
    const [task] = await db
      .select({
        taskId: taskTable.id,
        taskTitle: taskTable.title,
        taskNumber: taskTable.number,
        projectId: projectTable.id,
        projectSlug: projectTable.slug,
        projectName: projectTable.name,
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(eq(taskTable.id, notification.resourceId))
      .limit(1);

    if (!task) {
      return null;
    }

    return {
      workspaceId: task.workspaceId,
      workspaceName: task.workspaceName,
      projectId: task.projectId,
      projectName: task.projectName,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      taskKey: buildTaskKey(task.projectSlug, task.taskNumber),
      taskNumber: task.taskNumber,
      taskUrl: buildTaskUrl(task.workspaceId, task.projectId, task.taskId),
    };
  }

  if (notification.resourceType === "workspace") {
    const [workspace] = await db
      .select({
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, notification.resourceId))
      .limit(1);

    if (!workspace) {
      return null;
    }

    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: null,
      taskKey: null,
      taskNumber: null,
      taskUrl: null,
    };
  }

  return null;
}

async function sendNtfyNotification(input: {
  serverUrl: string;
  topic: string;
  token?: string | null;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  await sendOutboundRequest(
    `${input.serverUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.topic)}`,
    {
      headers: {
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(input.clickUrl ? { Click: input.clickUrl } : {}),
        // fetch rejects header values outside Latin-1, so send non-ASCII titles RFC 2047 encoded; ntfy decodes them.
        Title: /^[\x20-\x7e]*$/.test(input.title)
          ? input.title
          : `=?UTF-8?B?${Buffer.from(input.title).toString("base64")}?=`,
      },
      body: input.body,
    },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

async function sendGotifyNotification(input: {
  serverUrl: string;
  token: string;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  // Gotify expects the app token in the query string; that can surface in logs, proxies, and browser history, so factor this into Gotify placement and log handling.
  await sendOutboundRequest(
    `${input.serverUrl.replace(/\/+$/, "")}/message?token=${encodeURIComponent(
      input.token,
    )}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        message: input.body,
        priority: 5,
        extras: input.clickUrl
          ? {
              "client::notification": {
                click: {
                  url: input.clickUrl,
                },
              },
              "client::display": {
                contentType: "text/plain",
              },
            }
          : undefined,
      }),
    },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

/**
 * Publish to a Pinglet topic through Pinglet's Kaneo rewrite
 * (`?rewrite=kaneo`), which reads the same payload as the generic webhook. The
 * rewrite is what marks the message as coming from Kaneo, so Pinglet's apps
 * show the Kaneo logo, put the project and ticket id in the header, stack
 * notifications per project and offer an "Open task" action.
 */
const PINGLET_URL = "https://pinglet.dev";

async function sendPingletNotification(input: {
  namespace: string;
  topic: string;
  token: string;
  payload: Record<string, unknown>;
}) {
  await sendOutboundRequest(
    `${PINGLET_URL}/v1/${encodeURIComponent(input.namespace)}/${encodeURIComponent(
      input.topic,
    )}/publish?rewrite=kaneo`,
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.payload),
    },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

async function sendWebhookNotification(input: {
  webhookUrl: string;
  secret?: string | null;
  payload: Record<string, unknown>;
}) {
  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.secret) {
    headers["X-Kaneo-Signature"] = createHmac("sha256", input.secret)
      .update(body)
      .digest("hex");
  }

  await sendOutboundRequest(
    input.webhookUrl,
    { headers, body },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

export async function deliverNotification(
  notificationId: string,
): Promise<void> {
  const notification = await db.query.notificationTable.findFirst({
    where: eq(notificationTable.id, notificationId),
  });

  if (
    !notification ||
    !(await canReceiveResourceNotification(
      notification.userId,
      notification.resourceId,
      notification.resourceType,
    ))
  ) {
    return;
  }

  const context = await resolveNotificationContext(notification);
  if (!context) {
    console.info("Notification delivery skipped: unresolved context", {
      notificationId,
      notificationTableId: notification.id,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      reason:
        "resolveNotificationContext returned null (missing resource, deleted task, or unsupported resource type)",
    });
    return;
  }

  const [user] = await db
    .select({
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, notification.userId))
    .limit(1);

  if (!user) {
    return;
  }

  const preference = await db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, notification.userId),
  });

  if (!preference) {
    return;
  }

  const decryptedPreference = {
    ...preference,
    ntfyToken: decryptSecret(preference.ntfyToken),
    gotifyToken: decryptSecret(preference.gotifyToken),
    pingletToken: decryptSecret(preference.pingletToken),
    webhookSecret: decryptSecret(preference.webhookSecret),
  };

  const rule = await db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, notification.userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, context.workspaceId),
    ),
    with: {
      selectedProjects: true,
    },
  });

  if (!rule?.isActive) {
    return;
  }

  if (
    rule.projectMode === "selected" &&
    (!context.projectId ||
      !rule.selectedProjects.some(
        (project) => project.projectId === context.projectId,
      ))
  ) {
    return;
  }

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
    user.locale ?? null,
  );

  // Pinglet gets the webhook payload without the recipient's email and name.
  const pingletPayload = {
    notification: {
      id: notification.id,
      type: notification.type,
      title: content.title,
      content: content.body,
      createdAt: notification.createdAt,
      eventData: notification.eventData,
      resourceId: notification.resourceId,
      resourceType: notification.resourceType,
    },
    workspace: {
      id: context.workspaceId,
      name: context.workspaceName,
    },
    project: context.projectId
      ? {
          id: context.projectId,
          name: context.projectName,
        }
      : null,
    task: context.taskId
      ? {
          id: context.taskId,
          title: context.taskTitle,
          key: context.taskKey,
          number: context.taskNumber,
          url: context.taskUrl,
        }
      : null,
  };
  const webhookPayload = {
    ...pingletPayload,
    user: {
      id: notification.userId,
      email: user.email,
      name: user.name,
    },
  };

  const deliveries: Array<Promise<void>> = [];

  if (
    decryptedPreference.emailEnabled &&
    rule.emailEnabled &&
    user.email &&
    preference.emailDigestEnabled
  ) {
    deliveries.push(queueForEmailDigest(notification.id));
  } else if (
    decryptedPreference.emailEnabled &&
    rule.emailEnabled &&
    user.email
  ) {
    const recipient = user.email;
    deliveries.push(
      (async () => {
        const task = context.taskId
          ? await resolveEmailTask(context.taskId)
          : undefined;
        await sendNotificationEmail(recipient, content.title, {
          title: content.title,
          message: content.body,
          actionUrl: context.taskUrl,
          locale: user.locale ?? null,
          breadcrumb: context.projectName
            ? `${context.workspaceName} / ${context.projectName}`
            : context.workspaceName,
          task,
          settingsUrl: `${getClientUrl()}/dashboard/settings/account/notifications`,
        });
      })(),
    );
  }

  if (
    decryptedPreference.ntfyEnabled &&
    decryptedPreference.ntfyServerUrl &&
    decryptedPreference.ntfyTopic &&
    rule.ntfyEnabled
  ) {
    deliveries.push(
      sendNtfyNotification({
        serverUrl: decryptedPreference.ntfyServerUrl,
        topic: decryptedPreference.ntfyTopic,
        token: decryptedPreference.ntfyToken,
        title: content.title,
        body: content.body,
        clickUrl: context.taskUrl,
      }),
    );
  }

  if (
    decryptedPreference.gotifyEnabled &&
    decryptedPreference.gotifyServerUrl &&
    decryptedPreference.gotifyToken &&
    rule.gotifyEnabled
  ) {
    deliveries.push(
      sendGotifyNotification({
        serverUrl: decryptedPreference.gotifyServerUrl,
        token: decryptedPreference.gotifyToken,
        title: content.title,
        body: content.body,
        clickUrl: context.taskUrl,
      }),
    );
  }

  if (
    decryptedPreference.pingletEnabled &&
    decryptedPreference.pingletNamespace &&
    decryptedPreference.pingletTopic &&
    decryptedPreference.pingletToken &&
    rule.pingletEnabled
  ) {
    deliveries.push(
      sendPingletNotification({
        namespace: decryptedPreference.pingletNamespace,
        topic: decryptedPreference.pingletTopic,
        token: decryptedPreference.pingletToken,
        payload: pingletPayload,
      }),
    );
  }

  if (
    decryptedPreference.webhookEnabled &&
    decryptedPreference.webhookUrl &&
    rule.webhookEnabled
  ) {
    deliveries.push(
      sendWebhookNotification({
        webhookUrl: decryptedPreference.webhookUrl,
        secret: decryptedPreference.webhookSecret,
        payload: webhookPayload,
      }),
    );
  }

  const results = await Promise.allSettled(deliveries);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Notification delivery failed", {
        notificationId,
        error: safeOutboundError(result.reason),
      });
    }
  }
}
