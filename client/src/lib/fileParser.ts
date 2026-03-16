/**
 * File Parser - CSV and Excel support for product data
 */

export interface ParsedProduct {
  sku: string;
  name: string;
  brand?: string;
  category: string;
  country: "NG" | "EG" | "MA" | "KE" | "UG" | "GH" | "CI" | "TN" | "SN" | "DZ" | "IC";
  price?: number;
  description?: string;
  images?: string[];
  seller?: string;
  rating?: number;
  totalRatings?: number;
  url?: string;
}

export interface ParseResult {
  products: ParsedProduct[];
  errors: ParseError[];
  warnings: string[];
}

export interface ParseError {
  row: number;
  field: string;
  message: string;
}

const VALID_COUNTRIES = ["NG", "EG", "MA", "KE", "UG", "GH", "CI", "TN", "SN", "DZ", "IC"] as const;

const COLUMN_ALIASES: Record<string, string> = {
  // SKU
  "sku": "sku", "product_id": "sku", "item_id": "sku", "id": "sku", "product id": "sku",
  // Name
  "name": "name", "product_name": "name", "title": "name", "product name": "name", "product title": "name",
  // Brand
  "brand": "brand", "brand_name": "brand", "manufacturer": "brand",
  // Category
  "category": "category", "category_name": "category", "product_category": "category",
  // Country
  "country": "country", "country_code": "country", "market": "country", "region": "country",
  // Price
  "price": "price", "selling_price": "price", "sale_price": "price", "current_price": "price",
  // Description
  "description": "description", "product_description": "description", "details": "description",
  // Images
  "images": "images", "image_urls": "images", "image_url": "images", "photos": "images",
  // Seller
  "seller": "seller", "seller_name": "seller", "vendor": "seller", "shop": "seller",
  // Rating
  "rating": "rating", "product_rating": "rating", "stars": "rating",
  // Total ratings
  "total_ratings": "totalRatings", "ratings_count": "totalRatings", "reviews": "totalRatings",
  // URL
  "url": "url", "product_url": "url", "link": "url", "source_url": "url",
};

function normalizeHeader(header: string): string {
  const cleaned = header.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  return COLUMN_ALIASES[cleaned] || COLUMN_ALIASES[cleaned.replace(/_/g, " ")] || cleaned;
}

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = "";
        i++;
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        i += char === '\r' ? 2 : 1;
      } else if (char === '\r') {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function validateProduct(raw: Record<string, string>, rowIndex: number): { product: ParsedProduct | null; errors: ParseError[] } {
  const errors: ParseError[] = [];

  // Validate SKU
  const sku = raw.sku || raw.product_id || raw.id || `ROW_${rowIndex}`;
  if (!raw.sku && !raw.product_id && !raw.id) {
    errors.push({ row: rowIndex, field: "sku", message: "Missing SKU/Product ID, auto-generated" });
  }

  // Validate Name
  const name = raw.name;
  if (!name) {
    errors.push({ row: rowIndex, field: "name", message: "Product name is required" });
    return { product: null, errors };
  }

  // Validate Category
  const category = raw.category;
  if (!category) {
    errors.push({ row: rowIndex, field: "category", message: "Category is required" });
    return { product: null, errors };
  }

  // Validate Country
  const countryRaw = (raw.country || "NG").toUpperCase().trim();
  const country = VALID_COUNTRIES.includes(countryRaw as any)
    ? (countryRaw as ParsedProduct["country"])
    : "NG";
  if (!VALID_COUNTRIES.includes(countryRaw as any)) {
    errors.push({ row: rowIndex, field: "country", message: `Invalid country code "${countryRaw}", defaulting to NG` });
  }

  // Parse price
  let price: number | undefined;
  if (raw.price) {
    const cleaned = raw.price.replace(/[^0-9.]/g, "");
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) price = parsed;
  }

  // Parse images (comma or pipe separated)
  let images: string[] | undefined;
  if (raw.images) {
    images = raw.images
      .split(/[|,;]/)
      .map(url => url.trim())
      .filter(url => url.startsWith("http"));
  }

  // Parse rating
  let rating: number | undefined;
  if (raw.rating) {
    const parsed = parseFloat(raw.rating);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 5) rating = parsed;
  }

  // Parse total ratings
  let totalRatings: number | undefined;
  if (raw.totalRatings) {
    const parsed = parseInt(raw.totalRatings.replace(/[^0-9]/g, ""));
    if (!isNaN(parsed)) totalRatings = parsed;
  }

  const product: ParsedProduct = {
    sku: sku.toString(),
    name,
    brand: raw.brand || undefined,
    category,
    country,
    price,
    description: raw.description || undefined,
    images,
    seller: raw.seller || undefined,
    rating,
    totalRatings,
    url: raw.url || undefined,
  };

  return { product, errors };
}

export async function parseCSVFile(file: File): Promise<ParseResult> {
  const content = await file.text();
  const rows = parseCSV(content);

  if (rows.length < 2) {
    return {
      products: [],
      errors: [{ row: 0, field: "file", message: "File has no data rows" }],
      warnings: [],
    };
  }

  const headerRow = rows[0];
  const headers = headerRow.map(normalizeHeader);
  const products: ParsedProduct[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(cell => cell === "")) continue;

    const raw: Record<string, string> = {};
    headers.forEach((header, idx) => {
      raw[header] = row[idx] || "";
    });

    const { product, errors: rowErrors } = validateProduct(raw, i + 1);
    errors.push(...rowErrors);
    if (product) products.push(product);
  }

  if (products.length === 0) {
    warnings.push("No valid products found. Check column headers match expected format.");
  }

  return { products, errors, warnings };
}

export async function parseExcelFile(file: File): Promise<ParseResult> {
  // Dynamically import SheetJS
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs" as any);

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const jsonData: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (jsonData.length === 0) {
    return {
      products: [],
      errors: [{ row: 0, field: "file", message: "Excel sheet has no data" }],
      warnings: [],
    };
  }

  const products: ParsedProduct[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < jsonData.length; i++) {
    const rawRow = jsonData[i];
    const raw: Record<string, string> = {};

    Object.keys(rawRow).forEach(key => {
      const normalized = normalizeHeader(key);
      raw[normalized] = String(rawRow[key] ?? "");
    });

    const { product, errors: rowErrors } = validateProduct(raw, i + 2);
    errors.push(...rowErrors);
    if (product) products.push(product);
  }

  return { products, errors, warnings };
}

export async function parseFile(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") return parseCSVFile(file);
  if (ext === "xlsx" || ext === "xls") return parseExcelFile(file);

  return {
    products: [],
    errors: [{ row: 0, field: "file", message: `Unsupported file type: .${ext}. Use CSV or Excel.` }],
    warnings: [],
  };
}

export function generateSampleCSV(): string {
  const headers = ["sku", "name", "brand", "category", "country", "price", "description", "images", "seller", "rating", "total_ratings", "url"];
  const sample = [
    ["PRD001", "Samsung Galaxy A54 5G Smartphone 256GB", "Samsung", "Phones & Tablets", "NG", "350000",
      "The Samsung Galaxy A54 5G features a 6.4-inch Super AMOLED display", "https://example.com/img1.jpg|https://example.com/img2.jpg",
      "TechStore", "4.5", "128", "https://www.jumia.com.ng/samsung-a54"],
    ["PRD002", "Nike Air Max 270", "Nike", "Shoes", "KE", "12000", "Classic Nike running shoes", "", "SportZone", "4.2", "56", ""],
    ["PRD003", "Tefal Frying Pan 28cm", "Tefal", "Kitchen & Dining", "EG", "850", "", "https://example.com/pan.jpg", "HomeGoods", "", "", ""],
  ];
  return [headers, ...sample].map(r => r.join(",")).join("\n");
}
