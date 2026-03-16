import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ChevronRight, AlertTriangle, ShieldAlert, CheckCircle2,
  Image, FileText, Tag, Ban, Package, Download, ExternalLink,
  AlertCircle, Info
} from "lucide-react";

const SEVERITY_CONFIG: Record<string, { label: string; badgeClass: string; dotClass: string; bgClass: string }> = {
  critical: {
    label: "Critical",
    badgeClass: "text-red-700 bg-red-100 border border-red-200",
    dotClass: "bg-red-500",
    bgClass: "bg-red-50 border-red-200",
  },
  high: {
    label: "High",
    badgeClass: "text-orange-700 bg-orange-100 border border-orange-200",
    dotClass: "bg-orange-500",
    bgClass: "bg-orange-50 border-orange-200",
  },
  medium: {
    label: "Medium",
    badgeClass: "text-amber-700 bg-amber-100 border border-amber-200",
    dotClass: "bg-amber-400",
    bgClass: "bg-amber-50 border-amber-200",
  },
  low: {
    label: "Low",
    badgeClass: "text-blue-700 bg-blue-100 border border-blue-200",
    dotClass: "bg-blue-400",
    bgClass: "bg-blue-50 border-blue-200",
  },
};

const ISSUE_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; group: string }> = {
  poor_image_quality: { label: "Poor Image Quality", icon: <Image size={14} />, group: "Image Issues" },
  insufficient_images: { label: "Insufficient Images", icon: <Image size={14} />, group: "Image Issues" },
  non_white_background: { label: "Non-White Background", icon: <Image size={14} />, group: "Image Issues" },
  poor_description: { label: "Poor Description", icon: <FileText size={14} />, group: "Content Issues" },
  missing_description_images: { label: "Missing Images in Description", icon: <FileText size={14} />, group: "Content Issues" },
  naming_format_violation: { label: "Naming Format Violation", icon: <Tag size={14} />, group: "Naming Issues" },
  prohibited_item: { label: "Prohibited Item", icon: <Ban size={14} />, group: "Compliance Issues" },
  blacklisted_keyword: { label: "Blacklisted Keyword", icon: <Ban size={14} />, group: "Compliance Issues" },
  restricted_brand: { label: "Restricted Brand", icon: <ShieldAlert size={14} />, group: "Compliance Issues" },
  wrong_category: { label: "Wrong Category", icon: <Package size={14} />, group: "Category Issues" },
  sensitive_category: { label: "Sensitive Category", icon: <AlertTriangle size={14} />, group: "Category Issues" },
  counterfeit_indicator: { label: "Counterfeit Indicator", icon: <ShieldAlert size={14} />, group: "Compliance Issues" },
};

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", EG: "Egypt", MA: "Morocco", KE: "Kenya",
  UG: "Uganda", GH: "Ghana", CI: "Côte d'Ivoire", TN: "Tunisia",
  SN: "Senegal", DZ: "Algeria", IC: "Canary Islands",
};

export default function ProductDetailPage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const productId = parseInt(params.id || "0");

  const { data: analysisResults, isLoading } = trpc.analysis.getProductResults.useQuery(
    { productId },
    { enabled: productId > 0 }
  );

  // Group issues by type/group
  const groupedIssues = (analysisResults || []).reduce((acc: Record<string, any[]>, issue: any) => {
    const config = ISSUE_TYPE_CONFIG[issue.issueType];
    const group = config?.group || "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(issue);
    return acc;
  }, {});

  const severityCounts = (analysisResults || []).reduce((acc: Record<string, number>, issue: any) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});

  const handleExportPDF = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 print:hidden">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/results")}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft size={14} />
              Results
            </button>
            <ChevronRight size={14} className="text-gray-300" />
            <span className="text-sm font-medium text-gray-800">Product #{productId}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportPDF}
            className="gap-1.5"
          >
            <Download size={13} />
            Export Report
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6 print:px-0 print:py-4">
        {/* Print Header */}
        <div className="hidden print:block mb-6">
          <h1 className="text-xl font-bold">Jumia Quality Analysis Report</h1>
          <p className="text-sm text-gray-500">Product ID: {productId} | Generated: {new Date().toLocaleDateString()}</p>
        </div>

        {/* Issue Summary */}
        <div className="grid grid-cols-4 gap-4">
          {["critical", "high", "medium", "low"].map((sev) => {
            const config = SEVERITY_CONFIG[sev];
            return (
              <div key={sev} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${config.dotClass}`} />
                  <span className="text-xs font-semibold text-gray-500 uppercase">{config.label}</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{severityCounts[sev] || 0}</p>
              </div>
            );
          })}
        </div>

        {/* No Issues */}
        {!isLoading && (!analysisResults || analysisResults.length === 0) && (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <CheckCircle2 size={48} className="text-green-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800">No Issues Found</h3>
            <p className="text-gray-500 mt-1">This product passed all quality checks</p>
          </div>
        )}

        {/* Issues by Group */}
        {Object.entries(groupedIssues).map(([group, issues]) => (
          <div key={group} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">{group}</h3>
              <Badge variant="outline" className="text-xs">{issues.length} issue{issues.length !== 1 ? "s" : ""}</Badge>
            </div>
            <div className="divide-y divide-gray-50">
              {issues.map((issue: any, i: number) => {
                const issueConfig = ISSUE_TYPE_CONFIG[issue.issueType];
                const sevConfig = SEVERITY_CONFIG[issue.severity];
                return (
                  <div key={i} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${sevConfig.bgClass} border`}>
                        <span className="text-gray-600">{issueConfig?.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">{issueConfig?.label || issue.issueType}</span>
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sevConfig.badgeClass}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sevConfig.dotClass}`} />
                            {sevConfig.label}
                          </span>
                          {issue.country && (
                            <Badge variant="outline" className="text-xs">{issue.country}</Badge>
                          )}
                        </div>

                        {issue.details && typeof issue.details === "object" && (
                          <div className="mt-2 space-y-1">
                            {Object.entries(issue.details).map(([key, val]: [string, any]) => (
                              <p key={key} className="text-xs text-gray-500">
                                <span className="font-medium text-gray-600">{key.replace(/_/g, " ")}:</span>{" "}
                                {typeof val === "object" ? JSON.stringify(val) : String(val)}
                              </p>
                            ))}
                          </div>
                        )}

                        {issue.recommendation && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-blue-700 bg-blue-50 px-3 py-2 rounded-lg border border-blue-100">
                            <Info size={12} className="mt-0.5 flex-shrink-0" />
                            <span>{issue.recommendation}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Back button */}
        <div className="pt-2 print:hidden">
          <Button variant="outline" onClick={() => navigate("/results")} className="gap-2">
            <ArrowLeft size={14} />
            Back to Results
          </Button>
        </div>
      </div>
    </div>
  );
}
