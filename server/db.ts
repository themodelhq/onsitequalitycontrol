import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  products,
  productImages,
  analysisResults,
  analysisBatches,
  namingFormats,
  prohibitedItems,
  blacklistedKeywords,
  restrictedBrands,
  sensitiveCategories,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USER OPERATIONS ============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ PRODUCT OPERATIONS ============

export async function createProduct(userId: number, product: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const productData: any = {
    userId,
    sku: product.sku,
    name: product.name,
    brand: product.brand || null,
    category: product.category,
    country: product.country,
    price: product.price ? parseFloat(product.price) : null,
    oldPrice: product.oldPrice ? parseFloat(product.oldPrice) : null,
    description: product.description || null,
    seller: product.seller || null,
    isJumiaExpress: product.isJumiaExpress || false,
    isShopGlobal: product.isShopGlobal || false,
    rating: product.rating ? parseFloat(product.rating) : null,
    totalRatings: product.totalRatings || null,
    stock: product.stock || null,
    tags: product.tags ? JSON.stringify(product.tags) : null,
    sourceUrl: product.url || null,
    rawData: product,
  };

  const result = await (db.insert(products).values(productData) as any);

  return result;
}

export async function getProductsByUserId(userId: number, limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(products)
    .where(eq(products.userId, userId))
    .limit(limit)
    .offset(offset);
}

export async function getProductById(productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ============ PRODUCT IMAGE OPERATIONS ============

export async function createProductImage(productId: number, imageUrl: string, position: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(productImages).values({
    productId,
    imageUrl,
    position,
    analysisStatus: "pending",
  });
}

export async function getProductImages(productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId));
}

export async function updateProductImage(imageId: number, updates: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(productImages)
    .set(updates)
    .where(eq(productImages.id, imageId));
}

// ============ ANALYSIS RESULTS OPERATIONS ============

export async function createAnalysisResult(result: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(analysisResults).values(result);
}

export async function getAnalysisResultsByProductId(productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.productId, productId));
}

export async function getAnalysisResultsByBatch(userId: number, batchId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all products in this batch
  const batchProducts = await db
    .select()
    .from(products)
    .where(and(eq(products.userId, userId)));

  const productIds = batchProducts.map((p) => p.id);

  if (productIds.length === 0) return [];

  return db
    .select()
    .from(analysisResults)
    .where(inArray(analysisResults.productId, productIds));
}

export async function getAnalysisResultsByCountry(userId: number, country: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.country, country as any));
}

// ============ ANALYSIS BATCH OPERATIONS ============

export async function createAnalysisBatch(userId: number, fileName: string, totalProducts: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(analysisBatches).values({
    userId,
    fileName,
    totalProducts,
    status: "pending",
  });

  return result;
}

export async function updateAnalysisBatch(batchId: number, updates: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(analysisBatches)
    .set(updates)
    .where(eq(analysisBatches.id, batchId));
}

export async function getAnalysisBatchesByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(analysisBatches)
    .where(eq(analysisBatches.userId, userId));
}

// ============ REFERENCE DATA OPERATIONS ============

export async function getNamingFormats() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(namingFormats);
}

export async function getNamingFormatByCategory(categoryName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(namingFormats)
    .where(eq(namingFormats.categoryName, categoryName))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getProhibitedItems() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(prohibitedItems);
}

export async function getBlacklistedKeywords() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(blacklistedKeywords);
}

export async function getRestrictedBrands() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(restrictedBrands);
}

export async function getSensitiveCategories() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(sensitiveCategories);
}

// ============ SEED REFERENCE DATA ============

export async function seedNamingFormats(formats: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  for (const format of formats) {
    await db
      .insert(namingFormats)
      .values({
        categoryName: format.categoryName,
        format: format.format,
        example: format.example,
      })
      .onDuplicateKeyUpdate({
        set: {
          format: format.format,
          example: format.example,
        },
      });
  }
}

export async function seedProhibitedItems(items: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  for (const item of items) {
    await db
      .insert(prohibitedItems)
      .values({
        keyword: item.keyword,
        category: item.category || null,
        countries: item.countries ? JSON.stringify(item.countries) : null,
        status: item.status || "blocked",
        details: item.details || null,
      })
      .onDuplicateKeyUpdate({
        set: {
          category: item.category || null,
          countries: item.countries ? JSON.stringify(item.countries) : null,
          status: item.status || "blocked",
        },
      });
  }
}

export async function seedBlacklistedKeywords(keywords: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  for (const keyword of keywords) {
    await db
      .insert(blacklistedKeywords)
      .values({
        keyword: keyword.keyword,
        category: keyword.category || null,
        countries: keyword.countries ? JSON.stringify(keyword.countries) : null,
        severity: keyword.severity || "high",
      })
      .onDuplicateKeyUpdate({
        set: {
          category: keyword.category || null,
          countries: keyword.countries ? JSON.stringify(keyword.countries) : null,
          severity: keyword.severity || "high",
        },
      });
  }
}

export async function seedRestrictedBrands(brands: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  for (const brand of brands) {
    await db
      .insert(restrictedBrands)
      .values({
        brand: brand.brand,
        category: brand.category || null,
        countries: brand.countries ? JSON.stringify(brand.countries) : null,
        restrictionType: brand.restrictionType || "blocked",
        details: brand.details || null,
      })
      .onDuplicateKeyUpdate({
        set: {
          category: brand.category || null,
          countries: brand.countries ? JSON.stringify(brand.countries) : null,
          restrictionType: brand.restrictionType || "blocked",
        },
      });
  }
}

export async function seedSensitiveCategories(categories: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  for (const category of categories) {
    await db
      .insert(sensitiveCategories)
      .values({
        categoryName: category.categoryName,
        countries: category.countries ? JSON.stringify(category.countries) : null,
        restrictions: category.restrictions ? JSON.stringify(category.restrictions) : null,
      })
      .onDuplicateKeyUpdate({
        set: {
          countries: category.countries ? JSON.stringify(category.countries) : null,
          restrictions: category.restrictions ? JSON.stringify(category.restrictions) : null,
        },
      });
  }
}
