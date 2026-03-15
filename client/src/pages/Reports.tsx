import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, ChevronRight, Download, FileSpreadsheet,
  FileText, BarChart3, Globe2, AlertTriangle, CheckCircle2,
  Package
} from "lucide-react";
import { toast } from "sonner";

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", EG: "Egypt", MA: "Morocco", KE: "Kenya",
  UG: "Uganda", GH: "Ghana", CI: "Côte d'Ivoire", TN: "Tunisia",
  SN: "Senegal", DZ: "Algeria", IC: "Canary Islands",
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  poor_image_quality: "Poor Image Quality",
  insufficient_images: "Insufficient Images",
  non_white_background: "Non-White Background",
  poor_description: "Poor Description",
  missing_description_images: "Missing Images in Description",
  naming_format_violation: "Naming Format Violation",
  prohibited_item: "Prohibited Item",
  blacklisted_keyword: "Blacklisted Keyword",
  restricted_brand: "Restricted Brand",
  wrong_category: "Wrong Category",
  sensitive_category: "Sensitive Category",
  counterfeit_indicator: "Counterfeit Indicator",
};

function escapeCsv(val: any): string {
  const str = String(val ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function ReportsPage() {
  const [, navigate] = useLocation();
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [generating, setGenerating] = useState<string | null>(null);

  const { data: products } = trpc.analysis.getProducts.useQuery({ limit: 1000, offset: 0 });
  const { data: batches } = trpc.analysis.getBatches.useQuery();

  const latestBatch = batches?.[0];

  // Country summary stats
  const countryStats = (products || []).reduce((acc: Record<string, { count: number }>, p: any) => {
    if (!acc[p.country]) acc[p.country] = { count: 0 };
    acc[p.country].count++;
    return acc;
  }, {});

  const generateProductsCSV = () => {
    setGenerating("products");
    try {
      const headers = ["SKU", "Name", "Brand", "Category", "Country", "Price", "Seller", "Rating", "URL"];
      const filtered = (products || []).filter((p: any) => selectedCountry === "all" || p.country === selectedCountry);
      const rows = filtered.map((p: any) => [
        escapeCsv(p.sku),
        escapeCsv(p.name),
        escapeCsv(p.brand || ""),
        escapeCsv(p.category),
        escapeCsv(p.country),
        escapeCsv(p.price || ""),
        escapeCsv(p.seller || ""),
        escapeCsv(p.rating || ""),
        escapeCsv(p.sourceUrl || ""),
      ]);

      const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
      downloadCSV(csv, `jumia-products-${selectedCountry}-${Date.now()}.csv`);
      toast.success(`Exported ${filtered.length} products`);
    } finally {
      setGenerating(null);
    }
  };

  const generateSummaryCSV = () => {
    setGenerating("summary");
    try {
      const headers = ["Country", "Country Name", "Total Products", "Batch", "Analysis Date"];
      const rows = Object.entries(countryStats).map(([country, stats]) => [
        escapeCsv(country),
        escapeCsv(COUNTRY_NAMES[country] || country),
        escapeCsv(stats.count),
        escapeCsv(latestBatch?.fileName || ""),
        escapeCsv(latestBatch?.completedAt ? new Date(latestBatch.completedAt).toLocaleDateString() : ""),
      ]);

      const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
      downloadCSV(csv, `jumia-country-summary-${Date.now()}.csv`);
      toast.success("Country summary exported");
    } finally {
      setGenerating(null);
    }
  };

  const generateBatchesCSV = () => {
    setGenerating("batches");
    try {
      const headers = ["Batch ID", "File Name", "Total Products", "Products Analyzed", "Issues Found", "Status", "Started At", "Completed At"];
      const rows = (batches || []).map((b: any) => [
        escapeCsv(b.id),
        escapeCsv(b.fileName || ""),
        escapeCsv(b.totalProducts || 0),
        escapeCsv(b.productsAnalyzed || 0),
        escapeCsv(b.issuesFound || 0),
        escapeCsv(b.status),
        escapeCsv(b.startedAt ? new Date(b.startedAt).toLocaleString() : ""),
        escapeCsv(b.completedAt ? new Date(b.completedAt).toLocaleString() : ""),
      ]);

      const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
      downloadCSV(csv, `jumia-batches-${Date.now()}.csv`);
      toast.success("Batch history exported");
    } finally {
      setGenerating(null);
    }
  };

  const generateHTMLReport = () => {
    setGenerating("html");
    try {
      const filtered = (products || []).filter((p: any) => selectedCountry === "all" || p.country === selectedCountry);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Jumia Quality Analysis Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1100px; margin: 0 auto; padding: 40px 24px; color: #1f2937; }
    h1 { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 32px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; }
    .stat-label { font-size: 12px; color: #6b7280; }
    .stat-value { font-size: 28px; font-weight: 700; color: #111827; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th { text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f3f4f6; color: #374151; }
    tr:hover td { background: #f9fafb; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; background: #f3f4f6; color: #374151; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>Jumia Quality Analysis Report</h1>
  <p class="subtitle">Generated on ${new Date().toLocaleString()} · ${selectedCountry === "all" ? "All Markets" : COUNTRY_NAMES[selectedCountry] || selectedCountry}</p>
  
  <div class="stats">
    <div class="stat-card"><div class="stat-label">Products</div><div class="stat-value">${filtered.length}</div></div>
    <div class="stat-card"><div class="stat-label">Markets</div><div class="stat-value">${Object.keys(countryStats).length}</div></div>
    <div class="stat-card"><div class="stat-label">Total Issues</div><div class="stat-value" style="color:#ef4444">${latestBatch?.issuesFound || 0}</div></div>
    <div class="stat-card"><div class="stat-label">Batches</div><div class="stat-value">${batches?.length || 0}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>SKU</th><th>Product Name</th><th>Category</th><th>Country</th><th>Brand</th><th>Price</th>
      </tr>
    </thead>
    <tbody>
      ${filtered.slice(0, 500).map((p: any) => `
        <tr>
          <td style="font-family:monospace;font-size:11px;color:#9ca3af">${p.sku}</td>
          <td>${p.name}</td>
          <td>${p.category}</td>
          <td><span class="badge">${p.country} — ${COUNTRY_NAMES[p.country] || p.country}</span></td>
          <td>${p.brand || "—"}</td>
          <td>${p.price ? Number(p.price).toLocaleString() : "—"}</td>
        </tr>`).join("")}
    </tbody>
  </table>
  ${filtered.length > 500 ? `<p style="color:#9ca3af;font-size:12px;margin-top:8px">Showing first 500 of ${filtered.length} products</p>` : ""}
  <div class="footer">Jumia Quality Analyzer · Report generated ${new Date().toLocaleDateString()}</div>
</body>
</html>`;

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jumia-report-${selectedCountry}-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("HTML report downloaded");
    } finally {
      setGenerating(null);
    }
  };

  function downloadCSV(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalProducts = products?.length || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={14} /> Dashboard
          </button>
          <ChevronRight size={14} className="text-gray-300" />
          <span className="text-sm font-medium text-gray-800">Export & Reports</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Export & Reports</h1>
          <p className="text-gray-500 mt-1">Download reports and analysis data for offline use</p>
        </div>

        {/* Filter */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
          <Globe2 size={16} className="text-gray-400" />
          <span className="text-sm text-gray-600 font-medium">Filter by Country:</span>
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger className="w-52 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {Object.entries(COUNTRY_NAMES).map(([code, name]) => (
                <SelectItem key={code} value={code}>{code} — {name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-400 ml-auto">
            {selectedCountry === "all" ? totalProducts : (products || []).filter((p: any) => p.country === selectedCountry).length} products in scope
          </span>
        </div>

        {/* Export Options */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Export Options</h2>

          {[
            {
              id: "products",
              icon: <Package size={20} className="text-orange-500" />,
              title: "Products CSV",
              desc: "All product data with SKU, name, category, country, price and metadata",
              format: "CSV",
              action: generateProductsCSV,
            },
            {
              id: "summary",
              icon: <Globe2 size={20} className="text-blue-500" />,
              title: "Country Summary",
              desc: "Product counts and analysis stats per country market",
              format: "CSV",
              action: generateSummaryCSV,
            },
            {
              id: "batches",
              icon: <BarChart3 size={20} className="text-purple-500" />,
              title: "Batch History",
              desc: "Full history of all analysis runs with file names, counts and timestamps",
              format: "CSV",
              action: generateBatchesCSV,
            },
            {
              id: "html",
              icon: <FileText size={20} className="text-green-500" />,
              title: "Full HTML Report",
              desc: "Formatted printable report with product table and summary statistics",
              format: "HTML",
              action: generateHTMLReport,
            },
          ].map((opt) => (
            <div key={opt.id} className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center flex-shrink-0">
                {opt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">{opt.title}</h3>
                  <Badge variant="outline" className="text-xs">{opt.format}</Badge>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={opt.action}
                disabled={generating === opt.id || totalProducts === 0}
                className="gap-1.5 flex-shrink-0"
              >
                {generating === opt.id ? (
                  <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                Download
              </Button>
            </div>
          ))}
        </div>

        {/* Country breakdown */}
        {Object.keys(countryStats).length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Data Available by Country</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(countryStats)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([country, stats]) => (
                  <div key={country} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={13} className="text-green-500" />
                      <span className="text-sm font-medium text-gray-700">{country}</span>
                      <span className="text-xs text-gray-400">{COUNTRY_NAMES[country]}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{stats.count} products</Badge>
                  </div>
                ))}
            </div>
          </div>
        )}

        {totalProducts === 0 && (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-10 text-center">
            <FileSpreadsheet size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No data to export yet</p>
            <p className="text-gray-400 text-sm mt-1">Upload and analyze products first</p>
            <Button className="mt-4 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate("/upload")}>
              Upload Products
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
