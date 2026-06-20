
N E S T   P R O J E C T
Nest Mapping System
Development Roadmap
Mode-Specific Template Isolation, Product Matching, and Architecture Overhaul
Version 1.0  |  June 2026
Internal Technical Reference
Classification: Internal

Restaurant Financial Automation
 
Table of Contents

1. Executive Summary	1
2. Current State Analysis	2
2.1 Architecture Overview	2
2.2 The Two Mapping Systems	2
2.3 Critical Bug: ODDIAN Product Mapping Not Applying	3
2.4 Additional Known Issues	4
3. Phase 0: Stabilize Current System	4
3.1 Task 0.1: Fix ODDIAN Product Mapping (Data Structure Mismatch)	4
3.2 Task 0.2: Fix Excel Race Condition	5
3.3 Task 0.3: Fix Long Description Layout Overflow	6
3.4 Phase 0 Verification Matrix	7
4. Phase 1: Backend Foundation	7
4.1 Data Model Changes	7
4.2 Task Breakdown	7
4.3 Mode-Transaction Type Compatibility Matrix	8
4.4 Migration Strategy	8
5. Phase 2: Frontend Mode Isolation	8
5.1 Mode-Specific Section Visibility	9
5.2 Task Breakdown	9
6. Phase 3: Product Matching Rules Engine	9
6.1 Rule Types	10
6.2 Mode-Aware Default Rules	10
6.3 Task Breakdown	10
7. Phase 4: Advanced Features	10
7.1 Task Breakdown	11
8. Timeline Summary	11

 
[Right-click the table of contents above and select "Update Field" to refresh page numbers.]
 
1. Executive Summary
Nest is a Chrome extension that automates financial data transfer from Point-of-Sale (POS) systems and vendor invoices to QuickBooks Online. The platform currently supports three scan input modes (POS, Excel, and Image/PDF), four QuickBooks transaction types (Journal Entry, Bill, Vendor Credit, and Cheque), and two distinct mapping systems (field-level mapping for POS and product mapping for invoice line items). This roadmap documents the current state of the mapping system, identifies critical bugs blocking production use, and provides a phased implementation plan for the architectural overhaul described in the Nest Mapping Template System Technical Document v1.0.
The immediate priority is resolving a data structure mismatch bug that prevents product mappings from being applied to Bill preview forms. This bug, identified through code audit, causes the ODDIAN product-to-account mapping to silently fail, falling back to field-level mapping instead. Once this blocker is resolved, the roadmap proceeds through four additional phases: backend foundation changes (ScanMode enum, API updates), frontend mode isolation (adaptive MappingView), a configurable product matching rules engine (EXACT, CONTAINS, FUZZY, REGEX), and advanced features including approval workflows and sync pipeline hardening.
The total estimated effort spans 8 to 10 weeks for a single developer, with phases 1 and 2 forming the core architectural change and phases 3 and 4 representing incremental enhancements. Each phase includes specific verification checkpoints to ensure stability before proceeding.
2. Current State Analysis
2.1 Architecture Overview
Nest operates as a Chrome Extension (Manifest V3) with a React and TypeScript frontend, connected to an Express.js backend using Prisma ORM over PostgreSQL. Authentication uses JWT tokens, while QuickBooks integration uses OAuth 2.0. The frontend popup provides scan interfaces, mapping configuration, preview forms for each transaction type, and a sync pipeline that creates transactions in QuickBooks Online.
The system currently supports three scan modes that produce fundamentally different data shapes. POS mode injects content scripts into Toast, Oracle Simphony, and SALIDO browser tabs, extracting flat key-value pairs organized by financial category (for example, Revenue.Net Sales or Payments.Cash.Total). Excel mode parses uploaded spreadsheet files through a two-phase pipeline where users first configure column-to-semantic-field mappings, then the backend re-parses with those mappings to produce structured rows. Image/PDF mode uses Google Gemini 2.5 Flash for document classification and structured data extraction, producing header fields (vendor name, invoice number, date) plus line items with product names, quantities, and amounts.
2.2 The Two Mapping Systems
The mapping system is the critical bridge between raw scan data and structured QuickBooks transactions. Nest currently implements two distinct mapping systems that serve different purposes. Understanding their intended roles and current interactions is essential for diagnosing bugs and planning the architectural overhaul.
Field-Level Mapping (sourceField to account)
Field-level mapping associates a scan data field key directly to a QuickBooks account. Each mapping contains a sourceField (such as Revenue.Net Sales or a column header from Excel), a target accountId, a posting type (Debit or Credit), an optional description override, and optional class and tax code assignments. This system was designed for POS data where each field key represents an aggregated financial total that maps to a single account. It is stored in the Mapping database model and managed through the MappingTable component in MappingView.
Product Mapping (productName to account)
Product mapping associates a product name to a QuickBooks account. Each mapping contains a productName string (the catalog product identifier), a target accountId, a posting type, and optional class and tax code assignments. This system was designed for Image/PDF and Excel scans where invoice line items contain individual product names that need to be matched to expense or COGS accounts. It is stored in the ProductMapping database model and managed through the ProductMappingSection component. The matching is performed by the extractLineItems() function in column-extractor.ts, which iterates through scanned line items and looks up product names against the configured mappings.
2.3 Critical Bug: ODDIAN Product Mapping Not Applying
During end-to-end testing of the ODDIAN product mapping flow, a critical bug was discovered. The ODDIAN product mapping is correctly saved in the database (visible in MappingView as ODDIAN mapped to Cost of Materials with Debit posting type). However, when scanning an invoice containing the ODDIAN product, the Bill preview form shows the wrong account (Available for sale assets from field-level mapping) instead of the expected Cost of Materials from product mapping. No console errors are produced, indicating a silent failure in the mapping pipeline.
Root Cause Diagnosis (Code Audit)
Code audit identified a likely data structure mismatch between the backend API response and the frontend extractLineItems() function. The extractLineItems() function in column-extractor.ts expects productMappings with a flat productName property directly on each mapping object. However, the backend GET /api/product-mappings endpoint returns a structure where the product name is nested inside a separate product object (accessible as mapping.product.name rather than mapping.productName). This mismatch means the matching loop in extractLineItems() compares each scanned line item against undefined product names, causing every product lookup to silently fail. The field-level mapping effect then fills in the preview with its own account assignment, which is why the wrong account appears.
Component	Expected Property	Actual API Response	Impact
extractLineItems()	mapping.productName	mapping.product.name	Product name is undefined during matching
handleAutoFill()	productMappings[].productName	productMappings[].product.name	API data structure not transformed
Backend API	Flat productName field	Nested product object	Frontend cannot access product name directly
Table 1: Data Structure Mismatch Between API and Frontend
2.4 Additional Known Issues
Issue	Severity	Status	Phase
locId TDZ crash (ReferenceError)	Critical	Fixed in commit 3cec0f6, pushed	0 (done)
initialTemplate undefined crash	Critical	Fixed in commit 06f595b, pushed	0 (done)
ODDIAN product mapping not applying	Critical	Open - data structure mismatch	0
Excel race condition (both effects fire)	High	Open - field-level effect needs POS-only guard	0
CheckPreviewForm.tsx missing	High	File does not exist in codebase	2
Long description layout overflow	Medium	Open - prompt drafted, not executed	0
MappingView shows all sections for all types	Medium	Open - no mode-based filtering	2
No ScanMode field on Template model	Medium	Open - architectural gap	1
Fuzzy matcher unit tests missing	Low	Deferred - fuzzy-matcher.ts exists but untested	3
Table 2: Known Issues Tracker
3. Phase 0: Stabilize Current System
Phase 0 addresses all blocking issues in the current architecture before any structural changes are made. The guiding principle is: do not build new architecture on top of a broken foundation. The ODDIAN bug must be resolved first because it represents a fundamental failure in the core mapping pipeline. If product mappings cannot reliably apply to preview forms, there is no point adding mode isolation or configurable matching rules on top of that pipeline. This phase is estimated at 1 to 2 days of focused work.
All Phase 0 tasks must be verified through manual end-to-end testing using the verification matrix defined at the end of this section. No Phase 1 work should begin until the ODDIAN product mapping flow works correctly for Image/PDF source scans.
3.1 Task 0.1: Fix ODDIAN Product Mapping (Data Structure Mismatch)
Problem
The GET /api/product-mappings endpoint returns objects with a nested product relation (mapping.product.name), but extractLineItems() in column-extractor.ts reads mapping.productName. This causes all product lookups to fail silently because the comparison value is undefined.
Fix Steps
Step 1: Open the browser DevTools Network tab and navigate to the Bill preview after scanning an ODDIAN invoice. Locate the GET /api/product-mappings?templateId=... request and inspect the response JSON. Confirm whether the response contains productName as a flat field or product.name as a nested field.
Step 2: Based on the confirmed API response structure, apply one of two fixes. If the API returns nested product objects, add a transformation step in handleAutoFill() (and the auto-fill useEffect) that maps each API response object to the flat structure expected by extractLineItems(): const flatMappings = productMappings.map(pm => ({ ...pm, productName: pm.product?.name || pm.productName })). If the API returns flat productName, verify that extractLineItems() reads the correct property name.
Step 3: Also check the column-extractor.ts extractLineItems() function directly. Verify the exact property name it uses for product name lookup. If it reads productName but the data has a different key, update the lookup to handle both formats with a fallback: const name = pm.productName || pm.product?.name || '';
Step 4: Add a console.log inside the auto-fill effect immediately before the extractLineItems() call to log the productMappings array and verify it contains the expected ODDIAN entry with a non-undefined product name. This log should be removed after verification.
Step 5: Rebuild the extension, reload it in Chrome, rescan the ODDIAN invoice, and verify that the Bill preview shows Cost of Materials as the account. Commit as: fix: resolve product mapping data structure mismatch in extractLineItems.
3.2 Task 0.2: Fix Excel Race Condition
Problem
For Excel scans in Bill, Vendor Credit, and Check preview forms, both the product mapping auto-fill effect and the field-level mapping effect can fire simultaneously. The field-level mapping effect currently has a guard that blocks image and PDF sources but allows POS and Excel through. When both effects call setLines(), the one that resolves last overwrites the other, creating a race condition.
Fix
Change the field-level mapping effect source guard from if (activeScanEntry?.source === 'image' || activeScanEntry?.source === 'pdf') return; to if (activeScanEntry?.source !== 'pos') return;. This restricts field-level mapping to POS mode only, which is the only mode where it is semantically correct. For Image, PDF, and Excel scans, only the product mapping auto-fill effect should populate lines. This fix applies to BillPreviewForm.tsx, VendorCreditPreviewForm.tsx, and CheckPreviewForm.tsx (once created).
3.3 Task 0.3: Fix Long Description Layout Overflow
Problem
When product descriptions are long (such as ODDIANS Plastic UV Protected Poly Grow Nursery Plant Bags), the description input field in the Bill preview table overflows its allocated column width, breaking the table layout.
Fix
Add CSS properties to the description input cells: truncation with ellipsis for display, with full text visible on hover or focus. Alternatively, set a max-width on the description column and allow text wrapping within the cell using word-break: break-word combined with a reasonable max-width value.
3.4 Phase 0 Verification Matrix
Transaction Type	Source	Expected Behavior	Priority
Bill	Image/PDF	Product mapping applies (ODDIAN shows Cost of Materials)	P0
Bill	Excel	Product mapping applies, no field-level interference	P0
Bill	POS	Field-level mapping applies (POS-only path)	P1
Vendor Credit	Image/PDF	Product mapping applies, lines auto-populate	P0
Vendor Credit	Excel	Product mapping applies, no race condition	P1
Journal Entry	POS	Field-level mapping works, no regression	P0
MappingView	Any	Template pre-selects without crashing	P0
Table 3: Phase 0 End-to-End Verification Matrix
4. Phase 1: Backend Foundation
Phase 1 introduces the foundational data model and API changes required for mode-specific template isolation. The ScanMode enum becomes a required field on the Template model, the API layer is updated to accept and return scan mode information, and validation rules enforce mode-to-transaction-type compatibility. This phase does not change any frontend rendering logic; it only establishes the backend contract that Phase 2 will consume. Estimated duration: approximately 2 weeks for a single developer.
All backend changes must be backward-compatible with existing data through a migration script that infers scan mode from existing template configurations.
4.1 Data Model Changes
Model	Field	Type	Default	Notes
ScanMode (new enum)	N/A	enum { IMAGE, EXCEL, POS }	N/A	Must be defined before Template model
Template	scanMode	ScanMode	IMAGE	Required field with backward-compat default
Template	posSystem	String	null	Optional; only used when scanMode = POS
ProductMapping	matchingRule	Json	null	Null = use default exact + fuzzy behavior
ScanRecord	scanMode	ScanMode	IMAGE	Rename from source; map pdf to IMAGE
Table 4: Phase 1 Data Model Changes
4.2 Task Breakdown
ID	Task	Doc Reference	Est.
1.1	Add ScanMode enum to Prisma schema	Section 3.1, 7.1	2h
1.2	Add scanMode field to Template model (default: IMAGE)	Section 7.1	1h
1.3	Add matchingRule JSON field to ProductMapping model	Section 7.1	1h
1.4	Rename ScanRecord.source to scanMode, map pdf to IMAGE	Section 7.2	2h
1.5	Write migration script for existing templates	Section 10.1	3h
1.6	Update template API endpoints for scanMode	Section 8.1-8.2	3h
1.7	Add mode-type compatibility validation at API level	Section 3.3, 8.1	2h
1.8	New endpoint: PUT /product-mappings/:id/matching-rule	Section 8.4	2h
1.9	New endpoint: POST /product-mappings/test-match	Section 8.4	2h
Table 5: Phase 1 Task Breakdown
4.3 Mode-Transaction Type Compatibility Matrix
The following matrix defines which scan mode and transaction type combinations are allowed. POS mode is restricted to Journal Entry only because POS data lacks vendor references and line-item detail required by Bill, Vendor Credit, and Cheque transactions. This validation must be enforced at both the API level (returning 400 errors) and the UI level (disabling incompatible options in template creation).
Transaction Type	IMAGE Mode	EXCEL Mode	POS Mode	Rationale
Journal Entry	Allowed	Allowed	Allowed	Most flexible; maps any field to Dr/Cr lines
Bill	Allowed	Allowed	Blocked	POS lacks vendor reference and line items
Vendor Credit	Allowed	Allowed	Blocked	POS lacks vendor reference and line items
Cheque	Allowed	Allowed	Blocked	POS lacks payee and line-item detail
Table 6: Mode-Transaction Type Compatibility Matrix
4.4 Migration Strategy
Existing templates have no scanMode field. The migration script must infer the appropriate scan mode from existing template properties. Templates with transactionType JOURNAL_ENTRY that have field-level mappings containing POS-style keys (such as Revenue.Net Sales or Payments.Cash.Total) should be assigned POS mode. Templates with transactionType BILL, VENDOR_CREDIT, or CHEQUE should be assigned IMAGE mode as a safe default since these types are only compatible with IMAGE and EXCEL modes. Templates that have columnMappings configured should be assigned EXCEL mode. After migration, existing PDF scan records with source='pdf' must be mapped to the IMAGE scan mode value.
5. Phase 2: Frontend Mode Isolation
Phase 2 transforms the MappingView from a monolithic component (approximately 1,900 lines) that shows all mapping sections to all users into an adaptive, mode-aware interface that displays only the sections relevant to the active template's scan mode. This phase also removes the field-level mapping effects from Bill, Vendor Credit, and Check preview forms, eliminating the race condition permanently. Estimated duration: approximately 2 weeks.
The work can begin once Phase 1 backend changes are deployed, but the MappingView decomposition can be developed in parallel against a local mock API. The decomposition breaks the monolithic MappingView/index.tsx into composable section components: FieldMappingSection, ColumnMappingSection, ProductMatchingSection, TemplateDefaultsSection, RulesSection, and MemoTemplateSection. Each section exposes a compatibility method that the MappingView controller uses to determine visibility.
5.1 Mode-Specific Section Visibility
UI Section	IMAGE Mode	EXCEL Mode	POS Mode
Field-to-Account Mapping	Visible	Visible	Visible
Column Mapping Configuration	Hidden	Visible (Phase 1 step)	Hidden
Product Matching Section	Visible	Conditional (if product column mapped)	Hidden
Product Matching Rules	Visible	Conditional (if product column mapped)	Hidden
Template Defaults (Vendor, AP, etc.)	Visible for Bill/VC/Cheque	Visible for Bill/VC/Cheque	Hidden
Memo/Doc Number Templates	Visible	Visible	Visible
Rules Engine	Visible	Visible	Visible
Import/Export Template	Visible	Visible	Visible
Table 7: Mode-Specific Section Visibility Rules
5.2 Task Breakdown
ID	Task	Est.
2.1	Add scanMode to Template TypeScript types	1h
2.2	Template creation: add scan mode as mandatory Step 1 (3-step wizard)	4h
2.3	Template creation: disable incompatible transaction types per mode	2h
2.4	MappingView: decompose into section components	8h
2.5	MappingView: show/hide sections based on template.scanMode	4h
2.6	MappingView: hide Add Mapping (field-level) for Bill/VC/Cheque	2h
2.7	MappingView: show Product Mapping for Check templates	1h
2.8	Mode mismatch warning banner when template mode differs from scan source	3h
2.9	Preview forms: remove field-level mapping effect from Bill/VC/Check	2h
2.10	Create CheckPreviewForm.tsx (currently missing)	6h
Table 8: Phase 2 Task Breakdown
6. Phase 3: Product Matching Rules Engine
Phase 3 introduces a configurable matching rules engine that replaces the current exact-match-only product mapping with support for five rule types: EXACT, CONTAINS, STARTS_WITH, FUZZY (Jaro-Winkler), and REGEX. Each product mapping can have a single rule or an ordered array of rules evaluated by priority. The engine is mode-aware, applying different default thresholds for IMAGE mode (where OCR errors require fuzzy matching) versus EXCEL mode (where structured data favors exact matching).
The fuzzy-matcher.ts utility already exists in the codebase with a Jaro-Winkler implementation and token overlap pre-filtering. Phase 3 integrates this utility into the product matching pipeline, adds the backend rule evaluation engine, and builds the frontend UI for configuring and testing matching rules. Estimated duration: approximately 1.5 weeks.
6.1 Rule Types
Rule Type	Matching Logic	Example	Confidence
EXACT	Case-insensitive string equality after trimming	Coca-Cola 2L matches Coca-Cola 2L	1.0 (full)
CONTAINS	Input contains catalog name (or vice versa)	Coca-Cola 2L Bottle contains Coca-Cola	1.0 (full)
STARTS_WITH	Input starts with catalog name (or vice versa)	BEV-Coca-Cola 2L starts with BEV-Coca	1.0 (full)
FUZZY	Jaro-Winkler similarity above threshold	Coca-Coia 2L matches Coca-Cola 2L (0.95)	Similarity score
REGEX	Input matches user-defined pattern	Coke\s*(\d+)L matches Coke 2L	1.0 (full)
Table 9: Product Matching Rule Types
6.2 Mode-Aware Default Rules
Scan Mode	Default Rule Type	Default Threshold	Rationale
IMAGE	FUZZY	0.80	OCR errors require lower threshold; exact match as fast path
EXCEL	EXACT	N/A	Structured data favors exact match; contains handles abbreviations
POS	Disabled	N/A	No product names in aggregated POS totals
Table 10: Mode-Aware Default Matching Rules
6.3 Task Breakdown
ID	Task	Est.
3.1	Backend matching engine: evaluate rules by priority	6h
3.2	Mode-aware default rules (IMAGE=fuzzy 0.80, EXCEL=exact)	2h
3.3	Frontend: matching rule editor modal	6h
3.4	Frontend: rule testing UI (test input, show match result)	3h
3.5	Confidence indicators (green/yellow/red) in product mapping list	2h
3.6	Integrate rules engine into extractLineItems() pipeline	4h
3.7	Fuzzy matcher unit tests (Jaro-Winkler, token overlap)	3h
Table 11: Phase 3 Task Breakdown
7. Phase 4: Advanced Features
Phase 4 encompasses features that enhance the platform beyond core mapping functionality. These include a rules engine for data transformation (Combine, Deduct, Threshold, Formula), template import and export for configuration portability, an entry approval workflow for multi-user environments, and sync pipeline hardening with idempotency and retry mechanisms. These features are valuable but not blocking for the core use case of scanning invoices and syncing to QuickBooks.
The approval workflow and sync pipeline features are documented in Sections 11 and 12 of the Nest Mapping Template System Technical Document v1.0. They introduce new database models (Entry, SyncLog), new API endpoints, and new frontend views (Approved entries list, sync progress indicators). The scope is substantial and should be planned as a separate sprint after Phases 1 through 3 are stable in production. Estimated duration: 3 to 4 weeks.
7.1 Task Breakdown
ID	Task	Doc Reference	Est.
4.1	Rules Engine UI (Combine, Deduct, Threshold, Formula)	Section 6	10h
4.2	Template import/export (JSON format)	Section 10.3	4h
4.3	Entry approval workflow (OPEN to APPROVED to SYNCED)	Section 11	12h
4.4	Sync status tracking with idempotency and retry	Section 12.3-12.5	8h
4.5	Role-based sync control (who can approve, who can sync)	Section 11	6h
Table 12: Phase 4 Task Breakdown
8. Timeline Summary
The following timeline assumes a single developer working sequentially. Phases 1 and 2 can be partially parallelized if backend and frontend work are separated. The total duration of 8 to 10 weeks includes buffer time for bug fixes and monitoring between phases. Each phase transition requires a manual verification checkpoint before proceeding.
Phase	Duration	Dependencies	Exit Criteria
Phase 0: Stabilize	1-2 days	None (current codebase)	ODDIAN mapping works; no crashes; matrix passes
Phase 1: Backend	2 weeks	Phase 0 complete	ScanMode deployed; API returns scanMode; validation works
Phase 2: Frontend	2 weeks	Phase 1 deployed	MappingView adapts by mode; no field mapping for Bill/VC/Check
Phase 3: Matching Rules	1.5 weeks	Phase 2 deployed	Configurable rules work; fuzzy matching tested; confidence renders
Phase 4: Advanced	3-4 weeks	Phase 3 stable	Approval workflow functional; sync pipeline hardened
Table 13: Phase Timeline Summary
The critical path runs through Phase 0 into Phase 1, because the ODDIAN bug must be resolved before any architectural work begins. If Phase 0 reveals additional mapping pipeline issues, the timeline for subsequent phases may shift. The recommendation is to complete Phase 0, validate the core mapping flow end-to-end, and then reassess the timeline for Phases 1 through 4 with updated estimates based on any discoveries made during stabilization.
