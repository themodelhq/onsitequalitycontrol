import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { parseFile, generateSampleCSV, type ParsedProduct, type ParseError } from "@/lib/fileParser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2,
  X, Download, ChevronRight, ArrowLeft, Info
} from "lucide-react";
import { toast } from "sonner";

type UploadStep = "idle" | "parsing" | "preview" | "uploading" | "done";

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", EG: "Egypt", MA: "Morocco", KE: "Kenya",
  UG: "Uganda", GH: "Ghana", CI: "Côte d'Ivoire", TN: "Tunisia",
  SN: "Senegal", DZ: "Algeria", IC: "Canary Islands",
};

export default function UploadPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<UploadStep>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [products, setProducts] = useState<ParsedProduct[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchResult, setBatchResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.analysis.uploadAndAnalyze.useMutation({
    onSuccess: (data) => {
      setBatchResult(data);
      setStep("done");
    },
    onError: (err) => {
      toast.error("Analysis failed: " + err.message);
      setStep("preview");
    },
  });

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) {
      toast.error("Please upload a CSV or Excel file");
      return;
    }

    setFileName(file.name);
    setStep("parsing");

    try {
      const result = await parseFile(file);
      setProducts(result.products);
      setParseErrors(result.errors);
      setParseWarnings(result.warnings);
      setStep("preview");

      if (result.products.length === 0) {
        toast.error("No valid products found in file");
      } else {
        toast.success(`Parsed ${result.products.length} products`);
      }
    } catch (err) {
      toast.error("Failed to parse file: " + (err instanceof Error ? err.message : "Unknown error"));
      setStep("idle");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleStartAnalysis = async () => {
    setStep("uploading");
    setUploadProgress(0);

    const interval = setInterval(() => {
      setUploadProgress(p => Math.min(p + 2, 90));
    }, 300);

    try {
      await uploadMutation.mutateAsync({
        fileName,
        products,
      });
      setUploadProgress(100);
    } finally {
      clearInterval(interval);
    }
  };

  const countByCountry = products.reduce((acc, p) => {
    acc[p.country] = (acc[p.country] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const downloadSampleCSV = () => {
    const csv = generateSampleCSV();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jumia-products-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
            Dashboard
          </button>
          <ChevronRight size={14} className="text-gray-300" />
          <span className="text-sm font-medium text-gray-800">Upload Products</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Step: Idle / Upload */}
        {(step === "idle" || step === "parsing") && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Upload Product Data</h1>
              <p className="mt-1 text-gray-500">
                Upload a CSV or Excel file with product data to analyze quality issues across Jumia markets.
              </p>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all
                ${isDragging
                  ? "border-orange-400 bg-orange-50 scale-[1.01]"
                  : "border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/30"
                }
                ${step === "parsing" ? "pointer-events-none opacity-70" : ""}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {step === "parsing" ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center animate-pulse">
                    <FileSpreadsheet size={28} className="text-orange-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">Parsing file...</p>
                    <p className="text-sm text-gray-500 mt-1">Extracting and validating product data</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isDragging ? "bg-orange-200" : "bg-gray-100"}`}>
                    <Upload size={28} className={isDragging ? "text-orange-600" : "text-gray-400"} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-800">
                      {isDragging ? "Drop your file here" : "Drag & drop or click to upload"}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Supports CSV, XLSX, XLS up to 50MB</p>
                  </div>
                </div>
              )}
            </div>

            {/* Expected Format */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Info size={16} className="text-blue-500" />
                  <span className="text-sm font-semibold text-gray-800">Expected Columns</span>
                </div>
                <Button size="sm" variant="outline" onClick={downloadSampleCSV} className="gap-1.5">
                  <Download size={13} />
                  Sample CSV
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {["sku*", "name*", "category*", "country*", "brand", "price", "description", "images", "seller", "rating"].map(col => (
                  <code key={col} className={`text-xs px-2 py-1 rounded font-mono ${col.endsWith("*") ? "bg-orange-50 text-orange-700 border border-orange-200" : "bg-gray-100 text-gray-600"}`}>
                    {col}
                  </code>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">* Required fields. Country codes: NG, EG, MA, KE, UG, GH, CI, TN, SN, DZ, IC</p>
            </div>
          </div>
        )}

        {/* Step: Preview */}
        {step === "preview" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Review & Confirm</h1>
                <p className="text-gray-500 mt-1">Review parsed data before starting analysis</p>
              </div>
              <button
                onClick={() => { setStep("idle"); setProducts([]); setParseErrors([]); }}
                className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
              >
                <X size={14} /> Change file
              </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500">Products</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{products.length}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500">Countries</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{Object.keys(countByCountry).length}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500">Parse Warnings</p>
                <p className={`text-3xl font-bold mt-1 ${parseErrors.length > 0 ? "text-amber-500" : "text-gray-900"}`}>
                  {parseErrors.length}
                </p>
              </div>
            </div>

            {/* Country breakdown */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Products by Country</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(countByCountry).map(([country, count]) => (
                  <div key={country} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                    <span className="text-xs font-bold text-gray-600">{country}</span>
                    <span className="text-xs text-gray-400">{COUNTRY_NAMES[country]}</span>
                    <Badge variant="secondary" className="text-xs">{count}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Warnings */}
            {parseErrors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} className="text-amber-500" />
                  <span className="text-sm font-semibold text-amber-800">{parseErrors.length} Parse Warnings</span>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {parseErrors.slice(0, 10).map((err, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      Row {err.row}, {err.field}: {err.message}
                    </p>
                  ))}
                  {parseErrors.length > 10 && (
                    <p className="text-xs text-amber-600 font-medium">+{parseErrors.length - 10} more warnings</p>
                  )}
                </div>
              </div>
            )}

            {/* Product Preview Table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-sm font-semibold text-gray-700">Preview (first 5 rows)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["SKU", "Name", "Category", "Country", "Brand", "Price"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 5).map((p, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.sku}</td>
                        <td className="px-4 py-2.5 text-gray-800 max-w-[200px] truncate">{p.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.category}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">{p.country}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{p.brand || "—"}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.price ? `${p.price.toLocaleString()}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                size="lg"
                onClick={handleStartAnalysis}
                disabled={products.length === 0}
                className="bg-orange-500 hover:bg-orange-600 text-white gap-2 px-8"
              >
                Start Analysis
                <ChevronRight size={16} />
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setStep("idle"); setProducts([]); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Step: Uploading */}
        {step === "uploading" && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center">
              <FileSpreadsheet size={36} className="text-orange-500 animate-pulse" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">Analyzing Products</h2>
              <p className="text-gray-500 mt-1">
                Running quality checks on {products.length} products...
              </p>
            </div>
            <div className="w-full max-w-md space-y-2">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-xs text-center text-gray-400">{uploadProgress}% complete</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-gray-500 max-w-sm w-full">
              {["Image quality checks", "Description validation", "Name format checks", "Prohibited items scan"].map((item, i) => (
                <div key={i} className={`flex items-center gap-2 transition-opacity ${uploadProgress > i * 25 ? "opacity-100" : "opacity-30"}`}>
                  <CheckCircle2 size={14} className="text-green-500" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && batchResult && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 size={36} className="text-green-500" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Analysis Complete!</h2>
              <p className="text-gray-500 mt-1">
                Analyzed {batchResult.productsAnalyzed} products and found {batchResult.totalIssues} issues.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-sm w-full">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-3xl font-bold text-gray-900">{batchResult.productsAnalyzed}</p>
                <p className="text-sm text-gray-500 mt-1">Products Analyzed</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className={`text-3xl font-bold ${batchResult.totalIssues > 0 ? "text-red-500" : "text-green-500"}`}>
                  {batchResult.totalIssues}
                </p>
                <p className="text-sm text-gray-500 mt-1">Issues Found</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                size="lg"
                onClick={() => navigate("/results")}
                className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
              >
                View Results
                <ChevronRight size={16} />
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setStep("idle"); setBatchResult(null); }}>
                Upload More
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
