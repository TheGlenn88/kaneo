import { Link, Text } from "react-email";
import React from "react";
import { EmailFooter } from "../components/email-footer";
import { EmailIntro } from "../components/email-intro";
import { EmailShell } from "../components/email-shell";
import { footerLinks } from "../components/footer-links";
import { Section } from "../components/section";
import { Spacer } from "../components/spacer";
import { colors } from "../components/tokens";
import {
  type EmailLocale,
  emailHtmlLang,
  resolveEmailLocale,
} from "./resolve-locale";

void React;

export type NotificationDigestItem = {
  id: string;
  title: string;
  message: string;
};

export type NotificationDigestGroup = {
  id: string;
  heading: string;
  breadcrumb?: string;
  url?: string | null;
  items: NotificationDigestItem[];
};

export type NotificationDigestEmailProps = {
  groups: NotificationDigestGroup[];
  locale?: string | null;
  settingsUrl?: string;
};

type DigestCopy = {
  title: (count: number) => string;
  subtitle: string;
  preview: string;
  footer: string;
  reason: string;
  manage: string;
};

const messages: Record<EmailLocale, DigestCopy> = {
  en: {
    title: (count) =>
      count === 1 ? "1 new notification" : `${count} new notifications`,
    subtitle: "Here is what happened since your last email.",
    preview: "Your Kaneo notification summary",
    footer: "Kaneo notification summary",
    reason: "You chose to get grouped email notifications.",
    manage: "Manage notifications",
  },
  de: {
    title: (count) =>
      count === 1
        ? "1 neue Benachrichtigung"
        : `${count} neue Benachrichtigungen`,
    subtitle: "Das ist seit deiner letzten E-Mail passiert.",
    preview: "Deine Kaneo-Benachrichtigungen im Überblick",
    footer: "Kaneo Benachrichtigungsübersicht",
    reason: "Du hast gebündelte E-Mail-Benachrichtigungen gewählt.",
    manage: "Benachrichtigungen verwalten",
  },
  vi: {
    title: (count) => `${count} thông báo mới`,
    subtitle: "Đây là những gì đã diễn ra kể từ email trước của bạn.",
    preview: "Tóm tắt thông báo Kaneo của bạn",
    footer: "Tóm tắt thông báo Kaneo",
    reason: "Bạn đã chọn nhận thông báo email theo nhóm.",
    manage: "Quản lý thông báo",
  },
  ja: {
    title: (count) => `${count} 件の新しい通知`,
    subtitle: "前回のメール以降の動きをまとめました。",
    preview: "Kaneo 通知のまとめ",
    footer: "Kaneo 通知まとめ",
    reason: "メール通知をまとめて受け取る設定になっています。",
    manage: "通知を管理",
  },
  "zh-tw": {
    title: (count) => `${count} 則新通知`,
    subtitle: "以下是自上一封郵件以來的動態。",
    preview: "你的 Kaneo 通知摘要",
    footer: "Kaneo 通知摘要",
    reason: "你選擇了合併寄送電子郵件通知。",
    manage: "管理通知",
  },
};

export function notificationDigestSubject(
  count: number,
  locale?: string | null,
) {
  return messages[resolveEmailLocale(locale)].title(count);
}

const NotificationDigestEmail = ({
  groups,
  locale,
  settingsUrl,
}: NotificationDigestEmailProps) => {
  const emailLocale = resolveEmailLocale(locale);
  const copy = messages[emailLocale];
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  const title = copy.title(count);

  return (
    <EmailShell
      title={title}
      preview={`${title}. ${copy.preview}`}
      lang={emailHtmlLang(emailLocale)}
    >
      <EmailIntro title={title} subtitle={copy.subtitle} />
      {groups.map((group) => (
        <Section key={group.id} style={groupStyle}>
          {group.breadcrumb ? (
            <Text style={breadcrumbStyle}>{group.breadcrumb}</Text>
          ) : null}
          <Text style={headingStyle}>
            {group.url ? (
              <Link href={group.url} style={headingLinkStyle}>
                {group.heading}
              </Link>
            ) : (
              group.heading
            )}
          </Text>
          {group.items.map((item) => (
            <Text key={item.id} style={itemStyle}>
              <strong>{item.title}</strong>
              <br />
              <span style={itemMessageStyle}>{item.message}</span>
            </Text>
          ))}
        </Section>
      ))}
      <Spacer size={40} />
      <EmailFooter
        title={copy.footer}
        reason={copy.reason}
        links={footerLinks(
          emailLocale,
          settingsUrl ? [{ label: copy.manage, href: settingsUrl }] : [],
        )}
      />
    </EmailShell>
  );
};

const groupStyle = {
  borderTop: `1px solid ${colors.border}`,
  padding: "16px 0 4px",
};

const breadcrumbStyle = {
  margin: "0 0 2px",
  color: colors.mutedForeground,
  fontSize: "13px",
  lineHeight: "18px",
};

const headingStyle = {
  margin: "0 0 8px",
  color: colors.foreground,
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "24px",
};

const headingLinkStyle = {
  color: colors.foreground,
  textDecoration: "underline",
};

const itemStyle = {
  margin: "0 0 12px",
  color: colors.foreground85,
  fontSize: "14px",
  lineHeight: "20px",
};

const itemMessageStyle = {
  color: colors.mutedForeground,
};

NotificationDigestEmail.PreviewProps = {
  locale: "en-US",
  settingsUrl:
    "https://cloud.kaneo.app/dashboard/settings/account/notifications",
  groups: [
    {
      id: "task-128",
      heading: "Redesign transactional emails",
      breadcrumb: "Acme / Website",
      url: "https://cloud.kaneo.app/acme/task/KAN-128",
      items: [
        {
          id: "notification-1",
          title: "Sarah Chen commented on your task",
          message: "A new comment was added to Redesign transactional emails.",
        },
        {
          id: "notification-2",
          title: "Sarah Chen mentioned you",
          message: "You were mentioned in Redesign transactional emails.",
        },
      ],
    },
    {
      id: "task-131",
      heading: "Fix login redirect",
      breadcrumb: "Acme / App",
      url: "https://cloud.kaneo.app/acme/task/KAN-131",
      items: [
        {
          id: "notification-3",
          title: "Task status changed",
          message: "Fix login redirect moved from To do to In progress.",
        },
      ],
    },
  ],
} as NotificationDigestEmailProps;

export default NotificationDigestEmail;
