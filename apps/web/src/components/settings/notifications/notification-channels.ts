export type ExternalChannelId = "gotify" | "ntfy" | "pinglet" | "webhook";

export type NotificationChannelId = "email" | ExternalChannelId;

export type ChannelAvailability =
  | "available"
  | "paused"
  | "off"
  | "notConnected";

export type ChannelAvailabilityMap = Record<
  NotificationChannelId,
  ChannelAvailability
>;

export const NOTIFICATION_CHANNELS: NotificationChannelId[] = [
  "email",
  "gotify",
  "ntfy",
  "pinglet",
  "webhook",
];

export const CHANNEL_NAME_KEYS: Record<NotificationChannelId, string> = {
  email: "settings:notificationsPage.emailTitle",
  gotify: "settings:notificationsPage.gotifyTitle",
  ntfy: "settings:notificationsPage.ntfyTitle",
  pinglet: "settings:notificationsPage.pingletTitle",
  webhook: "settings:notificationsPage.webhookTitle",
};
