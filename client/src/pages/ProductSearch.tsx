/**
 * Product Search — keyword / URL / SKU search across Jumia markets
 *
 * Mirrors the testfinder exactly:
 * - Server procedures fetch ONE page each (no multi-page loops server-side)
 * - Client calls page-by-page in a loop using utils.X.fetch()
 * - Quality checks run sequentially after results load
 * - Up to 10 independent search tabs
 * - Export to Excel (.xlsx)
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Search, Download, Plus, X, Loader2,
  Star, Package, ExternalLink, AlertTriangle, CheckCircle2, Filter,
  LayoutGrid, List,
} from "lucide-react";
import { toast } from "sonner";

const COUNTRIES = [
  { code: "NG", name: "Nigeria" }, { code: "KE", name: "Kenya" },
  { code: "UG", name: "Uganda" }, { code: "EG", name: "Egypt" },
  { code: "GH", name: "Ghana" }, { code: "CI", name: "Côte d'Ivoire" },
  { code: "MA", name: "Morocco" }, { code: "TN", name: "Tunisia" },
  { code: "SN", name: "Senegal" }, { code: "DZ", name: "Algeria" },
  { code: "IC", name: "Canary Islands" },
];

const MAX_TABS = 10;

type SearchMode = "keyword" | "url" | "sku";

interface CatalogProduct {
  sku: string; name: string; brand: string; category: string;
  price: number; oldPrice?: number; discount?: string;
  rating: number; totalRatings: number; image: string; url: string;
  seller: string; isJumiaExpress: boolean; isShopGlobal: boolean;
  stock: string; tags: string[]; country: string;
}

interface QualityResult {
  qualityScore: number; criticalIssues: number; highIssues: number;
  mediumIssues: number; lowIssues: number; totalIssues: number;
  topIssues: string[];
  // Actual image count (populated from product.imageCount in quality check response)
  imageCount: number;
  // Individual issue flags for filtering and export
  hasNoImages: boolean;
  hasFewImages: boolean;
  hasNonWhiteBackground: boolean;
  hasLowResImages: boolean;
  hasEmptyDescription: boolean;
  hasThinDescription: boolean;
  hasMuddledDescription: boolean;
  hasRepeatedDescription: boolean;
  hasMissingDescImages: boolean;
  hasNamingIssue: boolean;
  hasCategoryIssue: boolean;
  hasProhibitedContent: boolean;
  hasCounterfeitFlag: boolean;
  hasSuspiciousPrice: boolean;
}

interface EnrichedProduct extends CatalogProduct {
  quality?: QualityResult;
  qualityChecking?: boolean;
  qualityError?: string;
}

interface SearchTab {
  id: string; label: string; mode: SearchMode; country: string;
  keyword: string; urlInput: string; skuInput: string; pages: string;
  products: EnrichedProduct[]; isSearching: boolean; progress: number;
  elapsed: number; error: string | null; hasMore: boolean;
  filterBrand: string; filterSeller: string; filterCategory: string;
  filterMinRating: string; filterTag: string;
  filterJumiaExpress: string; filterMinImages: string;
  filterMaxPrice: string; filterMinPrice: string;
  filterDescIssue: string;
  view: "table" | "grid";
}

function makeTab(id: string, index: number): SearchTab {
  return {
    id, label: `Search ${index}`, mode: "keyword", country: "NG",
    keyword: "", urlInput: "", skuInput: "", pages: "1",
    products: [], isSearching: false, progress: 0, elapsed: 0,
    error: null, hasMore: false,
    filterBrand: "all", filterSeller: "all", filterCategory: "all",
    filterMinRating: "0", filterTag: "all",
    filterJumiaExpress: "all", filterMinImages: "0",
    filterMaxPrice: "", filterMinPrice: "",
    filterDescIssue: "all",
    view: "table",
  };
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

function exportToExcel(products: EnrichedProduct[], tabLabel: string) {
  const headers = [
    "SKU","Name","Brand","Category","Price","Old Price","Discount",
    "Rating","Total Ratings","Seller","Jumia Express","Shop Global",
    "Image URL","Product URL","Stock","Tags","Country",
    // Summary quality columns
    "Quality Score","Critical Issues","High Issues","Medium Issues",
    "Low Issues","Total Issues","Top Issues",
    // Individual issue flag columns
    "No. of Images","Few Images (<5)","Non-White Background","Low Resolution Images",
    "Empty Description","Thin Description","Muddled Description","Repeated Description",
    "Missing Images in Desc","Naming Issue","Wrong Category",
    "Prohibited/Blacklisted","Counterfeit Flag","Suspicious Price",
  ];
  const flag = (q: QualityResult | undefined, f: keyof QualityResult) =>
    q ? (q[f] ? "YES" : "NO") : "";

  const rows = products.map((p) => [
    escapeXlsx(p.sku), escapeXlsx(p.name), escapeXlsx(p.brand), escapeXlsx(p.category),
    p.price||"", p.oldPrice||"", escapeXlsx(p.discount),
    p.rating||"", p.totalRatings||"", escapeXlsx(p.seller),
    p.isJumiaExpress?"Yes":"No", p.isShopGlobal?"Yes":"No",
    escapeXlsx(p.image), escapeXlsx(p.url), escapeXlsx(p.stock),
    Array.isArray(p.tags)?p.tags.join("; "):"", escapeXlsx(p.country),
    p.quality?.qualityScore??"", p.quality?.criticalIssues??"",
    p.quality?.highIssues??"", p.quality?.mediumIssues??"",
    p.quality?.lowIssues??"", p.quality?.totalIssues??"",
    p.quality?.topIssues?.join(" | ")??"",
    // Individual flags / counts
    p.quality?.imageCount ?? "", flag(p.quality,"hasFewImages"),
    flag(p.quality,"hasNonWhiteBackground"), flag(p.quality,"hasLowResImages"),
    flag(p.quality,"hasEmptyDescription"), flag(p.quality,"hasThinDescription"),
    flag(p.quality,"hasMuddledDescription"), flag(p.quality,"hasRepeatedDescription"),
    flag(p.quality,"hasMissingDescImages"), flag(p.quality,"hasNamingIssue"),
    flag(p.quality,"hasCategoryIssue"), flag(p.quality,"hasProhibitedContent"),
    flag(p.quality,"hasCounterfeitFlag"), flag(p.quality,"hasSuspiciousPrice"),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = [
    {wch:14},{wch:40},{wch:18},{wch:25},{wch:12},{wch:12},{wch:10},{wch:8},
    {wch:12},{wch:22},{wch:14},{wch:12},{wch:40},{wch:50},{wch:12},{wch:20},
    {wch:10},{wch:14},{wch:12},{wch:10},{wch:12},{wch:10},{wch:12},{wch:60},
    {wch:12},{wch:14},{wch:20},{wch:18},{wch:18},{wch:18},{wch:20},{wch:22},
    {wch:20},{wch:14},{wch:16},{wch:22},{wch:18},{wch:16},
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabLabel.slice(0,31));
  XLSX.writeFile(wb, `${tabLabel.replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
}

export default function ProductSearchPage() {
  const [, navigate] = useLocation();
  const [tabs, setTabs] = useState<SearchTab[]>([makeTab("t1", 1)]);
  const [activeTab, setActiveTab] = useState("t1");
  const tabCounter = useRef(2);
  const timerRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // utils.X.fetch() works for .query() procedures — GET requests that pass through
  // Netlify's proxy without a POST timeout limit (same pattern as testfinder)
  const utils = trpc.useUtils();

  const addTab = () => {
    if (tabs.length >= MAX_TABS) { toast.error(`Maximum ${MAX_TABS} tabs allowed`); return; }
    const id = `t${tabCounter.current++}`;
    setTabs((prev) => [...prev, makeTab(id, prev.length + 1)]);
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

  const startTimer = (id: string) => {
    clearInterval(timerRefs.current[id]);
    const start = Date.now();
    timerRefs.current[id] = setInterval(() => {
      setTabs((prev) => prev.map((t) => t.id === id ? { ...t, elapsed: Math.floor((Date.now()-start)/1000) } : t));
    }, 1000);
  };

  const stopTimer = (id: string) => {
    clearInterval(timerRefs.current[id]);
    delete timerRefs.current[id];
  };

  useEffect(() => { return () => { Object.values(timerRefs.current).forEach(clearInterval); }; }, []);

  // Quality check — one product at a time, uses utils.qualityCheck.checkUrl.fetch()
  const runQualityCheck = useCallback(async (tabId: string, productIdx: number, productUrl: string, country: string) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const products = [...t.products];
      products[productIdx] = { ...products[productIdx], qualityChecking: true };
      return { ...t, products };
    }));

    try {
      const res = await utils.qualityCheck.checkUrl.fetch({ url: productUrl, country });
      let quality: QualityResult;
      if (res.ok && res.summary) {
        const s = res.summary;
        const issues = (res.issues as any[]) || [];
        const hasType = (t: string) => issues.some((i) => i.type === t);
        quality = {
          qualityScore: computeScore(s.criticalIssues, s.highIssues, s.mediumIssues, s.lowIssues),
          criticalIssues: s.criticalIssues, highIssues: s.highIssues,
          mediumIssues: s.mediumIssues, lowIssues: s.lowIssues, totalIssues: s.totalIssues,
          topIssues: issues.slice(0,3).map((i:any) => `[${i.severity}] ${i.message}`),
          // Actual image count from the scraped product
          imageCount: (res as any).product?.imageCount ?? 0,
          // Individual flags derived from issue types
          hasNoImages: hasType("insufficient_images") && issues.some((i) => i.details?.imageCount === 0),
          hasFewImages: hasType("insufficient_images"),
          hasNonWhiteBackground: hasType("non_white_background"),
          hasLowResImages: hasType("poor_image_quality"),
          hasEmptyDescription: issues.some((i) => i.type === "poor_description" && i.message?.toLowerCase().includes("empty")),
          hasThinDescription: hasType("thin_description") || issues.some((i) => i.type === "poor_description" && i.message?.toLowerCase().includes("short")),
          hasMuddledDescription: hasType("muddled_description"),
          hasRepeatedDescription: hasType("repeated_description"),
          hasMissingDescImages: hasType("missing_description_images"),
          hasNamingIssue: hasType("naming_format_violation"),
          hasCategoryIssue: hasType("wrong_category"),
          hasProhibitedContent: hasType("prohibited_item") || hasType("blacklisted_keyword") || hasType("restricted_brand"),
          hasCounterfeitFlag: hasType("counterfeit_indicator"),
          hasSuspiciousPrice: hasType("suspicious_price"),
        };
      } else {
        quality = {
          qualityScore: 0, criticalIssues: 0, highIssues: 0,
          mediumIssues: 0, lowIssues: 0, totalIssues: 0,
          topIssues: [(res as any).errorMessage || "Check failed"],
          imageCount: 0,
          hasNoImages: false, hasFewImages: false, hasNonWhiteBackground: false,
          hasLowResImages: false, hasEmptyDescription: false, hasThinDescription: false,
          hasMuddledDescription: false, hasRepeatedDescription: false, hasMissingDescImages: false,
          hasNamingIssue: false, hasCategoryIssue: false, hasProhibitedContent: false,
          hasCounterfeitFlag: false, hasSuspiciousPrice: false,
        };
      }
      setTabs((prev) => prev.map((t) => {
        if (t.id !== tabId) return t;
        const products = [...t.products];
        products[productIdx] = { ...products[productIdx], quality, qualityChecking: false };
        return { ...t, products };
      }));
    } catch (err) {
      setTabs((prev) => prev.map((t) => {
        if (t.id !== tabId) return t;
        const products = [...t.products];
        products[productIdx] = { ...products[productIdx], qualityChecking: false, qualityError: err instanceof Error ? err.message : "Failed" };
        return { ...t, products };
      }));
    }
  }, [utils]);

  const runAllQualityChecks = useCallback(async (tabId: string, products: CatalogProduct[]) => {
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (p.url) await runQualityCheck(tabId, i, p.url, p.country);
    }
  }, [runQualityCheck]);

  // Search handler — mirrors testfinder: one tRPC call per page, loop from client
  const handleSearch = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)!;
    updateTab(tabId, { isSearching: true, products: [], progress: 0, error: null, elapsed: 0 });
    startTimer(tabId);

    const targetPages = Math.max(1, parseInt(tab.pages) || 1);

    try {
      if (tab.mode === "keyword") {
        if (!tab.keyword.trim()) { stopTimer(tabId); updateTab(tabId, { isSearching: false }); return; }
        let allProducts: CatalogProduct[] = [];
        for (let p = 1; p <= targetPages; p++) {
          const result = await utils.productSearch.byKeyword.fetch({ keyword: tab.keyword.trim(), country: tab.country, page: p });
          if (result.products && result.products.length > 0) {
            allProducts = [...allProducts, ...(result.products as CatalogProduct[])];
            updateTab(tabId, { products: allProducts, progress: Math.round((p / targetPages) * 100) });
          }
          if (!result.hasMore) break;
        }
        stopTimer(tabId);
        updateTab(tabId, { isSearching: false, progress: 100 });
        if (allProducts.length === 0) { toast.info("No products found — try a different keyword or country"); }
        else { toast.success(`Found ${allProducts.length} product${allProducts.length !== 1 ? "s" : ""}`); runAllQualityChecks(tabId, allProducts); }

      } else if (tab.mode === "url") {
        if (!tab.urlInput.trim()) { stopTimer(tabId); updateTab(tabId, { isSearching: false }); return; }
        let allProducts: CatalogProduct[] = [];
        for (let p = 1; p <= targetPages; p++) {
          const fetchUrl = p === 1 ? tab.urlInput.trim()
            : tab.urlInput.trim().includes("?") ? `${tab.urlInput.trim()}&page=${p}` : `${tab.urlInput.trim()}?page=${p}`;
          const result = await utils.productSearch.byUrl.fetch({ url: fetchUrl, country: tab.country });
          if (result.products && result.products.length > 0) {
            allProducts = [...allProducts, ...(result.products as CatalogProduct[])];
            updateTab(tabId, { products: allProducts, progress: Math.round((p / targetPages) * 100) });
          }
          if (!result.hasMore) break;
        }
        stopTimer(tabId);
        updateTab(tabId, { isSearching: false, progress: 100 });
        if (allProducts.length === 0) { toast.info("No products found — try a different URL or country"); }
        else { toast.success(`Found ${allProducts.length} product${allProducts.length !== 1 ? "s" : ""}`); runAllQualityChecks(tabId, allProducts); }

      } else {
        // SKU — mirrors testfinder handleSkuSearch
        if (!tab.skuInput.trim()) { stopTimer(tabId); updateTab(tabId, { isSearching: false }); return; }
        const skus = tab.skuInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        if (!skus.length) { stopTimer(tabId); updateTab(tabId, { isSearching: false }); return; }
        const result = await utils.productSearch.bySku.fetch({ skus, country: tab.country });
        const raw = (result.products || []) as CatalogProduct[];
        stopTimer(tabId);
        updateTab(tabId, { products: raw, isSearching: false, progress: 100 });
        if (raw.length === 0) { toast.info("No products found for those SKUs"); }
        else { toast.success(`Found ${raw.length} product${raw.length !== 1 ? "s" : ""}`); runAllQualityChecks(tabId, raw); }
      }
    } catch (err) {
      stopTimer(tabId);
      const msg = err instanceof Error ? err.message : "Unknown error";
      updateTab(tabId, { isSearching: false, error: msg, progress: 0 });
      toast.error("Search failed: " + msg);
    }
  };

  function getFiltered(tab: SearchTab): EnrichedProduct[] {
    return tab.products.filter((p) => {
      if (tab.filterBrand !== "all" && p.brand !== tab.filterBrand) return false;
      if (tab.filterSeller !== "all" && p.seller !== tab.filterSeller) return false;
      if (tab.filterCategory !== "all" && p.category !== tab.filterCategory) return false;
      if (tab.filterMinRating !== "0" && (p.rating || 0) < parseFloat(tab.filterMinRating)) return false;
      // Jumia Express filter
      if (tab.filterJumiaExpress === "yes" && !p.isJumiaExpress) return false;
      if (tab.filterJumiaExpress === "no" && p.isJumiaExpress) return false;
      // Tag filter (catalog tags field)
      if (tab.filterTag !== "all" && !(Array.isArray(p.tags) && p.tags.includes(tab.filterTag))) return false;
      // Price range
      if (tab.filterMinPrice !== "" && p.price < parseFloat(tab.filterMinPrice)) return false;
      if (tab.filterMaxPrice !== "" && p.price > parseFloat(tab.filterMaxPrice)) return false;
      // Min images filter (from quality check)
      if (tab.filterMinImages !== "0" && p.quality) {
        const minImg = parseInt(tab.filterMinImages);
        // hasFewImages means < 5 images; hasNoImages means 0 images
        if (minImg >= 5 && p.quality.hasFewImages) return false;
        if (minImg >= 1 && p.quality.hasNoImages) return false;
      }
      // Description issue filter
      if (tab.filterDescIssue !== "all" && p.quality) {
        if (tab.filterDescIssue === "no_images" && !p.quality.hasMissingDescImages) return false;
        if (tab.filterDescIssue === "thin" && !p.quality.hasThinDescription && !p.quality.hasEmptyDescription) return false;
        if (tab.filterDescIssue === "muddled" && !p.quality.hasMuddledDescription) return false;
        if (tab.filterDescIssue === "repeated" && !p.quality.hasRepeatedDescription) return false;
        if (tab.filterDescIssue === "non_white_bg" && !p.quality.hasNonWhiteBackground) return false;
      }
      return true;
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft size={14} /> Dashboard
            </button>
            <span className="text-gray-300">/</span>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-orange-500 rounded-md flex items-center justify-center"><Search size={12} className="text-white" /></div>
              <span className="font-semibold text-gray-900 text-sm">Product Search</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Product Search</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Search Jumia by keyword, catalog URL or SKU list — quality checks run automatically on every result and can be exported to Excel. Up to {MAX_TABS} independent tabs.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
            <TabsList className="flex h-auto gap-1 bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}
                  className="group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all data-[state=active]:bg-white data-[state=active]:border-orange-300 data-[state=active]:text-orange-700 data-[state=inactive]:bg-gray-100 data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-500">
                  {tab.label}
                  {tab.products.length > 0 && (
                    <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">{tab.products.length}</span>
                  )}
                  {tab.isSearching && <Loader2 size={10} className="animate-spin text-orange-500" />}
                  {tabs.length > 1 && (
                    <button onClick={(e) => removeTab(tab.id, e)} className="opacity-0 group-hover:opacity-100 ml-0.5 hover:text-red-500 transition-opacity">
                      <X size={10} />
                    </button>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.length < MAX_TABS && (
              <button onClick={addTab} className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-orange-600 border border-dashed border-gray-300 hover:border-orange-400 rounded-lg transition-all">
                <Plus size={12} /> Add Tab
              </button>
            )}
          </div>

          {tabs.map((tab) => {
            const filtered = getFiltered(tab);
            const uniqueBrands = Array.from(new Set(tab.products.map((p) => p.brand).filter(Boolean)));
            const uniqueSellers = Array.from(new Set(tab.products.map((p) => p.seller).filter(Boolean)));
            const uniqueCategories = Array.from(new Set(tab.products.map((p) => p.category).filter(Boolean)));
            const uniqueTags = Array.from(new Set(tab.products.flatMap((p) => Array.isArray(p.tags) ? p.tags : []).filter(Boolean))).sort();
            const checkedCount = tab.products.filter((p) => p.quality).length;
            const avgScore = checkedCount > 0
              ? Math.round(tab.products.filter((p) => p.quality).reduce((s, p) => s + (p.quality!.qualityScore || 0), 0) / checkedCount)
              : null;

            return (
              <TabsContent key={tab.id} value={tab.id} className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Country</label>
                      <Select value={tab.country} onValueChange={(v) => updateTab(tab.id, { country: v })}>
                        <SelectTrigger className="w-40 h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Search Mode</label>
                      <div className="flex border border-gray-200 rounded-lg p-1">
                        {(["keyword","url","sku"] as SearchMode[]).map((m) => (
                          <button key={m} onClick={() => updateTab(tab.id, { mode: m })}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${tab.mode === m ? "bg-orange-500 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                            {m === "keyword" ? "Keyword" : m === "url" ? "URL" : "SKU List"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {tab.mode !== "sku" && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Pages to Fetch</label>
                        <Input type="text" value={tab.pages}
                          onChange={(e) => { const v = e.target.value; if (v === "" || /^\d+$/.test(v)) updateTab(tab.id, { pages: v }); }}
                          className="w-20 h-9 text-sm text-center" placeholder="1" />
                      </div>
                    )}

                    <div className="ml-auto">
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Tab Name</label>
                      <Input value={tab.label} onChange={(e) => updateTab(tab.id, { label: e.target.value })} className="w-32 h-9 text-xs" maxLength={24} />
                    </div>
                  </div>

                  {tab.mode === "keyword" && (
                    <div className="flex gap-2">
                      <Input placeholder="Enter keyword e.g. laptop, phone, shoes" value={tab.keyword}
                        onChange={(e) => updateTab(tab.id, { keyword: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && !tab.isSearching && handleSearch(tab.id)}
                        className="flex-1 text-sm" />
                      <Button onClick={() => handleSearch(tab.id)} disabled={tab.isSearching || !tab.keyword.trim()}
                        className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shrink-0">
                        {tab.isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
                      </Button>
                    </div>
                  )}

                  {tab.mode === "url" && (
                    <div className="flex gap-2">
                      <Input placeholder="https://www.jumia.com.ng/catalog/?q=phone" value={tab.urlInput}
                        onChange={(e) => updateTab(tab.id, { urlInput: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && !tab.isSearching && handleSearch(tab.id)}
                        className="flex-1 text-sm" />
                      <Button onClick={() => handleSearch(tab.id)} disabled={tab.isSearching || !tab.urlInput.trim()}
                        className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shrink-0">
                        {tab.isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Fetch
                      </Button>
                    </div>
                  )}

                  {tab.mode === "sku" && (
                    <div className="space-y-2">
                      <textarea placeholder={"SKU001\nSKU002\nSKU003"} value={tab.skuInput}
                        onChange={(e) => updateTab(tab.id, { skuInput: e.target.value })}
                        className="w-full h-32 p-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-y" />
                      <Button onClick={() => handleSearch(tab.id)} disabled={tab.isSearching || !tab.skuInput.trim()}
                        className="bg-orange-500 hover:bg-orange-600 text-white gap-2 w-full">
                        {tab.isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search SKUs
                      </Button>
                    </div>
                  )}

                  {(tab.isSearching || tab.progress > 0) && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>
                          {tab.isSearching ? "Fetching products…" : `${tab.products.length} products found`}
                          {checkedCount > 0 && !tab.isSearching && ` · ${checkedCount}/${tab.products.length} quality checked`}
                        </span>
                        <span>{tab.isSearching ? `${tab.elapsed}s elapsed` : ""}</span>
                      </div>
                      <Progress value={tab.progress} className="h-1.5" />
                    </div>
                  )}

                  {tab.error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertTriangle size={14} /> {tab.error}
                    </div>
                  )}
                </div>

                {tab.products.length > 0 && (
                  <>
                    {/* ── Toolbar ── */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-600">
                          <strong>{filtered.length}</strong> products
                        </span>
                        {avgScore !== null && (
                          <span className={`text-xs rounded-full px-2.5 py-1 font-medium border ${scoreBadge(avgScore)}`}>Avg score: {avgScore}/100</span>
                        )}
                        {checkedCount < tab.products.length && (
                          <span className="text-xs bg-white border border-amber-200 rounded-full px-2.5 py-1 text-amber-600 flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" /> Checking quality ({checkedCount}/{tab.products.length})
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap ml-auto items-center">
                        {uniqueBrands.length > 0 && (
                          <Select value={tab.filterBrand} onValueChange={(v) => updateTab(tab.id, { filterBrand: v })}>
                            <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Brand" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Brands</SelectItem>{uniqueBrands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        {uniqueSellers.length > 0 && (
                          <Select value={tab.filterSeller} onValueChange={(v) => updateTab(tab.id, { filterSeller: v })}>
                            <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Seller" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Sellers</SelectItem>{uniqueSellers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        {uniqueCategories.length > 0 && (
                          <Select value={tab.filterCategory} onValueChange={(v) => updateTab(tab.id, { filterCategory: v })}>
                            <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Category" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Categories</SelectItem>{uniqueCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        {/* Rating */}
                        <Select value={tab.filterMinRating} onValueChange={(v) => updateTab(tab.id, { filterMinRating: v })}>
                          <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Any Rating</SelectItem>
                            {[1,2,3,4].map((r) => <SelectItem key={r} value={String(r)}>{r}+ ★</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {/* Jumia Express */}
                        <Select value={tab.filterJumiaExpress} onValueChange={(v) => updateTab(tab.id, { filterJumiaExpress: v })}>
                          <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Products</SelectItem>
                            <SelectItem value="yes">Jumia Express Only</SelectItem>
                            <SelectItem value="no">Non-Express Only</SelectItem>
                          </SelectContent>
                        </Select>
                        {/* Price range */}
                        <div className="flex items-center gap-1">
                          <Input type="text" placeholder="Min ₦" value={tab.filterMinPrice}
                            onChange={(e) => { const v=e.target.value; if(v===""||/^\d+$/.test(v)) updateTab(tab.id,{filterMinPrice:v}); }}
                            className="h-8 text-xs w-20 text-center" />
                          <span className="text-xs text-gray-400">–</span>
                          <Input type="text" placeholder="Max ₦" value={tab.filterMaxPrice}
                            onChange={(e) => { const v=e.target.value; if(v===""||/^\d+$/.test(v)) updateTab(tab.id,{filterMaxPrice:v}); }}
                            className="h-8 text-xs w-20 text-center" />
                        </div>
                        {/* Tags */}
                        {uniqueTags.length > 0 && (
                          <Select value={tab.filterTag} onValueChange={(v) => updateTab(tab.id, { filterTag: v })}>
                            <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Tag" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Tags</SelectItem>{uniqueTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        {/* Min images (requires quality check) */}
                        {checkedCount > 0 && (
                          <Select value={tab.filterMinImages} onValueChange={(v) => updateTab(tab.id, { filterMinImages: v })}>
                            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Any Image Count</SelectItem>
                              <SelectItem value="1">Has ≥ 1 Image</SelectItem>
                              <SelectItem value="5">Has ≥ 5 Images</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {/* Product details issue filter */}
                        {checkedCount > 0 && (
                          <Select value={tab.filterDescIssue} onValueChange={(v) => updateTab(tab.id, { filterDescIssue: v })}>
                            <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Product Details</SelectItem>
                              <SelectItem value="no_images">Missing Images in Details</SelectItem>
                              <SelectItem value="thin">Thin / Insufficient Details</SelectItem>
                              <SelectItem value="muddled">Garbled / Muddled Text</SelectItem>
                              <SelectItem value="repeated">Repeated Information</SelectItem>
                              <SelectItem value="non_white_bg">Non-White Product Images</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {/* View toggle */}
                        <div className="flex border border-gray-200 rounded-lg p-0.5">
                          <button onClick={() => updateTab(tab.id, { view: "table" })}
                            className={`p-1.5 rounded-md transition-all ${tab.view === "table" ? "bg-orange-500 text-white" : "text-gray-400 hover:text-gray-600"}`} title="Table view">
                            <List size={14} />
                          </button>
                          <button onClick={() => updateTab(tab.id, { view: "grid" })}
                            className={`p-1.5 rounded-md transition-all ${tab.view === "grid" ? "bg-orange-500 text-white" : "text-gray-400 hover:text-gray-600"}`} title="Grid view">
                            <LayoutGrid size={14} />
                          </button>
                        </div>
                        <Button size="sm" onClick={() => exportToExcel(filtered, tab.label)}
                          className="bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs h-8">
                          <Download size={12} /> Export ({filtered.length})
                        </Button>
                      </div>
                    </div>

                    {/* ── Table view ── */}
                    {tab.view === "table" && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3 w-12">Img</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 min-w-[200px]">Product</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Brand</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Price</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Seller</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Rating</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Quality</th>
                                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Issues</th>
                                <th className="w-16 px-3 py-3"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {filtered.map((product, idx) => (
                                <tr key={`${product.sku}-${idx}`} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-3 py-2">
                                    {product.image
                                      ? <img src={product.image} alt={product.name} className="w-10 h-10 object-cover rounded border border-gray-100" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
                                      : <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center"><Package size={14} className="text-gray-400" /></div>}
                                  </td>
                                  <td className="px-4 py-2">
                                    <p className="font-medium text-gray-900 text-xs leading-snug line-clamp-2">{product.name}</p>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      {product.sku}
                                      {product.isJumiaExpress && <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-medium">J.Express</span>}
                                    </p>
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{product.brand}</td>
                                  <td className="px-4 py-2 text-xs whitespace-nowrap">
                                    <span className="font-semibold text-gray-900">{product.price > 0 ? product.price.toLocaleString() : "—"}</span>
                                    {product.discount && <span className="ml-1 text-green-600 text-[10px]">{product.discount}</span>}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-600 max-w-[120px]"><span className="truncate block">{product.seller}</span></td>
                                  <td className="px-4 py-2 text-xs whitespace-nowrap">
                                    {product.rating > 0
                                      ? <span className="flex items-center gap-0.5 text-amber-500"><Star size={11} fill="currentColor" /><span className="text-gray-700">{product.rating.toFixed(1)}</span><span className="text-gray-400">({product.totalRatings})</span></span>
                                      : <span className="text-gray-400">—</span>}
                                  </td>
                                  <td className="px-4 py-2">
                                    {product.qualityChecking
                                      ? <Loader2 size={14} className="animate-spin text-orange-400" />
                                      : product.quality
                                        ? <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreBadge(product.quality.qualityScore)}`}>{product.quality.qualityScore}/100</span>
                                        : product.qualityError
                                          ? <span className="text-[11px] text-red-400">Error</span>
                                          : <span className="text-[11px] text-gray-300">—</span>}
                                  </td>
                                  <td className="px-4 py-2">
                                    {product.quality && product.quality.totalIssues > 0
                                      ? <div className="flex gap-1 flex-wrap">
                                          {product.quality.criticalIssues > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">{product.quality.criticalIssues}C</span>}
                                          {product.quality.highIssues > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-medium">{product.quality.highIssues}H</span>}
                                          {product.quality.mediumIssues > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">{product.quality.mediumIssues}M</span>}
                                          {product.quality.lowIssues > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 font-medium">{product.quality.lowIssues}L</span>}
                                        </div>
                                      : product.quality && product.quality.totalIssues === 0
                                        ? <CheckCircle2 size={14} className="text-green-500" />
                                        : null}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      {product.url && <a href={product.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-orange-500 transition-colors"><ExternalLink size={13} /></a>}
                                      <button
                                        onClick={() => updateTab(tab.id, { products: tab.products.filter((_, i) => tab.products.indexOf(product) !== i) })}
                                        className="text-gray-300 hover:text-red-400 transition-colors"
                                        title="Remove product"
                                      >
                                        <X size={13} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* ── Thumbnail grid view ── */}
                    {tab.view === "grid" && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {filtered.map((product, idx) => (
                          <div key={`${product.sku}-${idx}`} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow group relative">
                            {/* Remove button */}
                            <button
                              onClick={() => updateTab(tab.id, { products: tab.products.filter((_, i) => tab.products.indexOf(product) !== i) })}
                              className="absolute top-1.5 right-1.5 z-10 w-5 h-5 bg-white rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-300 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                              title="Remove product"
                            >
                              <X size={10} />
                            </button>

                            {/* Image */}
                            <div className="relative aspect-square bg-gray-50">
                              {product.image
                                ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = ""; (e.target as HTMLImageElement).style.display="none"; }} />
                                : <div className="w-full h-full flex items-center justify-center"><Package size={28} className="text-gray-300" /></div>}
                              {/* Quality badge overlay */}
                              {product.quality && (
                                <div className={`absolute bottom-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreBadge(product.quality.qualityScore)}`}>
                                  {product.quality.qualityScore}/100
                                </div>
                              )}
                              {product.qualityChecking && (
                                <div className="absolute bottom-1.5 left-1.5">
                                  <Loader2 size={12} className="animate-spin text-orange-500" />
                                </div>
                              )}
                              {product.isJumiaExpress && (
                                <div className="absolute top-1.5 left-1.5 text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-medium">Express</div>
                              )}
                            </div>

                            {/* Details */}
                            <div className="p-2.5 space-y-1">
                              <p className="text-xs font-medium text-gray-900 line-clamp-2 leading-snug">{product.name}</p>
                              <p className="text-[11px] text-gray-400">{product.brand}</p>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-900">
                                  {product.price > 0 ? product.price.toLocaleString() : "—"}
                                  {product.discount && <span className="ml-1 text-[10px] text-green-600 font-normal">{product.discount}</span>}
                                </span>
                                {product.rating > 0 && (
                                  <span className="flex items-center gap-0.5 text-amber-500">
                                    <Star size={10} fill="currentColor" />
                                    <span className="text-[10px] text-gray-600">{product.rating.toFixed(1)}</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-gray-500 truncate">{product.seller}</p>
                              {/* Issue pills */}
                              {product.quality && product.quality.totalIssues > 0 && (
                                <div className="flex gap-1 flex-wrap pt-0.5">
                                  {product.quality.criticalIssues > 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-medium">{product.quality.criticalIssues}C</span>}
                                  {product.quality.highIssues > 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">{product.quality.highIssues}H</span>}
                                  {product.quality.mediumIssues > 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{product.quality.mediumIssues}M</span>}
                                  {product.quality.lowIssues > 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{product.quality.lowIssues}L</span>}
                                </div>
                              )}
                              {product.quality && product.quality.totalIssues === 0 && (
                                <div className="flex items-center gap-1 pt-0.5">
                                  <CheckCircle2 size={11} className="text-green-500" />
                                  <span className="text-[10px] text-green-600">All clear</span>
                                </div>
                              )}
                              {product.url && (
                                <a href={product.url} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] text-orange-600 hover:text-orange-700 font-medium pt-0.5">
                                  <ExternalLink size={10} /> View on Jumia
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {filtered.length === 0 && tab.products.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
                        <Filter size={28} className="text-gray-300 mx-auto mb-2" />
                        <p className="text-gray-500 text-sm">No products match the current filters</p>
                        <button onClick={() => updateTab(tab.id, { filterBrand:"all", filterSeller:"all", filterCategory:"all", filterMinRating:"0", filterJumiaExpress:"all", filterTag:"all", filterMinPrice:"", filterMaxPrice:"", filterMinImages:"0", filterDescIssue:"all" })}
                          className="text-xs text-orange-600 hover:text-orange-700 mt-1 font-medium">Clear all filters</button>
                      </div>
                    )}
                  </>
                )}

                {tab.products.length === 0 && !tab.isSearching && !tab.error && (
                  <div className="bg-white border border-dashed border-gray-200 rounded-xl p-12 text-center">
                    <Search size={32} className="text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">No results yet</p>
                    <p className="text-gray-400 text-sm mt-1">
                      {tab.mode === "keyword" ? "Enter a keyword above and click Search"
                        : tab.mode === "url" ? "Enter a Jumia catalog URL above and click Fetch"
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
