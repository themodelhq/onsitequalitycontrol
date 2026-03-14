import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createProduct,
  getProductsByUserId,
  getAnalysisResultsByProductId,
  getAnalysisBatchesByUserId,
  createAnalysisBatch,
  updateAnalysisBatch,
  getNamingFormats,
  getProhibitedItems,
  getBlacklistedKeywords,
  getRestrictedBrands,
  getSensitiveCategories,
} from "./db";
import { analyzeProduct, runQualityChecksOnly } from "./services/analysisEngine";
import { scrapeProductUrl, fetchCatalogByKeyword, fetchCatalogByUrl, fetchCatalogBySkuList } from "./services/urlScraper";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // ============ PRODUCT ANALYSIS ROUTES ============

  analysis: router({
    /**
     * Upload and analyze products from file
     */
    uploadAndAnalyze: protectedProcedure
      .input(
        z.object({
          fileName: z.string(),
          products: z.array(
            z.object({
              sku: z.string(),
              name: z.string(),
              brand: z.string().optional(),
              category: z.string(),
              country: z.enum([
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
              ]),
              price: z.number().optional(),
              description: z.string().optional(),
              images: z.array(z.string()).optional(),
              seller: z.string().optional(),
              rating: z.number().optional(),
              totalRatings: z.number().optional(),
              url: z.string().optional(),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Create batch
        const batchResult = await createAnalysisBatch(
          ctx.user.id,
          input.fileName,
          input.products.length
        );

        const batchId = (batchResult as any).insertId || 1;

        // Analyze each product
        let productsAnalyzed = 0;
        let totalIssues = 0;
        const results: any[] = [];

        for (const productData of input.products) {
          try {
            // Create product record
            const productResult = await createProduct(ctx.user.id, productData);
            const productId = (productResult as any).insertId || 1;

            // Analyze product
            const analysis = await analyzeProduct(
              productId,
              productData,
              productData.country
            );

            results.push(analysis);
            productsAnalyzed++;
            totalIssues += analysis.summary.totalIssues;
          } catch (error) {
            console.error(`Error analyzing product ${productData.sku}:`, error);
          }
        }

        // Update batch status
        await updateAnalysisBatch(batchId, {
          status: "completed",
          productsAnalyzed,
          issuesFound: totalIssues,
          completedAt: new Date(),
        });

        return {
          batchId,
          productsAnalyzed,
          totalIssues,
          results,
        };
      }),

    /**
     * Get analysis results for a product
     */
    getProductResults: protectedProcedure
      .input(z.object({ productId: z.number() }))
      .query(async ({ input }) => {
        const results = await getAnalysisResultsByProductId(input.productId);
        return results;
      }),

    /**
     * Get all analysis batches for user
     */
    getBatches: protectedProcedure.query(async ({ ctx }) => {
      const batches = await getAnalysisBatchesByUserId(ctx.user.id);
      return batches;
    }),

    /**
     * Get user's products
     */
    getProducts: protectedProcedure
      .input(
        z.object({
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ ctx, input }) => {
        const products = await getProductsByUserId(ctx.user.id, input.limit, input.offset);
        return products;
      }),
  }),

  // ============ REFERENCE DATA ROUTES ============

  reference: router({
    /**
     * Get naming formats
     */
    getNamingFormats: publicProcedure.query(async () => {
      const formats = await getNamingFormats();
      return formats;
    }),

    /**
     * Get prohibited items
     */
    getProhibitedItems: publicProcedure.query(async () => {
      const items = await getProhibitedItems();
      return items;
    }),

    /**
     * Get blacklisted keywords
     */
    getBlacklistedKeywords: publicProcedure.query(async () => {
      const keywords = await getBlacklistedKeywords();
      return keywords;
    }),

    /**
     * Get restricted brands
     */
    getRestrictedBrands: publicProcedure.query(async () => {
      const brands = await getRestrictedBrands();
      return brands;
    }),

    /**
     * Get sensitive categories
     */
    getSensitiveCategories: publicProcedure.query(async () => {
      const categories = await getSensitiveCategories();
      return categories;
    }),
  }),

  // ============ EXPORT ROUTES ============

  export: router({
    /**
     * Generate export data for products with optional country filter
     */
    getExportData: protectedProcedure
      .input(
        z.object({
          country: z.string().optional(),
          batchId: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const products = await getProductsByUserId(ctx.user.id, 1000, 0);
        const filtered = input.country
          ? products.filter((p: any) => p.country === input.country)
          : products;

        return {
          products: filtered,
          generatedAt: new Date(),
          totalCount: filtered.length,
        };
      }),
  }),

  // ============ PRODUCT SEARCH (keyword / URL / SKU) ============
  //
  // Mirrors testfinder exactly: each procedure fetches ONE page per call,
  // the client loops page-by-page. All errors are caught and returned as
  // { products: [], error: "..." } — never thrown.

  productSearch: router({
    /**
     * Keyword search — ONE catalog page per call (client loops).
     */
    byKeyword: publicProcedure
      .input(
        z.object({
          keyword: z.string().min(1),
          country: z.string().default("NG"),
          page: z.number().min(1).default(1),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const { products, hasMore } = await fetchCatalogByKeyword(
            input.keyword,
            input.country,
            1,
            input.page
          );
          return { products, hasMore, error: null };
        } catch (err) {
          return { products: [], hasMore: false, error: err instanceof Error ? err.message : "Unknown error" };
        }
      }),

    /**
     * URL search — ONE catalog page per call (client loops).
     */
    byUrl: publicProcedure
      .input(
        z.object({
          url: z.string().url(),
          country: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const { products, hasMore } = await fetchCatalogByUrl(input.url, input.country);
          return { products, hasMore, error: null };
        } catch (err) {
          return { products: [], hasMore: false, error: err instanceof Error ? err.message : "Unknown error" };
        }
      }),

    /**
     * SKU search — one search per SKU, all done in one call.
     */
    bySku: publicProcedure
      .input(
        z.object({
          skus: z.array(z.string()).min(1).max(200),
          country: z.string().default("NG"),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const products = await fetchCatalogBySkuList(input.skus, input.country);
          return { products, error: null };
        } catch (err) {
          return { products: [], error: err instanceof Error ? err.message : "Unknown error" };
        }
      }),
  }),

  // ============ QUALITY CHECK BY URL ============

  qualityCheck: router({
    checkUrl: publicProcedure
      .input(
        z.object({
          url: z.string().url(),
          country: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const scrapeResult = await scrapeProductUrl(input.url, input.country);

          if (!scrapeResult.ok) {
            return {
              ok: false as const,
              errorCode: scrapeResult.errorCode,
              errorMessage: scrapeResult.errorMessage,
              product: null,
              issues: [] as any[],
              summary: null,
            };
          }

          const p = scrapeResult.product;

          const productInput = {
            sku: p.sku,
            name: p.name,
            brand: p.brand,
            category: p.category,
            country: p.country,
            price: p.price,
            description: p.descriptionHtml || p.description,
            images: p.images,
            seller: p.seller,
            rating: p.rating,
            totalRatings: p.totalRatings,
            url: p.url,
          };

          const { issues, summary } = await runQualityChecksOnly(productInput, p.country);

          if (p.suspiciousPrice) {
            const sp = p.suspiciousPrice;
            const pct = Math.round(sp.ratioToFloor * 100);
            const severity: "critical" | "high" = sp.ratioToFloor < 0.4 ? "critical" : "high";
            issues.push({
              type: "suspicious_price",
              severity,
              message: `Price (${sp.listedPriceLocal.toLocaleString()} ${sp.currency} ≈ $${sp.listedPriceUSD} USD) is only ${pct}% of the typical genuine "${sp.brandMatched}" market floor ($${sp.floorPriceUSD} USD) — possible counterfeit`,
              details: sp as any,
            });
            summary.totalIssues++;
            if (severity === "critical") summary.criticalIssues++;
            else summary.highIssues++;
          }

          return {
            ok: true as const,
            errorCode: null,
            errorMessage: null,
            product: {
              sku: p.sku,
              name: p.name,
              brand: p.brand,
              category: p.category,
              country: p.country,
              price: p.price,
              currency: p.currency,
              imageCount: p.images.length,
              thumbnailImage: p.thumbnailImage,
              description: p.description,
              keyFeatures: p.keyFeatures,
              specifications: p.specifications,
              hasDescriptionImages: p.hasDescriptionImages,
              seller: p.seller,
              rating: p.rating,
              totalRatings: p.totalRatings,
              url: p.url,
              suspiciousPrice: p.suspiciousPrice,
            },
            issues,
            summary,
          };
        } catch (err) {
          return {
            ok: false as const,
            errorCode: "FETCH_ERROR" as const,
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            product: null,
            issues: [] as any[],
            summary: null,
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
