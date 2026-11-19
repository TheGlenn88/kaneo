import type { NotificationPreferenceWorkspaceRule } from "@/fetchers/notification-preferences/get-notification-preferences";
import type { UpsertNotificationWorkspaceRuleRequest } from "@/fetchers/notification-preferences/upsert-notification-workspace-rule";
import type {
  ChannelAvailabilityMap,
  NotificationChannelId,
} from "../notification-channels";

export type WorkspaceRule = Pick<
  NotificationPreferenceWorkspaceRule,
  | "isActive"
  | "emailEnabled"
  | "gotifyEnabled"
  | "ntfyEnabled"
  | "pingletEnabled"
  | "webhookEnabled"
  | "projectMode"
  | "selectedProjectIds"
>;

export type WorkspaceRuleState = WorkspaceRule;

export const RULE_CHANNEL_KEYS = {
  email: "emailEnabled",
  gotify: "gotifyEnabled",
  ntfy: "ntfyEnabled",
  pinglet: "pingletEnabled",
  webhook: "webhookEnabled",
} as const satisfies Record<NotificationChannelId, keyof WorkspaceRule>;

export function createWorkspaceRuleState(
  rule: WorkspaceRule | undefined,
  availability: ChannelAvailabilityMap,
): WorkspaceRuleState {
  if (rule) {
    return {
      isActive: rule.isActive,
      emailEnabled: rule.emailEnabled,
      gotifyEnabled: rule.gotifyEnabled,
      ntfyEnabled: rule.ntfyEnabled,
      pingletEnabled: rule.pingletEnabled,
      webhookEnabled: rule.webhookEnabled,
      projectMode: rule.projectMode,
      selectedProjectIds: rule.selectedProjectIds,
    };
  }

  return {
    isActive: true,
    emailEnabled: availability.email === "available",
    gotifyEnabled: availability.gotify === "available",
    ntfyEnabled: availability.ntfy === "available",
    pingletEnabled: availability.pinglet === "available",
    webhookEnabled: availability.webhook === "available",
    projectMode: "all",
    selectedProjectIds: [],
  };
}

export function toWorkspaceRuleRequest(
  state: WorkspaceRuleState,
  availability: ChannelAvailabilityMap,
): UpsertNotificationWorkspaceRuleRequest {
  return {
    isActive: state.isActive,
    emailEnabled: state.emailEnabled && availability.email === "available",
    gotifyEnabled: state.gotifyEnabled && availability.gotify === "available",
    ntfyEnabled: state.ntfyEnabled && availability.ntfy === "available",
    pingletEnabled:
      state.pingletEnabled && availability.pinglet === "available",
    webhookEnabled:
      state.webhookEnabled && availability.webhook === "available",
    projectMode: state.projectMode,
    selectedProjectIds: state.selectedProjectIds,
  };
}
