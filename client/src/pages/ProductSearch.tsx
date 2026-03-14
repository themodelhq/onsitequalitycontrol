/**
 * Product Search — keyword / URL / SKU search across Jumia markets
 *
 * • Up to 10 independent search tabs, each with its own mode (keyword / URL / SKU),
 *   country, results table and quality-check data
 * • Runs the same quality checks as the Quality Checker on every result
 * • Export results to Excel (.xlsx) with full quality-check columns
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import * as XLSX from "xlsx";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Search,
  Download,
  Plus,
  X,
  Loader2,
  ShieldAlert,
  Star,
  Package,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTRIES = [
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "UG", name: "Uganda" },
  { code: "EG", name: "Egypt" },
  { code: "GH", name: "Ghana" },
  { code: "CI", name: "Côte d'Ivoire" },
  { code: "MA", name: "Morocco" },
  { code: "TN", name: "Tunisia" },
  { code: "SN", name: "Senegal" },
  { code: "DZ", name: "Algeria" },
  { code: "IC", name: "Canary Islands" },
];

const MAX_TABS = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

type SearchMode = "keyword" | "url" | "sku";

interface CatalogProduct {
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  oldPrice?: number;
  discount?: string;
  rating: number;
  totalRatings: number;
  image: string;
  url: string;
  seller: string;
  isJumiaExpress: boolean;
  isShopGlobal: boolean;
  stock: string;
  tags: string[];
  country: string;
}

interface QualityResult {
  qualityScore: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  totalIssues: number;
  topIssues: string[];   // human-readable summaries of the top 3 issues
}

interface EnrichedProduct extends CatalogProduct {
  quality?: QualityResult;
  qualityChecking?: boolean;
  qualityError?: string;
}

interface SearchTab {
  id: string;
  label: string;
  mode: SearchMode;
  country: string;
  keyword: string;
  urlInput: string;
  skuInput: string;
  pages: string;
  products: EnrichedProduct[];
  isSearching: boolean;
  progress: number;
  elapsed: number;
  error: string | null;
  hasMore: boolean;
  // filter state
  filterBrand: string;
  filterSeller: string;
  filterCategory: string;
  filterMinRating: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTab(id: string, index: number): SearchTab {
  return {
    id,
    label: `Search ${index}`,
    mode: "keyword",
    country: "NG",
    keyword: "",
    urlInput: "",
    skuInput: "",
    pages: "1",
    products: [],
    isSearching: false,
    progress: 0,
    elapsed: 0,
    error: null,
    hasMore: false,
    filterBrand: "all",
    filterSeller: "all",
    filterCategory: "all",
    filterMinRating: "0",
  };
}

function scoreColor(s: number) {
  if (s >= 80) return "text-green-600";
  if (s >= 60) return "text-amber-500";
  if (s >= 40) return "text-orange-500";
  return "text-red-600";
}

function scoreBadge(s: number) {
  if (s >= 80) return "bg-green-100 text-green-700 border-green-200";
  if (s >= 60) return "bg-amber-100 text-amber-700 border-amber-200";
  if (s >= 40) return "bg-orange-100 text-orange-700 border-orange-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function computeScore(c: number, h: number, m: number, l: number): number {
  return Math.max(0, Math.min(100, 100 - c * 25 - h * 12 - m * 6 - l * 2));
}

function escapeXlsx(v: any): string {
  return v === null || v === undefined ? "" : String(v);
}

// ─── Excel export ─────────────────────────────────────────────────────────────

function exportToExcel(products: EnrichedProduct[], tabLabel: string) {
  const headers = [
    "SKU", "Name", "Brand", "Category", "Price", "Old Price", "Discount",
    "Rating", "Total Ratings", "Seller", "Jumia Express", "Shop Global",
    "Image URL", "Product URL", "Stock", "Tags", "Country",
    // Quality columns
    "Quality Score", "Critical Issues", "High Issues", "Medium Issues",
    "Low Issues", "Total Issues", "Top Issues",
  ];

  const rows = products.map((p) => [
    escapeXlsx(p.sku),
    escapeXlsx(p.name),
    escapeXlsx(p.brand),
    escapeXlsx(p.category),
    p.price || "",
    p.oldPrice || "",
    escapeXlsx(p.discount),
    p.rating || "",
    p.totalRatings || "",
    escapeXlsx(p.seller),
    p.isJumiaExpress ? "Yes" : "No",
    p.isShopGlobal ? "Yes" : "No",
    escapeXlsx(p.image),
    escapeXlsx(p.url),
    escapeXlsx(p.stock),
    Array.isArray(p.tags) ? p.tags.join("; ") : "",
    escapeXlsx(p.country),
    p.quality?.qualityScore ?? "",
    p.quality?.criticalIssues ?? "",
    p.quality?.highIssues ?? "",
    p.quality?.mediumIssues ?? "",
    p.quality?.lowIssues ?? "",
    p.quality?.totalIssues ?? "",
    p.quality?.topIssues?.join(" | ") ?? "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Column widths
  ws["!cols"] = [
    { wch: 14 }, { wch: 40 }, { wch: 18 }, { wch: 25 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 },
    { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
    { wch: 40 }, { wch: 50 }, { wch: 12 }, { wch: 20 },
    { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 60 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabLabel.slice(0, 31));
  XLSX.writeFile(wb, `${tabLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProductSearchPage() {
  const [, navigate] = useLocation();
  const [tabs, setTabs] = useState<SearchTab[]>([makeTab("t1", 1)]);
  const [activeTab, setActiveTab] = useState("t1");
  const tabCounter = useRef(2);
  const timerRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const byKeywordMutation = trpc.productSearch.byKeyword.useMutation();
  const byUrlMutation = trpc.productSearch.byUrl.useMutation();
  const bySkuMutation = trpc.productSearch.bySku.useMutation();
  const checkUrlMutation = trpc.qualityCheck.checkUrl.useMutation();

  // ── Tab management ────────────────────────────────────────────────────────

  const addTab = () => {
    if (tabs.length >= MAX_TABS) {
      toast.error(`Maximum ${MAX_TABS} tabs allowed`);
      return;
    }
    const id = `t${tabCounter.current++}`;
    const newTab = makeTab(id, tabs.length + 1);
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(id);
  };

  const removeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (activeTab === id) setActiveTab(remaining[remaining.length - 1].id);
      return remaining;
    });
    clearInterval(timerRefs.current[id]);
    delete timerRefs.current[id];
  };

  const updateTab = useCallback(<K extends keyof SearchTab>(id: string, updates: Pick<SearchTab, K>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  // ── Timer ─────────────────────────────────────────────────────────────────

  const startTimer = (id: string) => {
    clearInterval(timerRefs.current[id]);
    const start = Date.now();
    timerRefs.current[id] = setInterval(() => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, elapsed: Math.floor((Date.now() - start) / 1000) } : t
        )
      );
    }, 1000);
  };

  const stopTimer = (id: string) => {
    clearInterval(timerRefs.current[id]);
    delete timerRefs.current[id];
  };

  useEffect(() => {
    return () => {
      Object.values(timerRefs.current).forEach(clearInterval);
    };
  }, []);

  // ── Quality check a product in a tab ──────────────────────────────────────

  const runQualityCheck = useCallback(
    async (tabId: string, productIdx: number, productUrl: string, country: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const products = [...t.products];
          products[productIdx] = { ...products[productIdx], qualityChecking: true };
          return { ...t, products };
        })
      );

      try {
        const res = await checkUrlMutation.mutateAsync({
          url: productUrl,
          country,
        });

        let quality: QualityResult;
        if (res.ok && res.summary) {
          const s = res.summary;
          quality = {
            qualityScore: computeScore(
              s.criticalIssues,
              s.highIssues,
              s.mediumIssues,
              s.lowIssues
            ),
            criticalIssues: s.criticalIssues,
            highIssues: s.highIssues,
            mediumIssues: s.mediumIssues,
            lowIssues: s.lowIssues,
            totalIssues: s.totalIssues,
            topIssues: (res.issues as any[])
              .slice(0, 3)
              .map((i: any) => `[${i.severity}] ${i.message}`),
          };
        } else {
          quality = {
            qualityScore: 0,
            criticalIssues: 0,
            highIssues: 0,
            mediumIssues: 0,
            lowIssues: 0,
            totalIssues: 0,
            topIssues: [(res as any).errorMessage || "Check failed"],
          };
        }

        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t;
            const products = [...t.products];
            products[productIdx] = { ...products[productIdx], quality, qualityChecking: false };
            return { ...t, products };
          })
        );
      } catch (err) {
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t;
            const products = [...t.products];
            products[productIdx] = {
              ...products[productIdx],
              qualityChecking: false,
              qualityError: err instanceof Error ? err.message : "Failed",
            };
            return { ...t, products };
          })
        );
      }
    },
    [checkUrlMutation]
  );

  // Run quality checks on all products in a tab sequentially
  const runAllQualityChecks = useCallback(
    async (tabId: string, products: CatalogProduct[]) => {
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        if (p.url) await runQualityCheck(tabId, i, p.url, p.country);
      }
    },
    [runQualityCheck]
  );

  // ── Search handlers ───────────────────────────────────────────────────────

  const handleSearch = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)!;
    updateTab(tabId, { isSearching: true, products: [], progress: 0, error: null, elapsed: 0 });
    startTimer(tabId);

    try {
      let raw: CatalogProduct[] = [];
      let hasMore = false;

      if (tab.mode === "keyword") {
        if (!tab.keyword.trim()) return;
        const res = await byKeywordMutation.mutateAsync({
          keyword: tab.keyword.trim(),
          country: tab.country,
          pages: parseInt(tab.pages) || 1,
        });
        if (res.error) throw new Error(res.error);
        raw = res.products as CatalogProduct[];
        hasMore = res.hasMore;
      } else if (tab.mode === "url") {
        if (!tab.urlInput.trim()) return;
        const res = await byUrlMutation.mutateAsync({
          url: tab.urlInput.trim(),
          country: tab.country,
          pages: parseInt(tab.pages) || 1,
        });
        if (res.error) throw new Error(res.error);
        raw = res.products as CatalogProduct[];
        hasMore = res.hasMore;
      } else {
        // sku
        if (!tab.skuInput.trim()) return;
        const skus = tab.skuInput
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (skus.length === 0) return;
        const res = await bySkuMutation.mutateAsync({
          skus,
          country: tab.country,
        });
        if (res.error) throw new Error(res.error);
        raw = res.products as CatalogProduct[];
      }

      updateTab(tabId, {
        products: raw,
        isSearching: false,
        progress: 100,
        hasMore,
        elapsed: 0,
      });
      stopTimer(tabId);

      if (raw.length === 0) {
        toast.info("No products found — try a different keyword or country");
      } else {
        toast.success(`Found ${raw.length} product${raw.length !== 1 ? "s" : ""}`);
        // Kick off quality checks in background
        runAllQualityChecks(tabId, raw);
      }
    } catch (err) {
      stopTimer(tabId);
      updateTab(tabId, {
        isSearching: false,
        error: err instanceof Error ? err.message : "Unknown error",
        progress: 0,
      });
      toast.error("Search failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  // ── Filtered products for a tab ───────────────────────────────────────────

  function getFiltered(tab: SearchTab): EnrichedProduct[] {
    return tab.products.filter((p) => {
      if (tab.filterBrand !== "all" && p.brand !== tab.filterBrand) return false;
      if (tab.filterSeller !== "all" && p.seller !== tab.filterSeller) return false;
      if (tab.filterCategory !== "all" && p.category !== tab.filterCategory) return false;
      if (tab.filterMinRating !== "0" && (p.rating || 0) < parseFloat(tab.filterMinRating)) return false;
      return true;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  const activeTabData = tabs.find((t) => t.id === activeTab)!;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Nav bar ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft size={14} /> Dashboard
            </button>
            <span className="text-gray-300">/</span>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-orange-500 rounded-md flex items-center justify-center">
                <Search size={12} className="text-white" />
              </div>
              <span className="font-semibold text-gray-900 text-sm">
                Product Search
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* ── Heading ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Product Search</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Search Jumia by keyword, catalog URL or SKU list — results include
            quality checks and can be exported to Excel. Up to {MAX_TABS} independent
            search tabs.
          </p>
        </div>

        {/* ── Tabs container ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Tab list */}
          <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
            <TabsList className="flex h-auto gap-1 bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all data-[state=active]:bg-white data-[state=active]:border-orange-300 data-[state=active]:text-orange-700 data-[state=inactive]:bg-gray-100 data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-500`}
                >
                  {tab.label}
                  {tab.products.length > 0 && (
                    <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">
                      {tab.products.length}
                    </span>
                  )}
                  {tab.isSearching && (
                    <Loader2 size={10} className="animate-spin text-orange-500" />
                  )}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => removeTab(tab.id, e)}
                      className="opacity-0 group-hover:opacity-100 ml-0.5 hover:text-red-500 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.length < MAX_TABS && (
              <button
                onClick={addTab}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-orange-600 border border-dashed border-gray-300 hover:border-orange-400 rounded-lg transition-all"
              >
                <Plus size={12} /> Add Tab
              </button>
            )}
          </div>

          {/* Tab content panels */}
          {tabs.map((tab) => {
            const filtered = getFiltered(tab);
            const uniqueBrands = Array.from(new Set(tab.products.map((p) => p.brand).filter(Boolean)));
            const uniqueSellers = Array.from(new Set(tab.products.map((p) => p.seller).filter(Boolean)));
            const uniqueCategories = Array.from(new Set(tab.products.map((p) => p.category).filter(Boolean)));
            const checkedCount = tab.products.filter((p) => p.quality).length;
            const avgScore =
              checkedCount > 0
                ? Math.round(
                    tab.products
                      .filter((p) => p.quality)
                      .reduce((s, p) => s + (p.quality!.qualityScore || 0), 0) / checkedCount
                  )
                : null;

            return (
              <TabsContent key={tab.id} value={tab.id} className="space-y-4">
                {/* ── Search controls ── */}
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  {/* Row 1: country, mode, pages */}
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Country</label>
                      <Select
                        value={tab.country}
                        onValueChange={(v) => updateTab(tab.id, { country: v })}
                      >
                        <SelectTrigger className="w-40 h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.map((c) => (
                            <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Search Mode</label>
                      <div className="flex border border-gray-200 rounded-lg p-1">
                        {(["keyword", "url", "sku"] as SearchMode[]).map((m) => (
                          <button
                            key={m}
                            onClick={() => updateTab(tab.id, { mode: m })}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                              tab.mode === m
                                ? "bg-orange-500 text-white shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            {m === "keyword" ? "Keyword" : m === "url" ? "URL" : "SKU List"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {tab.mode !== "sku" && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">
                          Pages to Fetch
                        </label>
                        <Select
                          value={tab.pages}
                          onValueChange={(v) => updateTab(tab.id, { pages: v })}
                        >
                          <SelectTrigger className="w-24 h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 5, 8, 10].map((n) => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Tab label editor */}
                    <div className="ml-auto">
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Tab Name</label>
                      <Input
                        value={tab.label}
                        onChange={(e) => updateTab(tab.id, { label: e.target.value })}
                        className="w-32 h-9 text-xs"
                        maxLength={24}
                      />
                    </div>
                  </div>

                  {/* Row 2: search input */}
                  {tab.mode === "keyword" && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter keyword, e.g. laptop, phone, shoes"
                        value={tab.keyword}
                        onChange={(e) => updateTab(tab.id, { keyword: e.target.value })}
                        onKeyDown={(e) =>
                          e.key === "Enter" && !tab.isSearching && handleSearch(tab.id)
                        }
                        className="flex-1 text-sm"
                      />
                      <Button
                        onClick={() => handleSearch(tab.id)}
                        disabled={tab.isSearching || !tab.keyword.trim()}
                        className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shrink-0"
                      >
                        {tab.isSearching ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Search size={14} />
                        )}
                        Search
                      </Button>
                    </div>
                  )}

                  {tab.mode === "url" && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="https://www.jumia.com.ng/catalog/?q=phone"
                        value={tab.urlInput}
                        onChange={(e) => updateTab(tab.id, { urlInput: e.target.value })}
                        onKeyDown={(e) =>
                          e.key === "Enter" && !tab.isSearching && handleSearch(tab.id)
                        }
                        className="flex-1 text-sm"
                      />
                      <Button
                        onClick={() => handleSearch(tab.id)}
                        disabled={tab.isSearching || !tab.urlInput.trim()}
                        className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shrink-0"
                      >
                        {tab.isSearching ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Search size={14} />
                        )}
                        Fetch
                      </Button>
                    </div>
                  )}

                  {tab.mode === "sku" && (
                    <div className="space-y-2">
                      <textarea
                        placeholder={"SKU001\nSKU002\nSKU003"}
                        value={tab.skuInput}
                        onChange={(e) => updateTab(tab.id, { skuInput: e.target.value })}
                        className="w-full h-28 p-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-y"
                      />
                      <Button
                        onClick={() => handleSearch(tab.id)}
                        disabled={tab.isSearching || !tab.skuInput.trim()}
                        className="bg-orange-500 hover:bg-orange-600 text-white gap-2 w-full"
                      >
                        {tab.isSearching ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Search size={14} />
                        )}
                        Search SKUs
                      </Button>
                    </div>
                  )}

                  {/* Progress */}
                  {(tab.isSearching || (tab.products.length > 0 && tab.progress > 0)) && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>
                          {tab.isSearching
                            ? "Fetching products…"
                            : `${tab.products.length} products found`}
                          {checkedCount > 0 && !tab.isSearching &&
                            ` · ${checkedCount}/${tab.products.length} quality checked`}
                        </span>
                        <span>
                          {tab.isSearching && `${tab.elapsed}s`}
                          {!tab.isSearching && tab.hasMore && " · more pages available"}
                        </span>
                      </div>
                      <Progress value={tab.progress} className="h-1.5" />
                    </div>
                  )}

                  {/* Error */}
                  {tab.error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertTriangle size={14} />
                      {tab.error}
                    </div>
                  )}
                </div>

                {/* ── Results ── */}
                {tab.products.length > 0 && (
                  <>
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Summary stats */}
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-600">
                          <strong>{filtered.length}</strong> products
                        </span>
                        {avgScore !== null && (
                          <span className={`text-xs rounded-full px-2.5 py-1 font-medium border ${scoreBadge(avgScore)}`}>
                            Avg score: {avgScore}/100
                          </span>
                        )}
                        {checkedCount < tab.products.length && (
                          <span className="text-xs bg-white border border-amber-200 rounded-full px-2.5 py-1 text-amber-600 flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" />
                            Checking quality ({checkedCount}/{tab.products.length})
                          </span>
                        )}
                      </div>

                      {/* Filters */}
                      <div className="flex gap-2 flex-wrap ml-auto">
                        {uniqueBrands.length > 0 && (
                          <Select
                            value={tab.filterBrand}
                            onValueChange={(v) => updateTab(tab.id, { filterBrand: v })}
                          >
                            <SelectTrigger className="h-8 text-xs w-32">
                              <SelectValue placeholder="Brand" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Brands</SelectItem>
                              {uniqueBrands.map((b) => (
                                <SelectItem key={b} value={b}>{b}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {uniqueSellers.length > 0 && (
                          <Select
                            value={tab.filterSeller}
                            onValueChange={(v) => updateTab(tab.id, { filterSeller: v })}
                          >
                            <SelectTrigger className="h-8 text-xs w-32">
                              <SelectValue placeholder="Seller" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Sellers</SelectItem>
                              {uniqueSellers.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {uniqueCategories.length > 0 && (
                          <Select
                            value={tab.filterCategory}
                            onValueChange={(v) => updateTab(tab.id, { filterCategory: v })}
                          >
                            <SelectTrigger className="h-8 text-xs w-36">
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Categories</SelectItem>
                              {uniqueCategories.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Select
                          value={tab.filterMinRating}
                          onValueChange={(v) => updateTab(tab.id, { filterMinRating: v })}
                        >
                          <SelectTrigger className="h-8 text-xs w-28">
                            <SelectValue placeholder="Rating" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Any Rating</SelectItem>
                            {[1, 2, 3, 4].map((r) => (
                              <SelectItem key={r} value={String(r)}>{r}+ ★</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Button
                          size="sm"
                          onClick={() => exportToExcel(filtered, tab.label)}
                          className="bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs h-8"
                        >
                          <Download size={12} /> Export Excel ({filtered.length})
                        </Button>
                      </div>
                    </div>

                    {/* Product table */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 w-14">Img</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 min-w-[220px]">Product</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Brand</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Price</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Seller</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Rating</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Quality</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Issues</th>
                              <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 w-10"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {filtered.map((product, idx) => (
                              <tr key={`${product.sku}-${idx}`} className="hover:bg-gray-50 transition-colors">
                                {/* Thumbnail */}
                                <td className="px-3 py-2">
                                  {product.image ? (
                                    <img
                                      src={product.image}
                                      alt={product.name}
                                      className="w-10 h-10 object-cover rounded border border-gray-100"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                  ) : (
                                    <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                                      <Package size={14} className="text-gray-400" />
                                    </div>
                                  )}
                                </td>

                                {/* Name + SKU */}
                                <td className="px-4 py-2">
                                  <p className="font-medium text-gray-900 text-xs leading-snug line-clamp-2">
                                    {product.name}
                                  </p>
                                  <p className="text-[11px] text-gray-400 mt-0.5">
                                    {product.sku}
                                    {product.isJumiaExpress && (
                                      <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-medium">J.Express</span>
                                    )}
                                  </p>
                                </td>

                                {/* Brand */}
                                <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                                  {product.brand}
                                </td>

                                {/* Price */}
                                <td className="px-4 py-2 text-xs whitespace-nowrap">
                                  <span className="font-semibold text-gray-900">
                                    {product.price > 0
                                      ? product.price.toLocaleString()
                                      : "—"}
                                  </span>
                                  {product.discount && (
                                    <span className="ml-1 text-green-600 text-[10px]">
                                      {product.discount}
                                    </span>
                                  )}
                                </td>

                                {/* Seller */}
                                <td className="px-4 py-2 text-xs text-gray-600 max-w-[120px]">
                                  <span className="truncate block">{product.seller}</span>
                                </td>

                                {/* Rating */}
                                <td className="px-4 py-2 text-xs whitespace-nowrap">
                                  {product.rating > 0 ? (
                                    <span className="flex items-center gap-0.5 text-amber-500">
                                      <Star size={11} fill="currentColor" />
                                      <span className="text-gray-700">{product.rating.toFixed(1)}</span>
                                      <span className="text-gray-400">({product.totalRatings})</span>
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>

                                {/* Quality score */}
                                <td className="px-4 py-2">
                                  {product.qualityChecking ? (
                                    <Loader2 size={14} className="animate-spin text-orange-400" />
                                  ) : product.quality ? (
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreBadge(product.quality.qualityScore)}`}>
                                      {product.quality.qualityScore}/100
                                    </span>
                                  ) : product.qualityError ? (
                                    <span className="text-[11px] text-red-400">Error</span>
                                  ) : (
                                    <span className="text-[11px] text-gray-300">—</span>
                                  )}
                                </td>

                                {/* Issue pills */}
                                <td className="px-4 py-2">
                                  {product.quality && product.quality.totalIssues > 0 ? (
                                    <div className="flex gap-1 flex-wrap">
                                      {product.quality.criticalIssues > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">
                                          {product.quality.criticalIssues}C
                                        </span>
                                      )}
                                      {product.quality.highIssues > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-medium">
                                          {product.quality.highIssues}H
                                        </span>
                                      )}
                                      {product.quality.mediumIssues > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">
                                          {product.quality.mediumIssues}M
                                        </span>
                                      )}
                                      {product.quality.lowIssues > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 font-medium">
                                          {product.quality.lowIssues}L
                                        </span>
                                      )}
                                    </div>
                                  ) : product.quality && product.quality.totalIssues === 0 ? (
                                    <CheckCircle2 size={14} className="text-green-500" />
                                  ) : null}
                                </td>

                                {/* Link */}
                                <td className="px-3 py-2">
                                  {product.url && (
                                    <a
                                      href={product.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gray-400 hover:text-orange-500 transition-colors"
                                    >
                                      <ExternalLink size={13} />
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {filtered.length === 0 && tab.products.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
                        <Filter size={28} className="text-gray-300 mx-auto mb-2" />
                        <p className="text-gray-500 text-sm">No products match the current filters</p>
                        <button
                          onClick={() =>
                            updateTab(tab.id, {
                              filterBrand: "all",
                              filterSeller: "all",
                              filterCategory: "all",
                              filterMinRating: "0",
                            })
                          }
                          className="text-xs text-orange-600 hover:text-orange-700 mt-1 font-medium"
                        >
                          Clear all filters
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Empty state */}
                {tab.products.length === 0 && !tab.isSearching && !tab.error && (
                  <div className="bg-white border border-dashed border-gray-200 rounded-xl p-12 text-center">
                    <Search size={32} className="text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">No results yet</p>
                    <p className="text-gray-400 text-sm mt-1">
                      {tab.mode === "keyword"
                        ? "Enter a keyword above and click Search"
                        : tab.mode === "url"
                          ? "Enter a Jumia catalog URL above and click Fetch"
                          : "Paste your SKU list above and click Search SKUs"}
                    </p>
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </div>
  );
}
