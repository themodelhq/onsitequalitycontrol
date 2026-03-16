# Jumia Product Quality Analyzer - Development TODO

## Core Features

### 1. Data Management & Upload
- [x] Create database schema for products, analysis results, and reference data
- [ ] Implement file upload handler (Excel/CSV support)
- [ ] Parse and validate uploaded product data
- [x] Store naming format rules from reference sheet
- [x] Store prohibited items list with country-specific rules
- [x] Store blacklisted keywords and restricted brands

### 2. Image Quality Analysis
- [x] Implement image URL validation and fetching
- [x] Detect image resolution (flag poor resolution)
- [x] Detect non-white background images
- [x] Count images per product (flag <5 or only 1 image)
- [x] Store image analysis results in database

### 3. Description Quality Analysis
- [x] Validate description completeness
- [x] Check for missing key features and specifications
- [x] Detect poorly formatted descriptions
- [x] Parse HTML descriptions to detect product images
- [x] Flag products without images in description

### 4. Product Name Validation
- [x] Load category-specific naming formats
- [x] Validate product names against format rules
- [x] Flag products with non-compliant names
- [x] Support all product categories from naming sheet

### 5. Prohibited & Restricted Items Check
- [x] Implement prohibited items detection across all countries
- [x] Check for blacklisted keywords in product names/descriptions
- [x] Validate restricted brands per country
- [x] Support country-specific rules (NG, EG, MA, KE, UG, GH, CI, TN, SN, DZ, IC)
- [x] Flag counterfeit product indicators

### 6. Category Validation
- [x] Verify products are in correct categories
- [x] Check against sensitive category list
- [x] Validate category assignments per country

### 7. Analysis Dashboard & Results
- [ ] Create dashboard layout with filterable tables
- [ ] Display all flagged issues by country
- [ ] Display issues by type (image, description, naming, prohibited, category)
- [ ] Show product details with issue summaries
- [ ] Implement filtering and sorting

### 8. Export & Reporting
- [ ] Generate detailed analysis reports
- [ ] Export results as Excel/CSV
- [ ] Include issue breakdowns per product
- [ ] Support country-specific report views

### 9. Jumia Scraper Integration
- [ ] Integrate existing Jumia scraper for batch product fetching
- [ ] Support fetching products by category, search query, or SKU list
- [ ] Handle multi-country scraping
- [ ] Store scraped products for analysis

### 10. Backend API Routes
- [x] POST /api/trpc/upload - Handle file uploads
- [x] POST /api/trpc/analyze - Trigger analysis on uploaded products
- [x] GET /api/trpc/results - Fetch analysis results with filters
- [ ] POST /api/trpc/export - Generate and download reports
- [ ] POST /api/trpc/scrape - Fetch products from Jumia

### 11. Frontend UI Components
- [ ] Upload page with drag-and-drop
- [ ] Analysis dashboard with results table
- [ ] Filters for country, issue type, category
- [ ] Product detail view with issue breakdown
- [ ] Export/download buttons
- [ ] Progress indicators for long-running analyses

## Technical Implementation

### Database Schema
- [ ] Products table (SKU, name, brand, category, country, etc.)
- [ ] Product images table (URL, resolution, background color, etc.)
- [ ] Analysis results table (product_id, issue_type, severity, details)
- [ ] Reference data tables (naming formats, prohibited items, blacklisted keywords)

### Backend Services
- [ ] Image analysis service (resolution detection, background color detection)
- [ ] Description analysis service (HTML parsing, format validation)
- [ ] Name validation service (pattern matching against naming formats)
- [ ] Prohibited items checker (keyword matching, brand validation)
- [ ] Category validator (category mapping, sensitive category check)

### Frontend Pages
- [ ] Home/Dashboard page
- [ ] Upload page
- [ ] Analysis results page
- [ ] Product detail page
- [ ] Export/Reports page

## Testing
- [ ] Unit tests for analysis services
- [ ] Integration tests for API routes
- [ ] UI tests for dashboard and filters
- [ ] Test with sample data from each country

## Deployment
- [ ] Final checkpoint before publishing
- [ ] Verify all features working
- [ ] Performance optimization
