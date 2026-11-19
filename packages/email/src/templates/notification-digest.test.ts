import { render } from "react-email";
import { createElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import NotificationDigestEmail, {
  notificationDigestSubject,
} from "./notification-digest";

const groups = [
  {
    id: "task-1",
    heading: "Fix login redirect",
    breadcrumb: "Acme / App",
    url: "https://kaneo.example/task/1",
    items: [
      {
        id: "n1",
        title: "Pete commented on your task",
        message: "First comment.",
      },
      { id: "n2", title: "Pete mentioned you", message: "Second comment." },
    ],
  },
  {
    id: "task-2",
    heading: "Ship digest emails",
    items: [
      { id: "n3", title: "Task status changed", message: "Moved to Done." },
    ],
  },
];

describe("NotificationDigestEmail", () => {
  it("lists every notification under its task", async () => {
    const html = await render(
      createElement(NotificationDigestEmail, { groups, locale: "en-US" }),
    );
    expect(html).toContain("3 new notifications");
    expect(html).toContain('href="https://kaneo.example/task/1"');
    expect(html).toContain("Acme / App");
    expect(html).toContain("Pete mentioned you");
    expect(html).toContain("Moved to Done.");
  });

  it("localizes the subject and chrome", async () => {
    expect(notificationDigestSubject(1, "en")).toBe("1 new notification");
    expect(notificationDigestSubject(4, "de-DE")).toBe(
      "4 neue Benachrichtigungen",
    );
    const html = await render(
      createElement(NotificationDigestEmail, { groups, locale: "ja-JP" }),
    );
    expect(html).toContain("3 件の新しい通知");
  });
});
