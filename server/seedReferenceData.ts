/**
 * Seed Reference Data (optional — only runs when a MySQL DB is connected)
 *
 * When no DB is available the in-memory reference data in referenceData.ts
 * is used directly, so this seeder is only needed to keep the DB in sync.
 */

import { getDb, seedProhibitedItems, seedBlacklistedKeywords, seedRestrictedBrands } from "./db";
import {
  getInMemoryProhibitedItems,
  getInMemoryBlacklistedKeywords,
  getInMemoryRestrictedBrands,
} from "./referenceData";

export async function seedReferenceDataIfNeeded(): Promise<void> {
  const db = await getDb();
  if (!db) {
    // In-memory data is already active — nothing to do
    console.log("[Seed] No database — using in-memory reference data (287 prohibited, 5652 keywords, 437 brands)");
    return;
  }

  try {
    const { prohibitedItems, blacklistedKeywords, restrictedBrands } = await import("../drizzle/schema");

    const [ep] = await db.select().from(prohibitedItems).limit(1);
    const [ek] = await db.select().from(blacklistedKeywords).limit(1);
    const [eb] = await db.select().from(restrictedBrands).limit(1);

    let seeded = false;

    if (!ep) {
      await seedProhibitedItems(getInMemoryProhibitedItems());
      console.log("[Seed] Inserted 287 prohibited items");
      seeded = true;
    }

    if (!ek) {
      const kws = getInMemoryBlacklistedKeywords();
      for (let i = 0; i < kws.length; i += 500) {
        await seedBlacklistedKeywords(kws.slice(i, i + 500));
      }
      console.log(`[Seed] Inserted ${kws.length} blacklisted keywords`);
      seeded = true;
    }

    if (!eb) {
      const brs = getInMemoryRestrictedBrands();
      for (let i = 0; i < brs.length; i += 200) {
        await seedRestrictedBrands(brs.slice(i, i + 200));
      }
      console.log(`[Seed] Inserted ${brs.length} restricted brands`);
      seeded = true;
    }

    if (!seeded) {
      console.log("[Seed] Reference data already in DB — no changes made");
    }
  } catch (err) {
    console.error("[Seed] Error:", err);
  }
}
