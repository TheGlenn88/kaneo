import { LayersIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings/settings-row";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferences } from "@/fetchers/notification-preferences/get-notification-preferences";
import { useUpdateNotificationPreferences } from "@/hooks/mutations/notification-preferences/use-notification-preferences";

type EmailDigestRowProps = {
  preferences: NotificationPreferences;
};

export function EmailDigestRow({ preferences }: EmailDigestRowProps) {
  const { t } = useTranslation();
  const { mutate, isPending, variables } = useUpdateNotificationPreferences();
  const enabled = isPending
    ? (variables?.emailDigestEnabled ?? preferences.emailDigestEnabled)
    : preferences.emailDigestEnabled;

  return (
    <SettingsRow
      icon={<LayersIcon />}
      title={t("settings:notificationsPage.emailDigestTitle")}
      description={t("settings:notificationsPage.emailDigestDescription")}
    >
      <Switch
        aria-label={t("settings:notificationsPage.emailDigestToggleLabel")}
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(checked) => mutate({ emailDigestEnabled: checked })}
      />
    </SettingsRow>
  );
}
