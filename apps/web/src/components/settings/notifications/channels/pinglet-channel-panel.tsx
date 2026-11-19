import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import type { NotificationPreferences } from "@/fetchers/notification-preferences/get-notification-preferences";
import { useUpdateNotificationPreferences } from "@/hooks/mutations/notification-preferences/use-notification-preferences";
import { ChannelField } from "./channel-field";
import { ChannelPanelFooter } from "./channel-panel-footer";
import { ChannelSendingRow } from "./channel-sending-row";

type PingletChannelPanelProps = {
  preferences: NotificationPreferences;
  onDisconnected: () => void;
};

export function PingletChannelPanel({
  preferences,
  onDisconnected,
}: PingletChannelPanelProps) {
  const { t } = useTranslation();
  const namespaceId = useId();
  const topicId = useId();
  const tokenId = useId();
  const { mutateAsync, isPending } = useUpdateNotificationPreferences();
  const configured = preferences.pingletConfigured;
  const [namespace, setNamespace] = useState(
    preferences.pingletNamespace ?? "",
  );
  const [topic, setTopic] = useState(preferences.pingletTopic ?? "");
  const [token, setToken] = useState("");
  const canSubmit =
    namespace.trim() !== "" &&
    topic.trim() !== "" &&
    (preferences.pingletTokenConfigured || token.trim() !== "");

  const submit = async () => {
    const saved = await mutateAsync({
      ...(configured ? {} : { pingletEnabled: true }),
      pingletNamespace: namespace,
      pingletTopic: topic,
      pingletToken: token.trim() ? token : undefined,
    }).then(
      () => true,
      () => false,
    );
    if (saved) setToken("");
  };

  const disconnect = async () => {
    await mutateAsync({
      pingletEnabled: false,
      pingletNamespace: null,
      pingletTopic: null,
      pingletToken: null,
    });
    onDisconnected();
  };

  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ChannelField
          id={namespaceId}
          label={t("settings:notificationsPage.pingletNamespace")}
        >
          <Input
            autoComplete="off"
            id={namespaceId}
            onChange={(event) => setNamespace(event.target.value)}
            placeholder={t(
              "settings:notificationsPage.pingletNamespacePlaceholder",
            )}
            size="sm"
            value={namespace}
          />
        </ChannelField>
        <ChannelField
          id={topicId}
          label={t("settings:notificationsPage.topic")}
        >
          <Input
            autoComplete="off"
            id={topicId}
            onChange={(event) => setTopic(event.target.value)}
            placeholder={t(
              "settings:notificationsPage.pingletTopicPlaceholder",
            )}
            size="sm"
            value={topic}
          />
        </ChannelField>
        <ChannelField
          className="sm:col-span-2"
          id={tokenId}
          label={t("settings:notificationsPage.pingletApiKey")}
          hint={
            preferences.pingletTokenConfigured
              ? t("settings:notificationsPage.pingletApiKeyHintConfigured", {
                  masked: preferences.maskedPingletToken ?? "••••",
                })
              : t("settings:notificationsPage.pingletApiKeyHint")
          }
        >
          <Input
            autoComplete="off"
            id={tokenId}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t(
              "settings:notificationsPage.pingletApiKeyPlaceholder",
            )}
            size="sm"
            type="password"
            value={token}
          />
        </ChannelField>
      </div>
      {configured ? (
        <ChannelSendingRow
          channel="pinglet"
          enabled={preferences.pingletEnabled}
        />
      ) : null}
      <ChannelPanelFooter
        channelName={t("settings:notificationsPage.pingletTitle")}
        configured={configured}
        onDisconnect={disconnect}
        submitDisabled={isPending || !canSubmit}
        submitLabel={
          configured
            ? t("settings:notificationsPage.saveChanges")
            : t("settings:notificationsPage.connectPinglet")
        }
      />
    </form>
  );
}
