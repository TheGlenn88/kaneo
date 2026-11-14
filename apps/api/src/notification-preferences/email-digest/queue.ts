import { eq, sql } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";

export async function queueForEmailDigest(notificationId: string) {
  await db
    .update(notificationTable)
    .set({
      emailDigestQueuedAt: new Date(),
      updatedAt: sql`${notificationTable.updatedAt}`,
    })
    .where(eq(notificationTable.id, notificationId));
}
