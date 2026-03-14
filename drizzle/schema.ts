import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
  longtext,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Products table - stores product data for analysis
 */
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  sku: varchar("sku", { length: 255 }).notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  brand: varchar("brand", { length: 255 }),
  category: varchar("category", { length: 255 }).notNull(),
  country: mysqlEnum("country", [
    "NG",
    "EG",
    "MA",
    "KE",
    "UG",
    "GH",
    "CI",
    "TN",
    "SN",
    "DZ",
    "IC",
  ]).notNull(),
  price: decimal("price", { precision: 12, scale: 2 }),
  oldPrice: decimal("oldPrice", { precision: 12, scale: 2 }),
  description: longtext("description"),
  seller: varchar("seller", { length: 255 }),
  isJumiaExpress: boolean("isJumiaExpress").default(false),
  isShopGlobal: boolean("isShopGlobal").default(false),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  totalRatings: int("totalRatings"),
  stock: varchar("stock", { length: 100 }),
  tags: text("tags"), // JSON array stored as text
  sourceUrl: varchar("sourceUrl", { length: 1000 }),
  rawData: json("rawData"), // Store original product data
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/**
 * Product images table - stores image URLs and analysis results
 */
export const productImages = mysqlTable("productImages", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  imageUrl: varchar("imageUrl", { length: 1000 }).notNull(),
  position: int("position"), // Order of image
  width: int("width"),
  height: int("height"),
  resolution: varchar("resolution", { length: 50 }), // e.g., "1920x1080"
  backgroundColorHex: varchar("backgroundColorHex", { length: 7 }), // e.g., "#FFFFFF"
  isWhiteBackground: boolean("isWhiteBackground"),
  isLowResolution: boolean("isLowResolution"),
  analysisStatus: mysqlEnum("analysisStatus", [
    "pending",
    "analyzing",
    "completed",
    "failed",
  ]).default("pending"),
  analysisError: text("analysisError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductImage = typeof productImages.$inferSelect;
export type InsertProductImage = typeof productImages.$inferInsert;

/**
 * Analysis results table - stores all quality issues found
 */
export const analysisResults = mysqlTable("analysisResults", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  issueType: mysqlEnum("issueType", [
    "poor_image_quality",
    "insufficient_images",
    "non_white_background",
    "poor_description",
    "missing_description_images",
    "naming_format_violation",
    "prohibited_item",
    "blacklisted_keyword",
    "restricted_brand",
    "wrong_category",
    "sensitive_category",
    "counterfeit_indicator",
  ]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).notNull(),
  country: mysqlEnum("country", [
    "NG",
    "EG",
    "MA",
    "KE",
    "UG",
    "GH",
    "CI",
    "TN",
    "SN",
    "DZ",
    "IC",
  ]).notNull(),
  details: json("details"), // Store detailed issue information
  recommendation: text("recommendation"),
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AnalysisResult = typeof analysisResults.$inferSelect;
export type InsertAnalysisResult = typeof analysisResults.$inferInsert;

/**
 * Analysis batches - track analysis runs
 */
export const analysisBatches = mysqlTable("analysisBatches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileName: varchar("fileName", { length: 500 }),
  totalProducts: int("totalProducts"),
  productsAnalyzed: int("productsAnalyzed").default(0),
  issuesFound: int("issuesFound").default(0),
  status: mysqlEnum("status", [
    "pending",
    "analyzing",
    "completed",
    "failed",
  ]).default("pending"),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AnalysisBatch = typeof analysisBatches.$inferSelect;
export type InsertAnalysisBatch = typeof analysisBatches.$inferInsert;

/**
 * Reference data - naming formats by category
 */
export const namingFormats = mysqlTable("namingFormats", {
  id: int("id").autoincrement().primaryKey(),
  categoryName: varchar("categoryName", { length: 255 }).notNull().unique(),
  format: text("format").notNull(),
  example: text("example"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NamingFormat = typeof namingFormats.$inferSelect;
export type InsertNamingFormat = typeof namingFormats.$inferInsert;

/**
 * Reference data - prohibited items
 */
export const prohibitedItems = mysqlTable("prohibitedItems", {
  id: int("id").autoincrement().primaryKey(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  category: varchar("category", { length: 255 }),
  countries: text("countries"), // JSON array of country codes
  status: mysqlEnum("status", [
    "blocked",
    "open",
    "licensed",
    "registered",
    "verified_sellers_only",
  ]).default("blocked"),
  details: json("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProhibitedItem = typeof prohibitedItems.$inferSelect;
export type InsertProhibitedItem = typeof prohibitedItems.$inferInsert;

/**
 * Reference data - blacklisted keywords
 */
export const blacklistedKeywords = mysqlTable("blacklistedKeywords", {
  id: int("id").autoincrement().primaryKey(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  category: varchar("category", { length: 255 }),
  countries: text("countries"), // JSON array of country codes
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default(
    "high"
  ),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BlacklistedKeyword = typeof blacklistedKeywords.$inferSelect;
export type InsertBlacklistedKeyword = typeof blacklistedKeywords.$inferInsert;

/**
 * Reference data - restricted brands
 */
export const restrictedBrands = mysqlTable("restrictedBrands", {
  id: int("id").autoincrement().primaryKey(),
  brand: varchar("brand", { length: 255 }).notNull(),
  category: varchar("category", { length: 255 }),
  countries: text("countries"), // JSON array of country codes
  restrictionType: mysqlEnum("restrictionType", [
    "blocked",
    "licensed",
    "registered",
    "verified_sellers_only",
  ]).default("blocked"),
  details: json("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RestrictedBrand = typeof restrictedBrands.$inferSelect;
export type InsertRestrictedBrand = typeof restrictedBrands.$inferInsert;

/**
 * Reference data - sensitive categories
 */
export const sensitiveCategories = mysqlTable("sensitiveCategories", {
  id: int("id").autoincrement().primaryKey(),
  categoryName: varchar("categoryName", { length: 255 }).notNull(),
  countries: text("countries"), // JSON array of country codes
  restrictions: text("restrictions"), // JSON object with restriction details
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SensitiveCategory = typeof sensitiveCategories.$inferSelect;
export type InsertSensitiveCategory = typeof sensitiveCategories.$inferInsert;
