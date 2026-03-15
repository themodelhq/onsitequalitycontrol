import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Search, Filter, Download, ArrowLeft,
  ChevronRight, AlertCircle, ShieldAlert, Eye, Package,
  Image, FileText, Tag, Ban, BarChart3, RefreshCcw
} from "lucide-react";
import { toast } from "sonner";

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", EG: "Egypt", MA: "Morocco", KE: "Kenya",
  UG: "Uganda", GH: "Ghana", CI: "Côte d'Ivoire", TN: "Tunisia",
  SN: "Senegal", DZ: "Algeria", IC: "Canary Islands",
};

const ISSUE_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  poor_image_quality: { label: "Poor Image Quality", icon: <Image size={13} />, color: "text-red-600 bg-red-50 border-red-200" },
  insufficient_images: { label: "Insufficient Images", icon: <Image size={13} />, color: "text-orange-600 bg-orange-50 border-orange-200" },
  non_white_background: { label: "Non-White Background", icon: <Image size={13} />, color: "text-amber-600 bg-amber-50 border-amber-200" },
  poor_description: { label: "Poor Description", icon: <FileText size={13} />, color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  missing_description_images: { label: "Missing Images in Description", icon: <FileText size={13} />, color: "text-orange-600 bg-orange-50 border-orange-200" },
  naming_format_violation: { label: "Naming Format Violation", icon: <Tag size={13} />, color: "text-blue-600 bg-blue-50 border-blue-200" },
  prohibited_item: { label: "Prohibited Item", icon: <Ban size={13} />, color: "text-red-700 bg-red-100 border-red-300" },
  blacklisted_keyword: { label: "Blacklisted Keyword", icon: <Ban size={13} />, color: "text-red-600 bg-red-50 border-red-200" },
  restricted_brand: { label: "Restricted Brand", icon: <ShieldAlert size={13} />, color: "text-purple-600 bg-purple-50 border-purple-200" },
  wrong_category: { label: "Wrong Category", icon: <Package size={13} />, color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  sensitive_category: { label: "Sensitive Category", icon: <AlertTriangle size={13} />, color: "text-amber-600 bg-amber-50 border-amber-200" },
  counterfeit_indicator: { label: "Counterfeit Indicator", icon: <ShieldAlert size={13} />, color: "text-red-700 bg-red-100 border-red-300" },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "Critical", color: "text-red-700 bg-red-100 border-red-300", dot: "bg-red-500" },
  high: { label: "High", color: "text-orange-700 bg-orange-100 border-orange-300", dot: "bg-orange-500" },
  medium: { label: "Medium", color: "text-amber-700 bg-amber-100 border-amber-300", dot: "bg-amber-400" },
  low: { label: "Low", color: "text-blue-700 bg-blue-100 border-blue-300", dot: "bg-blue-400" },
};

type IssueType = keyof typeof ISSUE_TYPE_LABELS;
type Severity = keyof typeof SEVERITY_CONFIG;

interface Product {
  id: number;
  sku: string;
  name: string;
  brand?: string;
  category: string;
  country: string;
  issues?: any[];
}

export default function ResultsPage() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [issueTypeFilter, setIssueTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data: products, isLoading, refetch } = trpc.analysis.getProducts.useQuery({
    limit: 500,
    offset: 0,
  });

  const { data: batches } = trpc.analysis.getBatches.useQuery();

  // Filter products
  const filteredProducts = useMemo(() => {
    if (!products) return [];

    return products.filter((p: any) => {
      const matchesSearch = !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCountry = countryFilter === "all" || p.country === countryFilter;

      return matchesSearch && matchesCountry;
    });
  }, [products, searchQuery, countryFilter]);

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const paginatedProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Summary stats from latest batch
  const latestBatch = batches?.[0];

  const handleExport = () => {
    if (!filteredProducts.length) return;

    const headers = ["SKU", "Name", "Brand", "Category", "Country", "Issues Found"];
    const rows = filteredProducts.map((p: any) => [
      p.sku, p.name, p.brand || "", p.category, p.country, "—"
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jumia-analysis-results.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export downloaded");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft size={14} />
              Dashboard
            </button>
            <ChevronRight size={14} className="text-gray-300" />
            <span className="text-sm font-medium text-gray-800">Analysis Results</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1.5">
              <RefreshCcw size={13} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
              <Download size={13} />
              Export CSV
            </Button>
            <Button size="sm" onClick={() => navigate("/upload")} className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5">
              <Package size={13} />
              New Analysis
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        {latestBatch && (
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm text-gray-500">Products Analyzed</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{latestBatch.productsAnalyzed || 0}</p>
              <p className="text-xs text-gray-400 mt-1 truncate">{latestBatch.fileName}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm text-gray-500">Total Issues</p>
              <p className="text-3xl font-bold text-red-500 mt-1">{latestBatch.issuesFound || 0}</p>
              <p className="text-xs text-gray-400 mt-1">Across all products</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm text-gray-500">Analysis Status</p>
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-2 h-2 rounded-full ${latestBatch.status === "completed" ? "bg-green-500" : "bg-amber-400 animate-pulse"}`} />
                <span className="text-lg font-semibold capitalize text-gray-800">{latestBatch.status}</span>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm text-gray-500">Total Batches</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{batches?.length || 0}</p>
              <p className="text-xs text-gray-400 mt-1">Analysis runs</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search size={16} className="text-gray-400" />
              <Input
                placeholder="Search by name, SKU, or brand..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="border-0 shadow-none focus-visible:ring-0 px-0 h-8"
              />
            </div>
            <div className="h-5 w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Countries</SelectItem>
                  {Object.entries(COUNTRY_NAMES).map(([code, name]) => (
                    <SelectItem key={code} value={code}>{code} — {name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Results Table */}
        {isLoading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-16 flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500">Loading results...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-16 text-center">
            <BarChart3 size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800">No Results Yet</h3>
            <p className="text-gray-500 mt-1 mb-6">Upload and analyze products to see results here</p>
            <Button onClick={() => navigate("/upload")} className="bg-orange-500 hover:bg-orange-600 text-white">
              Upload Products
            </Button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                {filteredProducts.length} products
              </span>
              <span className="text-xs text-gray-400">Page {currentPage} of {totalPages || 1}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {["SKU", "Product Name", "Category", "Country", "Brand", "Actions"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginatedProducts.map((product: any) => (
                    <tr
                      key={product.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{product.sku}</td>
                      <td className="px-4 py-3 max-w-[260px]">
                        <p className="text-gray-900 font-medium truncate" title={product.name}>{product.name}</p>
                        {product.sourceUrl && (
                          <a href={product.sourceUrl} target="_blank" rel="noreferrer"
                            className="text-xs text-blue-500 hover:underline truncate block">
                            View on Jumia
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{product.category}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs font-medium">
                          {product.country} — {COUNTRY_NAMES[product.country]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{product.brand || "—"}</td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/product/${product.id}`)}
                          className="h-7 text-xs gap-1"
                        >
                          <Eye size={11} />
                          View Issues
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-gray-500">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
