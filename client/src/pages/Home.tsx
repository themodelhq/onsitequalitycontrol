import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload, BarChart3, AlertTriangle, Package, FileSpreadsheet,
  TrendingUp, Globe2, ChevronRight, Clock, ShieldAlert, Image, FileText, Tag, Ban
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", EG: "Egypt", MA: "Morocco", KE: "Kenya",
  UG: "Uganda", GH: "Ghana", CI: "Côte d'Ivoire", TN: "Tunisia",
  SN: "Senegal", DZ: "Algeria", IC: "Canary Islands",
};

export default function Dashboard() {
  const [, navigate] = useLocation();

  const { data: products, isLoading: productsLoading } = trpc.analysis.getProducts.useQuery({ limit: 500, offset: 0 });
  const { data: batches, isLoading: batchesLoading } = trpc.analysis.getBatches.useQuery();

  const isLoading = productsLoading || batchesLoading;

  const countryBreakdown = (products || []).reduce((acc: Record<string, number>, p: any) => {
    acc[p.country] = (acc[p.country] || 0) + 1;
    return acc;
  }, {});

  const countryChartData = Object.entries(countryBreakdown)
    .map(([country, count]) => ({ country, count, name: COUNTRY_NAMES[country] || country }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const totalProducts = products?.length || 0;
  const totalIssues = batches?.reduce((sum: number, b: any) => sum + (b.issuesFound || 0), 0) || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <ShieldAlert size={16} className="text-white" />
            </div>
            <span className="font-bold text-gray-900">Jumia Quality Analyzer</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/results")} className="gap-1.5">
              <BarChart3 size={13} /> Results
            </Button>
            <Button size="sm" onClick={() => navigate("/upload")} className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5">
              <Upload size={13} /> Upload Products
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quality Analysis Dashboard</h1>
          <p className="text-gray-500 mt-1">Monitor product quality across all Jumia markets</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Products", value: isLoading ? "—" : totalProducts.toLocaleString(), sub: "Analyzed products", icon: <Package size={16} className="text-gray-300" /> },
            { label: "Total Issues", value: isLoading ? "—" : totalIssues.toLocaleString(), sub: "Quality issues found", icon: <AlertTriangle size={16} className="text-red-300" />, red: true },
            { label: "Analysis Batches", value: isLoading ? "—" : String(batches?.length || 0), sub: "File uploads processed", icon: <FileSpreadsheet size={16} className="text-gray-300" /> },
            { label: "Markets Covered", value: isLoading ? "—" : String(Object.keys(countryBreakdown).length), sub: "Active country markets", icon: <Globe2 size={16} className="text-gray-300" /> },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">{stat.label}</span>
                {stat.icon}
              </div>
              <p className={`text-3xl font-bold ${stat.red ? "text-red-500" : "text-gray-900"}`}>{stat.value}</p>
              <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Products by Country</h3>
            {countryChartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data yet — upload products to begin</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={countryChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="country" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} labelFormatter={(l) => COUNTRY_NAMES[l] || l} />
                  <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800">Recent Analysis Batches</h3>
              <Button size="sm" variant="ghost" onClick={() => navigate("/results")} className="text-xs gap-1 h-7">View all <ChevronRight size={12} /></Button>
            </div>
            {!batches || batches.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center gap-3">
                <Clock size={32} className="text-gray-300" />
                <p className="text-sm text-gray-400">No analysis batches yet</p>
                <Button size="sm" onClick={() => navigate("/upload")} className="bg-orange-500 hover:bg-orange-600 text-white text-xs">Upload Products</Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto">
                {batches.slice(0, 6).map((batch: any) => (
                  <div key={batch.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${batch.status === "completed" ? "bg-green-500" : batch.status === "failed" ? "bg-red-500" : "bg-amber-400 animate-pulse"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 font-medium truncate">{batch.fileName || "Unnamed batch"}</p>
                      <p className="text-xs text-gray-400">{batch.productsAnalyzed || 0} products · {batch.issuesFound || 0} issues</p>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{batch.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {!isLoading && totalProducts === 0 && (
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-8 text-white flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold">Get Started</h3>
              <p className="text-orange-100 mt-1">Upload your first product file to analyze quality issues across Jumia markets</p>
            </div>
            <Button onClick={() => navigate("/upload")} className="bg-white text-orange-600 hover:bg-orange-50 gap-2 font-semibold">
              <Upload size={16} /> Upload Products
            </Button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: <Upload size={20} className="text-orange-500" />, title: "Upload Products", desc: "Upload CSV or Excel files to analyze product quality", action: () => navigate("/upload"), cta: "Upload File" },
            { icon: <BarChart3 size={20} className="text-blue-500" />, title: "View Results", desc: "Browse and filter all analysis results by country or issue type", action: () => navigate("/results"), cta: "View Results" },
            { icon: <TrendingUp size={20} className="text-green-500" />, title: "Export Reports", desc: "Download detailed reports with issue breakdowns and recommendations", action: () => navigate("/reports"), cta: "Export" },
          ].map((item) => (
            <div key={item.title} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100">{item.icon}</div>
              <div>
                <h4 className="text-sm font-semibold text-gray-800">{item.title}</h4>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.desc}</p>
              </div>
              <Button size="sm" variant="outline" onClick={item.action} className="mt-auto gap-1.5 self-start">
                {item.cta} <ChevronRight size={12} />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
