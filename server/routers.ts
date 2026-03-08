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
import { analyzeProduct } from "./services/analysisEngine";

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
});

export type AppRouter = typeof appRouter;
