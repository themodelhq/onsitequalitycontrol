import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
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
  ArrowLeft,
  Search,
  Download,
  Plus,
  Trash2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Image,
  FileText,
  Tag,
  Ban,
  Package,
  ChevronDown,
  ChevronUp,
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

const ISSUE_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  poor_image_quality: {
    label: "Poor Image Quality",
    icon: <Image size={11} />,
    color: "text-red-600 bg-red-50 border-red-200",
  },
  insufficient_images: {
    label: "Insufficient Images",
    icon: <Image size={11} />,
    color: "text-orange-600 bg-orange-50 border-orange-200",
  },
  non_white_background: {
    label: "Non-White Background",
    icon: <Image size={11} />,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  non_square_image: {
    label: "Non-Square Image",
    icon: <Image size={11} />,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  invalid_variation: {
    label: "Invalid Variation",
    icon: <Ban size={11} />,
    color: "text-orange-600 bg-orange-50 border-orange-200",
  },
  non_square_image: {
    label: "Non-Square Image",
    icon: <Image size={11} />,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  poor_description: {
    label: "Poor Description",
    icon: <FileText size={11} />,
    color: "text-yellow-600 bg-yellow-50 border-yellow-200",
  },
  missing_description_images: {
    label: "Missing Images in Desc.",
    icon: <FileText size={11} />,
    color: "text-orange-600 bg-orange-50 border-orange-200",
  },
  naming_format_violation: {
    label: "Naming Format Violation",
    icon: <Tag size={11} />,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  prohibited_item: {
    label: "Prohibited Item",
    icon: <Ban size={11} />,
    color: "text-red-700 bg-red-100 border-red-300",
  },
  blacklisted_keyword: {
    label: "Blacklisted Keyword",
    icon: <Ban size={11} />,
    color: "text-red-600 bg-red-50 border-red-200",
  },
  restricted_brand: {
    label: "Restricted Brand",
    icon: <ShieldAlert size={11} />,
    color: "text-purple-600 bg-purple-50 border-purple-200",
  },
  wrong_category: {
    label: "Wrong Category",
    icon: <Package size={11} />,
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
  },
  counterfeit_indicator: {
    label: "Counterfeit Indicator",
    icon: <ShieldAlert size={11} />,
    color: "text-red-700 bg-red-100 border-red-300",
  },
  non_square_image: {
    label: "Non-Square Image",
    icon: <Image size={11} />,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  thin_description: {
    label: "Thin Description",
    icon: <FileText size={11} />,
    color: "text-yellow-600 bg-yellow-50 border-yellow-200",
  },
  muddled_description: {
    label: "Muddled Description",
    icon: <FileText size={11} />,
    color: "text-orange-600 bg-orange-50 border-orange-200",
  },
  repeated_description: {
    label: "Repeated Description",
    icon: <FileText size={11} />,
    color: "text-gray-600 bg-gray-50 border-gray-200",
  },
  ng_seller_restriction: {
    label: "NG Seller Restriction",
    icon: <Ban size={11} />,
    color: "text-purple-600 bg-purple-50 border-purple-200",
  },
  ma_forbidden_brand: {
    label: "MA Forbidden Brand",
    icon: <Ban size={11} />,
    color: "text-red-700 bg-red-100 border-red-300",
  },
  ma_fragrance_only_brand: {
    label: "MA Fragrance-Only Brand",
    icon: <ShieldAlert size={11} />,
    color: "text-orange-700 bg-orange-100 border-orange-300",
  },
  ma_seller_restriction: {
    label: "MA Seller Restriction",
    icon: <Ban size={11} />,
    color: "text-purple-700 bg-purple-100 border-purple-300",
  },
  ma_prohibited_book_seller: {
    label: "MA Prohibited Book Seller",
    icon: <Ban size={11} />,
    color: "text-red-600 bg-red-50 border-red-200",
  },
  invalid_variation: {
    label: "Invalid Variation",
    icon: <ShieldAlert size={11} />,
    color: "text-orange-700 bg-orange-100 border-orange-300",
  },
  suspicious_price: {
    label: "Suspicious Price",
    icon: <ShieldX size={11} />,
    color: "text-red-700 bg-red-100 border-red-300",
  },
};

const SEVERITY_CONFIG: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  critical: {
    label: "Critical",
    color: "text-red-700 bg-red-100 border-red-300",
    dot: "bg-red-500",
  },
  high: {
    label: "High",
    color: "text-orange-700 bg-orange-100 border-orange-300",
    dot: "bg-orange-500",
  },
  medium: {
    label: "Medium",
    color: "text-amber-700 bg-amber-100 border-amber-300",
    dot: "bg-amber-400",
  },
  low: {
    label: "Low",
    color: "text-blue-700 bg-blue-100 border-blue-300",
    dot: "bg-blue-400",
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalysisIssue {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  details?: Record<string, any>;
}

interface IssueSummary {
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
}

interface CheckedProduct {
  sku: string;
  name: string;
  brand: string;
  category: string;
  country: string;
  price: number;
  currency: string;
  imageCount: number;
  thumbnailImage: string;
  description: string;
  keyFeatures: string[];
  specifications: Record<string, string>;
  hasDescriptionImages: boolean;
  seller: string;
  rating: number;
  totalRatings: number;
  url: string;
  suspiciousPrice: any;
}

interface CheckResult {
  url: string;
  product: CheckedProduct;
  issues: AnalysisIssue[];
  summary: IssueSummary;
  qualityScore: number;
  checkedAt: string;
}

interface UrlEntry {
  id: number;
  url: string;
  status: "idle" | "checking" | "done" | "error";
  errorMsg?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeScore(summary: IssueSummary): number {
  return Math.max(
    0,
    Math.min(
      100,
      100 -
        summary.criticalIssues * 25 -
        summary.highIssues * 12 -
        summary.mediumIssues * 6 -
        summary.lowIssues * 2
    )
  );
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

function scoreLabel(s: number) {
  if (s >= 80) return "Good";
  if (s >= 60) return "Fair";
  if (s >= 40) return "Poor";
  return "Critical";
}

function escapeCSV(v: any): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function exportCSV(results: CheckResult[]) {
  const headers = [
    "URL","Country","SKU","Name","Brand","Category","Price","Currency",
    "Image Count","Quality Score","Score Label","Has Desc. Images",
    "Seller","Rating","Total Ratings",
    "Critical Issues","High Issues","Medium Issues","Low Issues","Total Issues",
    "Non-Square Image","Invalid Variation","All Issues","Checked At",
  ];

  const rows = results.map((r) => [
    escapeCSV(r.url),
    escapeCSV(r.product.country),
    escapeCSV(r.product.sku),
    escapeCSV(r.product.name),
    escapeCSV(r.product.brand),
    escapeCSV(r.product.category),
    r.product.price,
    r.product.currency,
    r.product.imageCount,
    r.qualityScore,
    scoreLabel(r.qualityScore),
    r.product.hasDescriptionImages ? "Yes" : "No",
    escapeCSV(r.product.seller),
    r.product.rating,
    r.product.totalRatings,
    r.summary.criticalIssues,
    r.summary.highIssues,
    r.summary.mediumIssues,
    r.summary.lowIssues,
    r.summary.totalIssues,
    r.issues.some(i => i.type === "non_square_image") ? "YES" : "NO",
    r.issues.some(i => i.type === "invalid_variation") ? "YES" : "NO",
    escapeCSV(
      r.issues
        .map((i) => `[${i.severity.toUpperCase()}] ${i.message}`)
        .join(" | ")
    ),
    escapeCSV(r.checkedAt),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `quality-check-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Issue row ────────────────────────────────────────────────────────────────

function IssueRow({ issue }: { issue: AnalysisIssue }) {
  const cfg = ISSUE_TYPE_CONFIG[issue.type] ?? {
    label: issue.type.replace(/_/g, " "),
    icon: <AlertTriangle size={11} />,
    color: "text-gray-600 bg-gray-50 border-gray-200",
  };
  const sev = SEVERITY_CONFIG[issue.severity] ?? SEVERITY_CONFIG.low;

  return (
    <div
      className={`rounded-lg border p-3 ${
        issue.severity === "critical"
          ? "bg-red-50 border-red-200"
          : issue.severity === "high"
            ? "bg-orange-50 border-orange-200"
            : issue.severity === "medium"
              ? "bg-amber-50 border-amber-200"
              : "bg-blue-50 border-blue-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${sev.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span
              className={`inline-flex items-center gap-1 border text-[11px] font-medium px-1.5 py-0.5 rounded-full ${cfg.color}`}
            >
              {cfg.icon} {cfg.label}
            </span>
            <span
              className={`border text-[11px] font-medium px-1.5 py-0.5 rounded-full ${sev.color}`}
            >
              {sev.label}
            </span>
          </div>
          <p className="text-xs text-gray-700 leading-snug">{issue.message}</p>
          {issue.type === "suspicious_price" && issue.details?.floorPriceUSD && (
            <p className="text-[11px] text-gray-500 mt-0.5">
              Listed ≈ ${issue.details.listedPriceUSD} USD · Genuine floor ≈ $
              {issue.details.floorPriceUSD} USD
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({
  result,
  onRemove,
}: {
  result: CheckResult;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const score = result.qualityScore;
  const shown = expanded ? result.issues : result.issues.slice(0, 4);
  const extra = result.issues.length - 4;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Score accent bar */}
      <div
        className={`h-1 ${
          score >= 80
            ? "bg-green-500"
            : score >= 60
              ? "bg-amber-400"
              : score >= 40
                ? "bg-orange-500"
                : "bg-red-500"
        }`}
      />

      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-start gap-3">
          {result.product.thumbnailImage && (
            <img
              src={result.product.thumbnailImage}
              alt={result.product.name}
              className="w-14 h-14 object-cover rounded-lg border border-gray-200 flex-shrink-0 bg-gray-50"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-2xl font-bold ${scoreColor(score)}`}>
                {score}
              </span>
              <span className="text-sm text-gray-400">/100</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${scoreBadge(score)}`}
              >
                {scoreLabel(score)}
              </span>
            </div>
            <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 leading-snug">
              {result.product.name || "Unknown Product"}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {result.product.sku && (
                <span className="mr-2">SKU: {result.product.sku}</span>
              )}
              {result.product.brand && (
                <span className="mr-2">{result.product.brand}</span>
              )}
              <span>{result.product.country}</span>
            </p>
          </div>

          <button
            onClick={onRemove}
            className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Quick stats */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            🖼 {result.product.imageCount} image
            {result.product.imageCount !== 1 ? "s" : ""}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              result.product.hasDescriptionImages
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {result.product.hasDescriptionImages ? "✓" : "✗"} Desc. images
          </span>
          {result.product.price > 0 && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {result.product.currency}{" "}
              {result.product.price.toLocaleString()}
            </span>
          )}
          {result.product.seller && result.product.seller !== "Jumia" && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate max-w-[140px]">
              {result.product.seller}
            </span>
          )}
        </div>

        {/* Severity pills */}
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {result.summary.criticalIssues > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              {result.summary.criticalIssues} Critical
            </span>
          )}
          {result.summary.highIssues > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
              {result.summary.highIssues} High
            </span>
          )}
          {result.summary.mediumIssues > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              {result.summary.mediumIssues} Medium
            </span>
          )}
          {result.summary.lowIssues > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
              {result.summary.lowIssues} Low
            </span>
          )}
          {result.summary.totalIssues === 0 && (
            <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
              <CheckCircle2 size={11} /> All checks passed
            </span>
          )}
        </div>
      </div>

      {/* Issues list */}
      {result.issues.length > 0 && (
        <div className="p-4 space-y-2">
          {shown.map((issue, idx) => (
            <IssueRow key={idx} issue={issue} />
          ))}
          {extra > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium w-full justify-center py-1"
            >
              {expanded ? (
                <>
                  <ChevronUp size={12} /> Show less
                </>
              ) : (
                <>
                  <ChevronDown size={12} /> Show {extra} more issue
                  {extra !== 1 ? "s" : ""}
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 pb-3 flex items-center gap-3">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium"
        >
          <ExternalLink size={11} /> View on Jumia
        </a>
        <span className="text-xs text-gray-400 ml-auto">
          {new Date(result.checkedAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function QualityCheckPage() {
  const [, navigate] = useLocation();
  const [country, setCountry] = useState("NG");
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [singleUrl, setSingleUrl] = useState("");
  const [urlEntries, setUrlEntries] = useState<UrlEntry[]>([
    { id: 1, url: "", status: "idle" },
  ]);
  const nextId = useRef(2);

  const [results, setResults] = useState<CheckResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  const utils = trpc.useUtils();

  // ── Core check function ───────────────────────────────────────────────────

  async function runCheck(url: string): Promise<CheckResult> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 8000;
    const isNetworkErr = (e: unknown) => {
      if (!(e instanceof Error)) return false;
      const m = e.message.toLowerCase();
      return m.includes("failed to fetch") || m.includes("network") ||
             m.includes("load failed") || m.includes("unexpected end") ||
             m.includes("504") || m.includes("fetch");
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await utils.qualityCheck.checkUrl.fetch({
          url: url.trim(),
          country,
        });

        if (!res.ok || !res.product || !res.summary) {
          throw new Error((res as any).errorMessage || "Unknown error");
        }

        const summary = res.summary as IssueSummary;
        return {
          url,
          product: res.product as CheckedProduct,
          issues: res.issues as AnalysisIssue[],
          summary,
          qualityScore: computeScore(summary),
          checkedAt: new Date().toISOString(),
        };
      } catch (e) {
        lastErr = e;
        if (isNetworkErr(e) && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  function mergeResult(prev: CheckResult[], next: CheckResult): CheckResult[] {
    const idx = prev.findIndex((r) => r.url === next.url);
    if (idx >= 0) {
      const updated = [...prev];
      updated[idx] = next;
      return updated;
    }
    return [next, ...prev];
  }

  // ── Single mode ───────────────────────────────────────────────────────────

  const handleSingleCheck = async () => {
    if (!singleUrl.trim()) return;
    setIsChecking(true);
    setProgress(30);
    try {
      const result = await runCheck(singleUrl.trim());
      setResults((prev) => mergeResult(prev, result));
      setProgress(100);
      toast.success(`Score: ${result.qualityScore}/100 — ${result.summary.totalIssues} issue${result.summary.totalIssues !== 1 ? "s" : ""} found`);
    } catch (err) {
      toast.error(
        "Check failed: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
      setProgress(0);
    } finally {
      setIsChecking(false);
    }
  };

  // ── Bulk mode ─────────────────────────────────────────────────────────────

  const handleBulkCheck = async () => {
    const valid = urlEntries.filter((e) => e.url.trim());
    if (!valid.length) return;

    setIsChecking(true);
    setProgress(0);
    setUrlEntries((prev) =>
      prev.map((e) => (e.url.trim() ? { ...e, status: "idle" as const } : e))
    );

    const gathered: CheckResult[] = [];

    for (let i = 0; i < valid.length; i++) {
      const entry = valid[i];
      setUrlEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, status: "checking" as const } : e
        )
      );

      try {
        const result = await runCheck(entry.url);
        gathered.push(result);
        setUrlEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: "done" as const } : e
          )
        );
      } catch (err) {
        setUrlEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? {
                  ...e,
                  status: "error" as const,
                  errorMsg:
                    err instanceof Error ? err.message : "Failed",
                }
              : e
          )
        );
      }

      setProgress(Math.round(((i + 1) / valid.length) * 100));
    }

    if (gathered.length) {
      setResults((prev) => {
        let merged = [...prev];
        for (const r of gathered) merged = mergeResult(merged, r);
        return merged;
      });
      toast.success(
        `Checked ${gathered.length} product${gathered.length !== 1 ? "s" : ""}`
      );
    }

    setIsChecking(false);
  };

  // ── URL entry management ──────────────────────────────────────────────────

  const addEntry = () =>
    setUrlEntries((prev) => [
      ...prev,
      { id: nextId.current++, url: "", status: "idle" },
    ]);

  const removeEntry = (id: number) =>
    setUrlEntries((prev) => prev.filter((e) => e.id !== id));

  const updateEntry = (id: number, url: string) =>
    setUrlEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, url, status: "idle" } : e))
    );

  // ── Derived state ─────────────────────────────────────────────────────────

  const filteredResults =
    filterSeverity === "all"
      ? results
      : results.filter((r) =>
          r.issues.some((i) => i.severity === filterSeverity)
        );

  const avgScore =
    results.length > 0
      ? Math.round(
          results.reduce((s, r) => s + r.qualityScore, 0) / results.length
        )
      : 0;

  const totalUrgent = results.reduce(
    (s, r) => s + r.summary.criticalIssues + r.summary.highIssues,
    0
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Top nav — same style as every other page ── */}
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
                <ShieldAlert size={12} className="text-white" />
              </div>
              <span className="font-semibold text-gray-900 text-sm">
                Quality Checker
              </span>
            </div>
          </div>

          {results.length > 0 && (
            <Button
              size="sm"
              onClick={() => exportCSV(filteredResults)}
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
            >
              <Download size={13} /> Export CSV ({filteredResults.length})
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* ── Heading ── */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Product Quality Checker
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Analyse live Jumia product pages by URL — checks images, content,
            naming, category, counterfeit indicators, prohibited items and
            suspicious pricing
          </p>
        </div>

        {/* ── Input card ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          {/* Country selector + mode toggle */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Jumia Country
              </label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex border border-gray-200 rounded-lg p-1">
              {(["single", "bulk"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    mode === m
                      ? "bg-orange-500 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "single" ? "Single URL" : "Bulk URLs"}
                </button>
              ))}
            </div>
          </div>

          {/* Single URL input */}
          {mode === "single" && (
            <div className="flex gap-2">
              <Input
                placeholder="https://www.jumia.com.ng/your-product-name.html"
                value={singleUrl}
                onChange={(e) => setSingleUrl(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !isChecking && handleSingleCheck()
                }
                className="flex-1 text-sm"
              />
              <Button
                onClick={handleSingleCheck}
                disabled={isChecking || !singleUrl.trim()}
                className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shrink-0"
              >
                {isChecking ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Search size={14} />
                )}
                Check Quality
              </Button>
            </div>
          )}

          {/* Bulk URL inputs */}
          {mode === "bulk" && (
            <div className="space-y-2">
              {urlEntries.map((entry, idx) => (
                <div key={entry.id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <Input
                    placeholder={`https://www.jumia.com.ng/product-${idx + 1}.html`}
                    value={entry.url}
                    onChange={(e) => updateEntry(entry.id, e.target.value)}
                    className="flex-1 text-sm"
                  />
                  {/* Status icon */}
                  <div className="w-5 flex items-center justify-center shrink-0">
                    {entry.status === "checking" && (
                      <Loader2
                        size={14}
                        className="animate-spin text-orange-500"
                      />
                    )}
                    {entry.status === "done" && (
                      <CheckCircle2 size={14} className="text-green-500" />
                    )}
                    {entry.status === "error" && (
                      <ShieldX
                        size={14}
                        className="text-red-500"
                        title={entry.errorMsg}
                      />
                    )}
                  </div>
                  {urlEntries.length > 1 && (
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addEntry}
                  className="gap-1.5 text-xs"
                >
                  <Plus size={12} /> Add URL
                </Button>
                <Button
                  onClick={handleBulkCheck}
                  disabled={
                    isChecking || urlEntries.every((e) => !e.url.trim())
                  }
                  className="bg-orange-500 hover:bg-orange-600 text-white gap-2 text-sm"
                >
                  {isChecking ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  Check{" "}
                  {urlEntries.filter((e) => e.url.trim()).length > 0
                    ? urlEntries.filter((e) => e.url.trim()).length
                    : ""}{" "}
                  URL
                  {urlEntries.filter((e) => e.url.trim()).length !== 1
                    ? "s"
                    : ""}
                </Button>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {isChecking && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Analysing product page…</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </div>

        {/* ── What gets checked — shown only when there are no results yet ── */}
        {results.length === 0 && !isChecking && (
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">
              What gets checked
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                {
                  icon: (
                    <Image size={16} className="text-orange-500" />
                  ),
                  title: "Image Quality",
                  desc: "Count, resolution, white background requirements",
                },
                {
                  icon: (
                    <FileText size={16} className="text-blue-500" />
                  ),
                  title: "Content Quality",
                  desc: "Description length, key features, images in description",
                },
                {
                  icon: <Tag size={16} className="text-indigo-500" />,
                  title: "Naming Standards",
                  desc: "Category-specific naming format compliance",
                },
                {
                  icon: (
                    <Package size={16} className="text-teal-500" />
                  ),
                  title: "Category Accuracy",
                  desc: "Product assigned to the correct market category",
                },
                {
                  icon: <Ban size={16} className="text-red-500" />,
                  title: "Prohibited & Blacklisted",
                  desc: "Banned products and blacklisted keywords per market",
                },
                {
                  icon: (
                    <ShieldAlert size={16} className="text-red-600" />
                  ),
                  title: "Counterfeit & Price",
                  desc: "Fake indicators and suspiciously low luxury prices",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100"
                >
                  <div className="w-8 h-8 bg-white rounded-lg border border-gray-100 flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Results section ── */}
        {results.length > 0 && (
          <>
            {/* Summary stats — same 4-col grid as Home.tsx */}
            <div className="grid grid-cols-4 gap-4">
              {[
                {
                  label: "Products Checked",
                  value: results.length,
                  sub: "URLs analysed",
                  red: false,
                },
                {
                  label: "Avg Quality Score",
                  value: `${avgScore}/100`,
                  sub: `${scoreLabel(avgScore)} overall`,
                  red: false,
                },
                {
                  label: "Critical + High",
                  value: totalUrgent,
                  sub: "Urgent issues",
                  red: true,
                },
                {
                  label: "Fully Passed",
                  value: results.filter((r) => r.summary.totalIssues === 0)
                    .length,
                  sub: "No issues found",
                  red: false,
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-white border border-gray-200 rounded-xl p-4"
                >
                  <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
                  <p
                    className={`text-2xl font-bold ${
                      stat.red ? "text-red-500" : "text-gray-900"
                    }`}
                  >
                    {stat.value}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{stat.sub}</p>
                </div>
              ))}
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Severity filter pills */}
              <div className="flex gap-1 flex-wrap">
                {(
                  [
                    "all",
                    "critical",
                    "high",
                    "medium",
                    "low",
                  ] as const
                ).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setFilterSeverity(sev)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      filterSeverity === sev
                        ? sev === "critical"
                          ? "bg-red-600 text-white border-red-600"
                          : sev === "high"
                            ? "bg-orange-500 text-white border-orange-500"
                            : sev === "medium"
                              ? "bg-amber-500 text-white border-amber-500"
                              : sev === "low"
                                ? "bg-blue-500 text-white border-blue-500"
                                : "bg-gray-800 text-white border-gray-800"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {sev === "all"
                      ? "All"
                      : sev.charAt(0).toUpperCase() + sev.slice(1)}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1 text-gray-500"
                  onClick={() => setResults([])}
                >
                  <Trash2 size={12} /> Clear All
                </Button>
                <Button
                  size="sm"
                  onClick={() => exportCSV(filteredResults)}
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs"
                >
                  <Download size={12} /> Export CSV ({filteredResults.length})
                </Button>
              </div>
            </div>

            {/* Results grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredResults.map((result) => (
                <ResultCard
                  key={result.url}
                  result={result}
                  onRemove={() =>
                    setResults((prev) =>
                      prev.filter((r) => r.url !== result.url)
                    )
                  }
                />
              ))}
            </div>

            {filteredResults.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                <CheckCircle2
                  size={36}
                  className="text-green-400 mx-auto mb-3"
                />
                <p className="text-gray-600 font-medium">
                  No results match the current filter
                </p>
                <p className="text-gray-400 text-sm mt-1">
                  Switch to "All" to see everything
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
