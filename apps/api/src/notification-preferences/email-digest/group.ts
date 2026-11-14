import type { NotificationDigestGroup } from "@kaneo/email";

export type DigestEntry = {
  id: string;
  key: string;
  heading: string;
  breadcrumb?: string;
  url?: string | null;
  title: string;
  message: string;
};

// Entries arrive oldest first; groups keep the order of their first entry.
export function groupDigestEntries(
  entries: DigestEntry[],
): NotificationDigestGroup[] {
  const groups = new Map<string, NotificationDigestGroup>();
  for (const entry of entries) {
    let group = groups.get(entry.key);
    if (!group) {
      group = {
        id: entry.key,
        heading: entry.heading,
        breadcrumb: entry.breadcrumb,
        url: entry.url,
        items: [],
      };
      groups.set(entry.key, group);
    }
    group.items.push({
      id: entry.id,
      title: entry.title,
      message: entry.message,
    });
  }
  return [...groups.values()];
}
