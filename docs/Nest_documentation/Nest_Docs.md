Nest Mapping Template System
Mode-Specific Blueprint & Implementation Guide
Project: Nest — Financial Automation
Version: 1.0
Date: 2026-06-16
Author: Technical Architecture Team
Classification: Internal Technical Documentation
 
Table of Contents
[Right-click and select “Update Field” to refresh]


1. Overview & Problem Statement
1.1 Document Purpose
This technical documentation provides a comprehensive blueprint for redesigning the Nest Mapping Template System to support mode-specific template isolation. The current system conflates mappings from all scan modes (POS, Excel, Image/PDF) into a single unified mapping interface, creating significant usability challenges and data integrity risks. This document defines the architectural changes, data model modifications, API updates, and frontend implementation guidelines necessary to enforce strict mode isolation at the template level, ensuring that each template and its associated mappings are exclusively tied to a single scan mode. The target audience includes backend engineers, frontend developers, database administrators, and product stakeholders who need to understand the full scope of the mapping system overhaul.
1.2 Current Architecture Summary
Nest is a restaurant financial automation platform that bridges Point-of-Sale (POS) systems with QuickBooks accounting. The platform operates as a Chrome Extension with an Express.js backend, utilizing Prisma ORM over PostgreSQL for data persistence and Google Gemini 2.5 Flash for AI-assisted invoice parsing and mapping suggestions. The mapping system is the critical bridge between raw scan data and structured QuickBooks journal entries, bills, vendor credits, and cheques. Templates serve as the organizational backbone: each template defines a transaction type (Journal Entry, Bill, Vendor Credit, or Cheque) and aggregates all associated mappings, product mappings, and transformation rules under a single configuration entity.
The current scan pipeline supports three distinct input modes: POS scan (which scrapes DOM data from Toast, Oracle Simphony, or SALIDO POS interfaces), Excel scan (which parses uploaded spreadsheet files with user-configured column mappings), and Image/PDF scan (which uses Gemini AI to classify and extract structured data from photographs or PDF documents of invoices, cheques, and receipts). Each mode produces data with fundamentally different shapes: POS generates flat key-value pairs (e.g., "Revenue.Net Sales: 1234.56"), Excel produces tabular rows with configurable columns, and Image/PDF yields structured header fields plus line items with product names, quantities, and amounts.
1.3 Core Problem: Mode Conflation in Mapping
The fundamental architectural flaw in the current system is the absence of a scan mode attribute on the Template model. Because templates do not declare which scan mode they serve, the Mapping View component displays all mappings from all modes in a single combined interface. When a user scans a POS report and navigates to the mapping section, they see Excel column mappings and Image product matching rules alongside POS field-to-account mappings, creating overwhelming visual noise and cognitive load. There is no mechanism to filter or hide mappings that are irrelevant to the current scan context, and users must manually distinguish which mappings apply to their specific use case.
1.3.1 Specific Symptoms of the Problem
•	A user scanning a POS report sees Excel column mapping fields (e.g., "Column A maps to Product Name") that are meaningless in the POS context, because POS data is structured as flat key-value pairs with no column concept.
•	A user uploading an Excel file sees POS-specific mapping fields (e.g., "Revenue.Net Sales") that do not exist in the spreadsheet data, because Excel data follows a row-based structure defined by user-configured column mappings.
•	A user scanning an invoice image encounters both flat POS field mappings and Excel column mappings simultaneously, despite the fact that invoice data uses a completely different structure (header fields + line items with product names).
•	The Product Mapping section appears regardless of scan mode, but product matching is only meaningful for Image/PDF and Excel scans where line items contain product names. POS reports aggregate totals by category and do not reference individual products.
•	When creating a new template, there is no way to specify the intended scan mode, meaning the system cannot validate whether a user is applying a template to a compatible scan source.
1.4 Impact on User Experience and Data Accuracy
The mode conflation problem has cascading consequences that extend beyond mere visual clutter. From a user experience perspective, the overwhelming display of irrelevant mappings creates confusion about which fields require configuration, leading to incomplete mappings, incorrect account assignments, and increased support requests. New users, in particular, struggle to understand the mapping system because they cannot distinguish which elements pertain to their specific workflow. The cognitive overhead of filtering irrelevant information mentally increases error rates and reduces the speed at which experienced users can configure templates.
From a data accuracy perspective, the lack of mode isolation creates a risk of cross-contamination between mapping types. A user might accidentally configure an Excel column mapping while working in an Image scan context, or assign a product matching rule to a POS template where it will never be evaluated. These orphaned or misapplied configurations not only waste user effort but can also produce unexpected behavior when the mapping engine encounters ambiguous field names that exist across multiple scan modes. Furthermore, the absence of mode-aware validation means that the system cannot warn users when they attempt to use an incompatible template for a given scan, such as applying a Bill template (designed for vendor invoices) to a POS daily summary.
1.5 Proposed Solution Direction
The solution proposed in this document centers on a single foundational principle: every template must declare its scan mode, and the mapping interface must enforce strict mode-based filtering. This principle drives a cascade of architectural changes: the Template data model gains a new scanMode field, the Mapping View filters displayed mappings based on the active template's mode, the product matching system gains configurable matching rules that vary by mode, and the template creation workflow requires mode selection as a mandatory first step. Additionally, the system must provide mode-aware validation warnings when users attempt to apply a template to an incompatible scan source, and the Journal Entry template, as the most flexible transaction type, must support all scan modes while Bill, Vendor Credit, and Cheque templates are restricted to Image/PDF and Excel modes where vendor and line-item data is available.
The following sections detail each component of this redesign, starting with a thorough analysis of scan mode architectures, proceeding through data model changes and API modifications, and concluding with a step-by-step frontend implementation guide and migration plan. The goal is to transform the mapping section from a confusing, mode-agnostic interface into a clear, mode-aware workspace where users see only the mappings, columns, and product rules relevant to their specific scanning workflow.
2. Scan Mode Architecture
2.1 Overview of Scan Modes
Nest supports three distinct scan modes, each corresponding to a fundamentally different input source and producing data in a unique structural format. Understanding the data shape of each mode is essential for designing a mapping system that respects mode boundaries and displays only relevant configuration options. The three modes are: Image/PDF mode (source: 'image'), Excel mode (source: 'excel'), and POS mode (source: 'pos'). Although the database ScanRecord model includes 'pdf' as a possible source value, the current implementation routes PDF files through the same Gemini AI pipeline as images, so PDF and Image share the same mapping architecture and are treated as a single mode throughout this document.
2.2 Image/PDF Scan Mode
The Image/PDF scan mode processes uploaded image files (JPEG, PNG) and PDF documents through Google Gemini 2.5 Flash for document classification and structured data extraction. When a user uploads a file, the system first performs client-side blur detection to reject low-quality images, then sends the file to the backend where Gemini classifies the document as INVOICE, CHEQUE, POS_REPORT, RECEIPT, or OTHER. Based on the classification result, a specialized parsing prompt extracts structured data: invoices yield vendor information, invoice numbers, dates, and line items; cheques yield check numbers, payee names, amounts, and bank details.
The extracted data follows a header-plus-line-items structure. Header fields include metadata such as vendor name, invoice date, document number, and total amount. Line items contain per-row product details: product name, quantity, unit price, line total, and optionally tax code. This structure is inherently different from POS mode (flat key-value pairs) and Excel mode (uniform tabular rows), and it necessitates a mapping system that can handle both header-level field-to-account mappings and line-item-level product-to-account mappings with configurable matching rules.
2.2.1 Image/PDF Data Structure
The following table describes the data fields typically available after an Image/PDF scan. These fields form the basis for mapping configuration in Image/PDF mode.
Field Category	Field Name	Type	Description
Header	vendorName	string	Name of the vendor or supplier
Header	invoiceNumber	string	Invoice or document reference number
Header	invoiceDate	date	Date on the invoice document
Header	dueDate	date	Payment due date
Header	totalAmount	number	Total invoice amount
Header	taxAmount	number	Total tax amount on the invoice
Line Item	productName	string	Product or service description
Line Item	quantity	number	Quantity ordered
Line Item	unitPrice	number	Price per unit
Line Item	lineTotal	number	Total for this line (qty x price)
Line Item	taxCode	string	Applicable tax code (optional)
2.3 Excel Scan Mode
The Excel scan mode processes uploaded spreadsheet files (.xlsx, .xls) through a two-phase pipeline. In Phase 1, the backend uses the xlsx library to parse the file and return sheet names, column headers, and preview rows. The user then configures column mappings through the template's columnMappings JSON field, assigning each column a semantic role (e.g., Product Name, Amount, Description, Class, Tax Code). In Phase 2, the backend re-parses the file using the configured column mappings to produce structured data rows that the mapping engine can process.
The Excel mode data structure depends entirely on the user's column mapping configuration. This means the mapping system must first present the column mapping interface (which does not exist in POS or Image modes) before displaying field-to-account mappings. The column mapping step is unique to Excel mode and is the primary reason why Excel templates require a different mapping workflow than other modes. Additionally, Excel data may contain line items with product names that require product matching, but the product name column must be explicitly mapped by the user before product matching rules can be evaluated.
2.3.1 Excel Column Mapping Configuration
The column mapping configuration is stored in the Template.columnMappings JSON field and defines how each spreadsheet column maps to a semantic field role. The following table lists the available column roles.
Column Role	Required	Description
productName	No*	Product or service description for line-item matching
amount	Yes	Numeric amount for the line item or header field
description	No	Memo or description text appended to the mapping
class	No	QuickBooks class assignment for the line item
taxCode	No	Tax code for the line item
date	Conditional	Transaction date (required for JE row-per-day templates)
docNumber	No	Document or reference number
vendor	Conditional	Vendor name (required for Bill/VC templates)
* productName is required when Product Mappings are configured for the template.
2.4 POS Scan Mode
The POS scan mode operates by injecting content scripts into browser tabs that match known POS system URLs. Three POS systems are currently supported: Toast (scanner.ts), Oracle Simphony (oracle-scanner.ts), and SALIDO Bridge (salido-scanner.ts). Each content script uses CSS selectors and DOM traversal to extract structured financial data from the POS interface, producing a flat dictionary of key-value pairs where keys follow a hierarchical naming convention (e.g., "Revenue.Net Sales", "Payments.Cash.Total", "Discounts.Employee Discount").
The POS data structure is fundamentally flat: there are no line items, no product names, and no vendor information. Each key represents an aggregated financial total for a specific category. This makes POS data inherently incompatible with Bill, Vendor Credit, and Cheque transaction types, which require vendor references and line-item detail. POS data is ideally suited for Journal Entry transactions where each field maps directly to a debit or credit line. The mapping system for POS mode should present only field-to-account mappings with posting type (Debit/Credit) selection, without any column mapping or product matching interfaces.
2.4.1 POS Data Structure
The following table lists representative field keys extracted from the Toast POS scanner. Other POS systems produce similar hierarchical key structures with different naming conventions.
Section	Field Key Example	Value Type	Typical Mapping
Revenue	Revenue.Net Sales	number	Credit to Sales Account
Revenue	Revenue.Gross Sales	number	Credit to Gross Sales
Payments	Payments.Cash.Total	number	Debit to Cash Account
Payments	Payments.Credit Card.Total	number	Debit to CC Receivable
Discounts	Discounts.Employee Discount	number	Debit to Discount Account
Taxes	Taxes.Sales Tax	number	Credit to Tax Payable
Tips	Tips.Total Tips	number	Credit to Tips Payable
Voids	Voids.Total Voids	number	Debit to Void/Contra Account
2.5 Comparative Analysis of Scan Modes
The structural differences between scan modes have direct implications for mapping system design. The following comparison table summarizes the key architectural differences that drive the need for mode-specific mapping interfaces. Each difference represents a dimension along which the mapping UI must adapt: if a mode does not produce line items, the product matching interface should be hidden; if a mode requires column configuration, that step must appear before field mapping; and if a mode only supports certain transaction types, the template creation workflow must enforce those constraints.
Dimension	Image/PDF Mode	Excel Mode	POS Mode
Data Shape	Header + Line Items	Tabular Rows (configurable)	Flat Key-Value Pairs
Column Mapping Step	Not required	Required (Phase 1)	Not applicable
Product Matching	Yes (line items)	Yes (if column mapped)	No (aggregated totals)
Vendor Information	Yes (extracted)	Yes (if column mapped)	No
Supported Txn Types	JE, Bill, VC, Cheque	JE, Bill, VC, Cheque	JE only
AI Parsing	Gemini classification + extraction	xlsx library parsing	DOM scraping (content scripts)
Source Fields	Dynamic (AI-extracted)	Dynamic (column-mapped)	Fixed per POS system
Mapping Complexity	High (header + line items)	Medium (column config + mapping)	Low (flat mapping)
2.6 Implications for Mapping System Design
The comparative analysis reveals three critical design requirements that the mode-specific mapping system must address. First, the mapping interface must be adaptive: it should show or hide entire sections (column mapping, product matching, field mapping) based on the active template's scan mode. A POS template should never display column mapping or product matching sections; an Excel template should always display column mapping before field mapping; and an Image/PDF template should display both field mapping and product matching but never column mapping.
Second, the template creation workflow must enforce mode-to-transaction-type compatibility. The validation matrix must prevent users from creating a Bill template for POS mode (since POS data lacks vendor and line-item information), and must guide users toward the correct combination of mode and transaction type. This validation should operate at the API level (returning 400 errors for incompatible combinations) and at the UI level (disabling incompatible options in the template creation form).
Third, the product matching system must be mode-aware in its rule application. In Image/PDF mode, product names come from AI-extracted text and may contain OCR errors or abbreviations, requiring fuzzy matching rules with configurable thresholds. In Excel mode, product names come from structured spreadsheet cells and are typically cleaner, allowing for stricter matching rules. In POS mode, product matching is entirely inapplicable and should not appear in the interface. These mode-specific matching behaviors are detailed further in Section 5 (Product Matching Rules Engine).
3. Template Mode Assignment
3.1 ScanMode Enum Definition
The foundational change for mode-specific template isolation is the introduction of a ScanMode enum that classifies every template by its intended scan source. This enum is stored as a new required field on the Template model and propagates through all mapping-related queries, API responses, and frontend rendering logic. The ScanMode enum defines three values that correspond directly to the three scan pipelines described in Section 2: IMAGE (covering both image and PDF uploads), EXCEL (covering spreadsheet uploads), and POS (covering browser-based POS DOM scraping). The PDF source is merged into the IMAGE mode because the current implementation routes PDFs through the same Gemini AI pipeline as images, and both produce the same header-plus-line-items data structure.
The enum must be defined consistently across the entire stack: in the Prisma schema (as a native enum), in the TypeScript frontend types, and in the API request/response interfaces. The following table defines each enum value along with its display label, icon recommendation, and a brief user-facing description suitable for the template creation form.
Enum Value	Display Label	Icon	User-Facing Description
IMAGE	Image / PDF	Camera	Scan invoices, receipts, and cheques from photos or PDF files
EXCEL	Excel Spreadsheet	FileSpreadsheet	Import financial data from uploaded Excel files
POS	POS Report	Monitor	Capture daily summaries directly from your POS system
3.2 Mode Selection in Template Creation
The template creation workflow must be modified to require scan mode selection as the first step, before the user chooses a transaction type or enters a template name. This ordering is critical because the scan mode determines which transaction types are available (e.g., POS mode only supports Journal Entry), which mapping sections will be displayed, and which configuration steps are required. The current workflow allows users to create a template without specifying any mode context, which is the root cause of the mode conflation problem described in Section 1.
The revised template creation workflow follows a three-step wizard pattern. Step 1 (Select Scan Mode) presents the three mode options as large selectable cards, each showing the icon, label, and description from the enum table above. The selected mode is stored in component state and used to filter the transaction type options in Step 2. Step 2 (Select Transaction Type) displays only the transaction types compatible with the chosen scan mode, as defined by the compatibility matrix in Section 3.3. Step 3 (Name & Configure) allows the user to name the template and configure mode-specific settings such as column mappings for Excel templates or default vendor for Image/PDF Bill templates.
3.3 Mode-Transaction Type Compatibility Matrix
Not all transaction types are compatible with all scan modes. The compatibility is determined by the data requirements of each transaction type: Bill, Vendor Credit, and Cheque transactions require vendor information and line-item detail that POS data simply does not provide. Journal Entry transactions, being the most flexible, can accept data from any scan mode. The following matrix defines which combinations are allowed, and the rationale for each restriction is explained below the table.
Transaction Type	IMAGE Mode	EXCEL Mode	POS Mode	Rationale if Restricted
Journal Entry	Allowed	Allowed	Allowed	Most flexible; maps any field to Dr/Cr lines
Bill	Allowed	Allowed	Blocked	POS lacks vendor reference and line items
Vendor Credit	Allowed	Allowed	Blocked	POS lacks vendor reference and line items
Cheque	Allowed	Allowed	Blocked	POS lacks payee and line-item detail
The POS mode restriction for Bill, Vendor Credit, and Cheque transaction types is a deliberate design decision based on the fundamental data shape mismatch. POS data consists of aggregated financial totals organized by category (e.g., "Revenue.Net Sales: 1234.56"), with no vendor reference, no individual line items, and no product-level detail. A Bill transaction in QuickBooks requires a vendor (AP account), at least one line item with an expense account, and optionally product/service references. Since POS data cannot fulfill these requirements, allowing a POS-mode Bill template would inevitably produce incomplete or invalid QuickBooks payloads. The same logic applies to Vendor Credit and Cheque transactions. Rather than allowing the combination and producing runtime errors during sync, the system enforces the restriction at template creation time, providing a clear explanation to the user.
3.4 Mode Validation Rules
Mode validation operates at two levels: the API level and the UI level. At the API level, the POST /api/templates endpoint must reject any template creation request with an incompatible scanMode and transactionType combination, returning a 400 status with a descriptive error message (e.g., "POS mode is not compatible with the Bill transaction type. Please select Journal Entry or choose a different mode."). Similarly, the PUT /api/templates/:id endpoint must prevent changing the scanMode or transactionType of an existing template to an incompatible combination if the template already has associated mappings, since changing the mode would invalidate existing mapping configurations.
At the UI level, the template creation form must disable incompatible transaction type options when a scan mode is selected, rather than displaying them and rejecting them on submit. Disabled options should include a tooltip explaining the incompatibility (e.g., hover text on a greyed-out "Bill" option: "Bill requires vendor and line-item data not available in POS mode"). This proactive guidance prevents user frustration and educates users about the relationship between scan modes and transaction types.
Additionally, when a user attempts to apply a template to a scan record whose source does not match the template's scanMode, the system must display a prominent warning banner in the Mapping View. The warning must include the template name, the template's assigned mode, the scan record's actual source, and a recommended action. For example: "Template 'Daily JE - Toast POS' is configured for POS mode, but the current scan is from an uploaded Excel file. Mappings may not align correctly. Consider selecting an Excel-mode template instead." This warning does not block the user from proceeding (since there may be legitimate edge cases), but it ensures the user is aware of the mismatch and can make an informed decision.
3.5 Mode-Specific Field Visibility
The scan mode assigned to a template determines which configuration sections and fields are visible in the Mapping View. This visibility logic must be enforced consistently across all mapping-related components to prevent the mode conflation described in Section 1.3. The following table defines the visibility rules for each major UI section based on the active template's scanMode. A section marked as "Visible" is displayed normally; "Hidden" means the section is completely omitted from the DOM; "Conditional" means the section appears only when a prerequisite configuration step has been completed.
UI Section	IMAGE Mode	EXCEL Mode	POS Mode
Field-to-Account Mapping	Visible	Visible	Visible
Column Mapping Configuration	Hidden	Visible (Phase 1)	Hidden
Product Matching Section	Visible	Conditional (if product column mapped)	Hidden
Product Matching Rules	Visible	Conditional (if product column mapped)	Hidden
Template Defaults (Vendor, AP, etc.)	Visible (Bill/VC/Cheque)	Visible (Bill/VC/Cheque)	Hidden
Memo/Doc Number Templates	Visible	Visible	Visible
Rules Engine (Combine, Deduct, etc.)	Visible	Visible	Visible
Import/Export Template	Visible	Visible	Visible
The Conditional visibility for Product Matching in Excel mode deserves additional explanation. Product matching requires a product name to match against, which in Excel mode comes from the column mapping configuration. If the user has not mapped any column to the "productName" role, the Product Matching section should be hidden because there is no data to match against. Once the user maps a column to productName, the Product Matching section appears automatically, and the system can begin evaluating product matching rules against the values in that column. In IMAGE mode, product names are always available (extracted by Gemini from invoice line items), so the Product Matching section is always visible. In POS mode, there are no line items and therefore no product names, making the section permanently hidden.
4. Mode-Specific Mapping Section Design
4.1 Mapping View Architecture
The Mapping View is the central interface where users configure how scan data fields map to QuickBooks accounts. In the redesigned system, the Mapping View must adapt its layout, available sections, and interaction patterns based on the scanMode of the active template. Rather than rendering a single monolithic view that shows all possible mapping types simultaneously, the redesigned Mapping View uses a composable section architecture where each section is a self-contained component that registers its mode compatibility. The Mapping View controller reads the active template's scanMode and renders only the sections that declare compatibility with that mode.
This composable architecture replaces the current approach in MappingView/index.tsx, which renders approximately 1,900 lines of JSX in a single component with conditional logic scattered throughout. The redesign decomposes this monolith into mode-aware section components: FieldMappingSection, ColumnMappingSection, ProductMatchingSection, TemplateDefaultsSection, RulesSection, and MemoTemplateSection. Each section component exposes a static method `isCompatible(scanMode: ScanMode): boolean` that the Mapping View controller calls during render to determine visibility. This approach ensures that adding a new scan mode in the future only requires updating the compatibility method on each section, rather than modifying scattered conditional logic across a monolithic component.
4.2 Image/PDF Mode Mapping Layout
When the active template has scanMode set to IMAGE, the Mapping View displays three primary sections in a vertical stack: Field Mapping, Product Matching, and Rules. The Field Mapping section allows users to bind AI-extracted header fields (vendorName, invoiceNumber, totalAmount, taxAmount) to QuickBooks accounts. Each mapping row displays the source field name on the left, a dropdown for the target QuickBooks account in the center, and a posting type selector (Debit/Credit) on the right. An expanded edit mode (currently MappingEditModal.tsx) provides additional fields for class assignment, entity binding (customer/vendor/employee), amount rule (Direct Amount, Percentage of Total, Static Value), and tax code override.
The Product Matching section in IMAGE mode is always visible because Gemini extraction always produces line items with product names. This section displays a card-based list of product mappings, where each card shows the product name, the assigned QuickBooks account, the posting type, and the matching rule (Exact, Contains, Fuzzy, etc. as detailed in Section 5). Users can add new product mappings by searching for a product name from the catalog, or the system can auto-generate suggestions based on line items found in recent scans. A confidence indicator (green/yellow/red) shows whether the current matching rule has a high, medium, or low likelihood of producing correct matches, based on historical matching data from the MappingPreference table.
For Bill, Vendor Credit, and Cheque transaction types in IMAGE mode, a Template Defaults section appears above the Field Mapping section. This section allows users to pre-configure default values that apply to every scan processed with this template: the vendor reference (for Bill/VC), the AP account, the bank account (for Cheque), and the terms. These defaults are stored in the Template.defaults JSON field and are auto-populated when the user reviews a scan in the BillPreviewForm, VendorCreditPreviewForm, or CheckPreviewForm components.
4.2.1 Image/PDF Mode Section Composition
Order	Section	Source Fields	Key Actions
1	Template Defaults	Vendor, AP Account, Bank, Terms	Set default vendor and accounts for Bill/VC/Cheque
2	Field Mapping (Header)	vendorName, invoiceNumber, totalAmount, taxAmount	Map header fields to QB accounts with Dr/Cr
3	Product Matching (Line Items)	productName per line item	Assign accounts per product with matching rules
4	Rules Engine	All mapped fields	Combine, Deduct, Threshold, Formula transformations
5	Memo/Doc Templates	Any field via {field} placeholders	Configure auto-generated memo and doc number text
4.3 Excel Mode Mapping Layout
When the active template has scanMode set to EXCEL, the Mapping View introduces a mandatory first step that does not exist in other modes: Column Mapping Configuration. This step is the bridge between the raw spreadsheet structure and the mapping system, and it must be completed before any other mapping configuration is possible. The Column Mapping interface displays the detected column headers from the uploaded file in a left column, with dropdown selectors in the right column for assigning each header to a semantic role (productName, amount, description, class, taxCode, date, docNumber, vendor).
The Column Mapping step is stored in the Template.columnMappings JSON field and is processed during the Phase 2 parsing (POST /api/templates/parse-excel-data). Once column mappings are configured and the file is re-parsed, the Mapping View transitions to the Field Mapping section, where the extracted fields are displayed for account assignment. The Field Mapping section in Excel mode works identically to the POS mode for Journal Entry templates (each row becomes a separate ScanEntry with flat fields), but for Bill/VC/Cheque templates, all rows are combined into a single ScanEntry with multiple line items.
The Product Matching section in Excel mode is conditionally visible: it appears only when the user has mapped a column to the "productName" role. This conditional visibility prevents the confusing scenario where a Product Matching section is displayed but has no product data to match against. When the productName column mapping is removed, the Product Matching section is automatically hidden, and any configured product mappings for that template are preserved but marked as inactive until a productName column is mapped again.
4.3.1 Excel Mode Section Composition
Order	Section	Prerequisite	Key Actions
1	Column Mapping Configuration	File uploaded and parsed (Phase 1)	Assign column headers to semantic roles
2	Template Defaults	Transaction type = Bill/VC/Cheque	Set default vendor and accounts
3	Field Mapping	Column mapping completed (Phase 2)	Map extracted fields to QB accounts
4	Product Matching	productName column mapped	Assign accounts per product with matching rules
5	Rules Engine	None	Combine, Deduct, Threshold, Formula transformations
6	Memo/Doc Templates	None	Configure auto-generated memo and doc number text
4.4 POS Mode Mapping Layout
When the active template has scanMode set to POS, the Mapping View displays the simplest and most focused layout. Only two sections are visible: Field Mapping and Rules. The Field Mapping section shows the POS field keys (e.g., "Revenue.Net Sales", "Payments.Cash.Total") as source fields, with dropdown selectors for the target QuickBooks account and posting type. Since POS data is always flat key-value pairs with predictable field names, the Auto-Detect feature (which uses regex pattern matching against field names) is particularly effective for POS templates and should be prominently offered as a one-click setup option.
The POS mode deliberately omits the Column Mapping section (because POS data has no columns to configure), the Product Matching section (because POS data contains aggregated totals, not individual products), and the Template Defaults section (because POS mode only supports Journal Entry, which does not require vendor or AP defaults). This minimal layout ensures that POS users see only the configuration relevant to their workflow, eliminating the confusion that arises when Excel and Image mapping sections are visible but inapplicable.
The POS Field Mapping section should also include a POS system indicator that shows which POS system (Toast, Oracle, SALIDO) the field keys originate from, since different POS systems produce different field names. This indicator helps users understand why certain fields appear and validates that the correct POS integration is active. If the user's location has multiple POS integrations configured, the template should allow specifying which POS system's field schema the mapping follows, ensuring that field names in the mapping match the actual data from the active POS.
4.4.1 POS Mode Section Composition
Order	Section	Source Fields	Key Actions
1	Field Mapping	POS key-value pairs (e.g., Revenue.Net Sales)	Map POS fields to QB accounts with Dr/Cr
2	Rules Engine	All mapped fields	Combine, Deduct, Threshold, Formula transformations
3	Memo/Doc Templates	Any field via {field} placeholders	Configure auto-generated memo and doc number text
4.5 Mode Transition and Mode Mismatch UX
A critical user experience scenario occurs when a user scans data in one mode but selects a template configured for a different mode. For example, a user uploads an Excel file (source: 'excel') but selects a template with scanMode: 'pos'. The current system does not detect this mismatch, leading to a Mapping View that displays POS field keys with no corresponding data. The redesigned system must detect mode mismatches at the point of template selection and present a clear, non-blocking warning.
The mode mismatch warning appears as a persistent banner at the top of the Mapping View, styled with an amber background and an alert icon. The banner text follows this template: "This template is configured for [Mode A] mode, but your current scan uses [Mode B]. Some mappings may not align with your data. [Switch to a [Mode B] template] [Dismiss]". The "Switch to a [Mode B] template" link opens a template selector filtered to show only templates with scanMode matching the current scan source. The "Dismiss" button closes the banner but does not suppress it for future visits, ensuring the warning reappears the next time the user opens the Mapping View with the same mismatched combination.
Additionally, the system should implement a smart template suggestion feature that automatically highlights the most appropriate template based on the current scan source. When a scan is completed, the system queries all templates for the current location, filters by scanMode matching the scan source, and ranks the remaining templates by relevance (e.g., most recently used, most mappings configured, same transaction type). The top-ranked template is pre-selected in the template dropdown, reducing the likelihood of mode mismatch and accelerating the user's workflow.
5. Product Matching Rules Engine
5.1 Current Matching Implementation
The existing product matching system in Nest implements a two-tier matching strategy: exact match first, followed by fuzzy match fallback. The exact match normalizes both the input product name and the catalog product names to lowercase, then compares them for string equality. If no exact match is found, the fuzzy matcher (fuzzy-matcher.ts) computes a similarity score using Jaro-Winkler distance combined with token overlap analysis. Matches above the FUZZY_MATCH_THRESHOLD (0.85) are accepted, while matches below the FUZZY_LOW_CONFIDENCE_THRESHOLD (0.92) are flagged as low-confidence. This approach works reasonably well for clean, structured data but has several limitations that become apparent when dealing with OCR-extracted text from scanned invoices.
The primary limitation is the lack of user-configurable matching strategies. The current system forces every product mapping through the same exact-then-fuzzy pipeline, regardless of the data quality or the user's preferences. A vendor who consistently uses abbreviated product names (e.g., "Coke 2L" instead of "Coca-Cola 2 Liter") needs a Contains rule, not a fuzzy match. A vendor whose invoices have OCR errors (e.g., "Coca-Coia" instead of "Coca-Cola") needs a higher fuzzy threshold. A vendor with a structured naming convention (e.g., all products start with a category code like "BEV-Coke") needs a Starts With rule. The current system cannot accommodate any of these scenarios, resulting in either missed matches or false positives that require manual correction.
5.2 Matching Rule Types
The redesigned Product Matching Rules Engine introduces five configurable matching rule types that users can assign to each product mapping. Each rule type defines a different strategy for comparing the input product name (from a scan) against the catalog product name. The rules are evaluated in a configurable priority order, and the first rule that produces a match determines the result. If no rule produces a match, the product is marked as unmatched and assigned a default account. The following table defines each rule type, its matching logic, and the recommended use case.
Rule Type	Matching Logic	Example Input	Example Catalog Name	Match Result
EXACT	Case-insensitive string equality after trimming whitespace	"Coca-Cola 2L"	"Coca-Cola 2L"	Match
CONTAINS	Input contains the catalog name (or vice versa) as a substring	"Coca-Cola 2L Bottle"	"Coca-Cola"	Match
STARTS_WITH	Input starts with the catalog name (or vice versa)	"BEV-Coca-Cola 2L"	"BEV-Coca"	Match
FUZZY	Jaro-Winkler similarity score above a configurable threshold	"Coca-Coia 2L" (OCR error)	"Coca-Cola 2L"	Match (if score >= threshold)
REGEX	Input matches a user-defined regular expression pattern	"Coke\s*(\d+)L"	"Coke 2L"	Match (regex captures)
5.3 Rule Configuration Schema
Each product mapping stores its matching rule configuration in a new JSON field called matchingRule on the ProductMapping model. This field replaces the implicit always-fuzzy behavior with an explicit, user-defined matching strategy. The matchingRule object follows the schema defined below. The ruleType field determines which matching algorithm to apply. The threshold field is only applicable to the FUZZY rule type and accepts a float value between 0.0 and 1.0 (default: 0.85). The pattern field is only applicable to the REGEX rule type and stores the regular expression pattern string. The caseSensitive field applies to EXACT, CONTAINS, and STARTS_WITH rules and defaults to false. The priority field determines the evaluation order when multiple rules are configured for the same product mapping (lower number = higher priority).
The matchingRule schema is structured as a JSON object with the following fields. The ruleType string must be one of EXACT, CONTAINS, STARTS_WITH, FUZZY, or REGEX. The threshold number is an optional field that applies only when ruleType is FUZZY; it defaults to 0.85 if omitted. The pattern string is an optional field that applies only when ruleType is REGEX; it stores the regular expression pattern without delimiters. The caseSensitive boolean defaults to false and applies to EXACT, CONTAINS, and STARTS_WITH rules. The priority number determines evaluation order among multiple rules for the same product mapping, with lower values evaluated first; it defaults to 0.
5.3.1 matchingRule JSON Examples
The following examples illustrate how the matchingRule JSON field is configured for different matching strategies. These examples demonstrate real-world scenarios that the current single-strategy fuzzy matcher cannot handle effectively.
Scenario	matchingRule JSON	Explanation
Standard exact match	{"ruleType":"EXACT","caseSensitive":false,"priority":0}	Most common; matches product names that are identical after normalization
Vendor uses abbreviations	{"ruleType":"CONTAINS","caseSensitive":false,"priority":0}	Matches when the catalog name appears as a substring within the scanned name
Category-prefixed products	{"ruleType":"STARTS_WITH","caseSensitive":false,"priority":0}	Matches products whose names start with a known prefix (e.g., category codes)
OCR errors in invoices	{"ruleType":"FUZZY","threshold":0.80,"priority":1}	Lower threshold accommodates OCR character substitution errors
Complex naming pattern	{"ruleType":"REGEX","pattern":"^Coke\\s*(\\d+)L$","priority":0}	Regex captures structured product names with variable components
Multi-rule fallback	[{"ruleType":"EXACT","priority":0},{"ruleType":"FUZZY","threshold":0.80,"priority":1}]	Array: try exact first, fall back to fuzzy with lower threshold
5.4 Multi-Rule Evaluation Pipeline
When a product mapping has multiple matching rules configured (stored as a JSON array in matchingRule), the matching engine evaluates them in priority order. The evaluation pipeline follows these steps. First, the engine retrieves the active product mapping rules for the current template, sorted by the priority field in ascending order. Second, for each scanned line item, the engine extracts the product name and normalizes it (lowercase, trimmed, collapse multiple spaces). Third, the engine iterates through the sorted rules for each product mapping, applying the matching logic defined by the ruleType. Fourth, if a rule produces a match, the engine records the match result with the rule type and confidence level, then stops evaluating further rules for that product mapping. Fifth, if no rules produce a match after all are evaluated, the product is marked as unmatched.
The confidence level returned by each rule type varies. EXACT, CONTAINS, and STARTS_WITH rules return a confidence of 1.0 (full confidence) because these rules are deterministic. FUZZY rules return the Jaro-Winkler similarity score as the confidence value, which may be below the low-confidence threshold. REGEX rules return 1.0 if the pattern matches, since regex is also deterministic. The confidence level is displayed in the UI as a color-coded indicator: green for confidence >= 0.92, yellow for confidence between 0.85 and 0.92, and red for confidence below 0.85. This visual feedback helps users quickly identify product mappings that may require manual review after scanning.
5.4.1 Evaluation Pipeline Flowchart
The matching evaluation pipeline follows a sequential decision flow. The steps below describe the flow for a single line item's product name against the configured product mapping rules.
Step	Action	Condition	Next Step
1	Extract and normalize product name from line item	Always	2
2	Retrieve product mapping rules sorted by priority	Template has product mappings	3
3	Apply next rule in priority order	Rules remaining	4
4	Evaluate match using rule logic (EXACT/CONTAINS/STARTS_WITH/FUZZY/REGEX)	Rule produces match	5
4a	No match from current rule	Rules remaining	3
4b	No match from current rule	No rules remaining	6
5	Record match with rule type and confidence, stop evaluation	Match found	7
6	Mark product as unmatched, assign default account	No match found	7
7	Proceed to next line item	Line items remaining	1
5.5 Mode-Aware Matching Behavior
The product matching engine adjusts its behavior based on the scan mode of the active template. This mode-awareness is essential because the quality and structure of product names vary significantly across scan sources. In IMAGE mode, product names are extracted by Gemini from scanned invoices and may contain OCR errors, abbreviations, or inconsistent formatting. The default matching rule for IMAGE mode should be FUZZY with a threshold of 0.80 (lower than the standard 0.85) to accommodate these imperfections. Users should be encouraged to add EXACT or CONTAINS rules as higher-priority overrides for products they scan frequently, so that common products match quickly and accurately while unusual or poorly scanned products fall through to the more permissive fuzzy rule.
In EXCEL mode, product names come from structured spreadsheet cells and are typically cleaner than OCR-extracted text. The default matching rule for EXCEL mode should be EXACT, since spreadsheet data is usually well-formatted and consistent. Users who import from vendors with abbreviated naming conventions can override the default with CONTAINS or STARTS_WITH rules. The FUZZY rule should be available but not included in the default configuration, since applying fuzzy matching to clean spreadsheet data increases the risk of false positives (e.g., "Rice" matching "Price" with a moderate Jaro-Winkler score).
In POS mode, product matching is entirely disabled because POS data does not contain individual product names. The ProductMappingSection component returns false from its isCompatible('POS') check, and the matching engine does not execute any rules for POS-mode templates. This prevents the confusing scenario where product matching rules are configured but never evaluated because the data lacks product names.
5.5.1 Default Matching Rules by Mode
Scan Mode	Default Rule Type	Default Threshold	Recommended Secondary Rule	Rationale
IMAGE	FUZZY	0.80	EXACT (priority 0)	OCR errors require lower threshold; exact match as fast path
EXCEL	EXACT	N/A	CONTAINS (priority 1)	Structured data favors exact match; contains handles abbreviations
POS	Disabled	N/A	N/A	No product names in aggregated POS totals
5.6 Product Matching UI Design
The Product Matching section within the Mapping View displays a list of configured product mappings, each rendered as a card component. Each card contains four primary elements: the product name (displayed prominently at the top), the assigned QuickBooks account (shown as a dropdown populated from QBContext), the posting type (Debit or Credit toggle), and the matching rule configuration (displayed as a compact rule badge with an edit button). The rule badge shows the rule type icon and label (e.g., a target icon for EXACT, a magnifying glass for CONTAINS, a waveform for FUZZY) along with the threshold value for FUZZY rules or the pattern preview for REGEX rules.
Clicking the edit button on the rule badge opens a Matching Rule Editor modal with the following fields: a Rule Type dropdown (EXACT, CONTAINS, STARTS_WITH, FUZZY, REGEX), a Case Sensitive toggle (enabled only for EXACT, CONTAINS, STARTS_WITH), a Threshold slider (enabled only for FUZZY, ranging from 0.50 to 1.00 with 0.05 increments), a Pattern text input (enabled only for REGEX, with a live regex tester that validates the pattern and shows match results against a sample product name), and a Priority number input (for ordering when multiple rules are configured). The modal includes a Test Match feature that allows users to enter a sample product name and see which rule would match it, with the confidence score displayed for FUZZY rules. This testing capability helps users validate their rule configuration before processing actual scans.
Below the product mapping cards, the section displays an Unmatched Products panel that lists product names from recent scans that were not matched by any configured rule. Each unmatched product has an "Add Mapping" button that creates a new product mapping with the unmatched name pre-filled as the product name and a suggested QuickBooks account based on historical MappingPreference data. This panel transforms the product matching workflow from a reactive process (configure mappings, scan, find unmatched items, go back and configure more mappings) into a proactive one (scan first, see unmatched items, add mappings directly from the results).
6. Journal Entry Template Mode Configuration
6.1 Journal Entry as the Universal Template
The Journal Entry (JE) template occupies a unique position in the Nest mapping system as the only transaction type that supports all three scan modes. This universality stems from the JE data model's fundamental flexibility: a journal entry consists of debit and credit lines with arbitrary account assignments, without requiring vendor references, line-item product detail, or payee information. Whether the source data is a flat POS summary (mapping each category total to a Dr/Cr line), a structured Excel spreadsheet (mapping each row to a Dr/Cr line), or an AI-extracted invoice (mapping header totals and line items to Dr/Cr lines), the JE template can accommodate the data without structural incompatibility.
This universality makes the JE template the recommended default for new users who are setting up their first template. When a user creates a template without a clear understanding of which transaction type they need, the JE template provides a safe starting point that works with any scan source. The system should offer the JE template as the pre-selected option in the template creation wizard, with Bill, Vendor Credit, and Cheque presented as specialized alternatives for users who specifically need vendor-facing transactions. The following subsections detail the mode-specific behavior of the JE template and explain why other transaction types cannot serve as universal templates.
6.2 Why Bill Templates Are Not Suitable for POS Scanning
A Bill transaction in QuickBooks requires three mandatory structural elements that POS data cannot provide. First, every Bill must reference a vendor (the entity to whom payment is owed), identified by a VendorRef in the QuickBooks API. POS daily summaries do not represent a purchase from a vendor; they represent an aggregation of sales transactions. There is no vendor to reference in a POS context because the restaurant is the seller, not the buyer. Assigning an arbitrary vendor to a POS-sourced Bill would produce meaningless accounts payable entries that misrepresent the financial reality.
Second, a Bill requires at least one line item with an AccountRef (the expense or asset account being debited) and an Amount. While POS data does contain amounts, these amounts represent revenue categories (sales, tips, taxes) rather than expenses. Mapping revenue amounts as Bill line items would create expense entries where income entries belong, fundamentally misrepresenting the accounting treatment. The correct accounting treatment for POS daily summaries is a journal entry that debits cash and credit card receivables while crediting revenue, tax payable, and tips payable accounts.
Third, Bills imply a future payment obligation (accounts payable), whereas POS summaries represent completed transactions with immediate or near-immediate settlement. Recording a POS daily summary as a Bill would create a false accounts payable entry, inflating liabilities on the balance sheet and requiring manual voiding or payment to clear. This creates additional reconciliation work and increases the risk of financial reporting errors. For these reasons, the system enforces the restriction that Bill templates can only be assigned to IMAGE or EXCEL scan modes, where vendor invoices provide the required vendor reference and expense-oriented line items.
6.3 Template Type × Scan Mode Validation Matrix
The complete validation matrix defines every combination of transaction type and scan mode, specifying whether the combination is allowed, blocked, or requires additional configuration. This matrix is the authoritative reference for both API-level validation and UI-level option filtering. The matrix expands on the simplified version presented in Section 3.3 by adding the configuration requirements and data dependency explanations that implementers must understand.
Transaction Type	IMAGE Mode	EXCEL Mode	POS Mode	Blocking Reason
Journal Entry	ALLOWED	ALLOWED	ALLOWED	No blocking: JE maps any field to Dr/Cr lines
Bill	ALLOWED	ALLOWED	BLOCKED	POS lacks VendorRef, expense-oriented line items, and AP context
Vendor Credit	ALLOWED	ALLOWED	BLOCKED	POS lacks VendorRef and credit-oriented line items
Cheque	ALLOWED	ALLOWED	BLOCKED	POS lacks PayeeRef and payment-oriented line items
6.3.1 Allowed Combinations: Configuration Requirements
For allowed combinations, the following configuration requirements apply depending on the transaction type and scan mode. These requirements determine which mapping sections are visible and which template defaults must be configured before the template can be used to process scans.
Combination	Required Config	Optional Config	Product Matching
JE + IMAGE	Field Mapping (header + line items)	Template defaults, Rules	Available
JE + EXCEL	Column Mapping + Field Mapping	Template defaults, Rules	Conditional (productName column)
JE + POS	Field Mapping (POS keys)	Rules, Memo templates	Not available
Bill + IMAGE	Field Mapping + Vendor default + AP Account default	Product Matching, Rules	Available
Bill + EXCEL	Column Mapping + Field Mapping + Vendor default	Product Matching, Rules	Conditional (productName column)
VC + IMAGE	Field Mapping + Vendor default + AP Account default	Product Matching, Rules	Available
VC + EXCEL	Column Mapping + Field Mapping + Vendor default	Product Matching, Rules	Conditional (productName column)
Cheque + IMAGE	Field Mapping + Payee/Bank defaults	Product Matching, Rules	Available
Cheque + EXCEL	Column Mapping + Field Mapping + Bank default	Product Matching, Rules	Conditional (productName column)
6.4 JE Mode-Specific Behavior
Although the JE template supports all scan modes, its behavior differs significantly depending on the assigned mode. These behavioral differences affect how scan data is transformed into journal entry lines, how the JE Builder (je-builder.ts) processes the data, and how the JournalEntryPreview component renders the results. The following subsections detail the mode-specific behavior of the JE pipeline.
6.4.1 JE + POS Mode
In POS mode, the JE template maps each flat key-value pair from the POS scanner to a single journal entry line. The posting type (Debit or Credit) is determined by the mapping configuration, with the guessPostingType() heuristic providing a default when the user has not explicitly set it. Negative amounts flip the posting side: a Credit mapping with a negative amount becomes a Debit, and vice versa. The resulting JE typically has 10-20 lines, one for each POS category (Net Sales, Gross Sales, Cash Total, Credit Card Total, Sales Tax, Tips, Voids, Discounts, etc.). The JE Builder's keepSeparate flag on individual mappings prevents line merging, ensuring that each POS category gets its own distinct line in the journal entry.
The POS mode JE workflow is the simplest and fastest in the system. Because POS field names are predictable and consistent (defined by the content script's CSS selectors), the Auto-Detect feature can automatically configure 80-90% of mappings for a new POS template. Users typically only need to verify the auto-detected accounts and adjust the posting type for edge cases like discounts or voids, which some accountants prefer to record as debits to contra-revenue accounts rather than negative credits to revenue.
6.4.2 JE + EXCEL Mode
In EXCEL mode, the JE template treats each spreadsheet row as a separate journal entry line. The Column Mapping configuration determines which columns map to the account reference, amount, description, class, and tax code for each line. This row-per-line approach is ideal for daily sales summaries exported from POS systems as spreadsheets, where each row represents one day's sales with columns for different revenue and payment categories. The JE Builder creates one ScanEntry per row, and each ScanEntry is processed through the standard mapping pipeline to produce a complete journal entry.
An important variant of JE + EXCEL mode is the "row-per-day" template, where the spreadsheet contains multiple days of data and each row should generate a separate journal entry (one per day). The current implementation handles this by creating a ScanEntry for each row and processing them independently. The date column (mapped in Column Mapping) provides the transaction date for each JE. This batch processing capability is one of the primary reasons users choose EXCEL mode over POS mode: they can process an entire week's or month's worth of daily summaries in a single upload, rather than scanning each day individually through the POS interface.
6.4.3 JE + IMAGE Mode
In IMAGE mode, the JE template processes AI-extracted invoice data as a single journal entry. The header fields (vendorName, invoiceNumber, totalAmount, taxAmount) are mapped to JE lines, and each line item is also mapped to a JE line using the Product Matching rules to determine the account assignment. The resulting JE typically has 5-15 lines, depending on the number of line items on the invoice. The JE Builder converts the ScanEntry's lineItems[0] (which contains all header fields as numeric values) to the flat ScanData format required by the legacy mapping pipeline, then adds product-mapped line items as additional lines.
The IMAGE mode JE workflow is the most complex because it combines header-level field mapping with line-item-level product matching. Users must configure two layers of mappings: the header mappings (which handle the overall invoice totals) and the product mappings (which handle individual line items). The system must ensure that header and line-item amounts are not double-counted. For example, if the totalAmount field is mapped to a Credit line, and individual line items are also mapped to Credit lines, the total would be overstated. The recommended approach is to map only line items when the invoice provides sufficient detail, or to map only header totals when line-item detail is unreliable (e.g., poor OCR quality). The Mapping View should display a warning when both header totals and line items are mapped simultaneously, alerting the user to the potential for double-counting.
6.5 Journal Entry Template as the Overall Template
The Journal Entry template serves as the overall template for the Nest system because it represents the most fundamental accounting transaction. Every other transaction type (Bill, Vendor Credit, Cheque) is essentially a specialized journal entry with additional QuickBooks-specific metadata (vendor reference, AP account, bank account). When a user is unsure which transaction type to choose, the JE template provides a safe default that can always be converted to a more specific type later, whereas converting a Bill template to a JE template would lose the vendor and AP configuration.
The recommended template creation strategy follows a "start with JE, specialize when needed" pattern. New users should create a JE template for their primary scan mode (POS for daily summaries, IMAGE for invoice processing, EXCEL for spreadsheet imports). As their workflow matures and they identify specific needs for vendor-facing transactions (e.g., they start processing vendor invoices that should be recorded as Bills rather than journal entries), they can create specialized templates with the appropriate transaction type and scan mode. The system should support cloning a JE template to a Bill/VC/Cheque template, preserving the field and product mappings while adding the required vendor and AP defaults.
This overall-template approach also simplifies the template selection UX. When a user completes a scan, the system first checks for templates matching the scan's source mode and the JE transaction type (the most common combination). If no JE template exists, the system then checks for Bill, VC, or Cheque templates. This prioritization ensures that the most commonly used template type is presented first, reducing the number of clicks required to process a scan. The template dropdown should display JE templates with a visual indicator (e.g., a journal icon) that distinguishes them from Bill/VC/Cheque templates (which should display their respective icons), making it easy for users to identify the template type at a glance.
7. Data Model & Schema Changes
7.1 Overview of Schema Modifications
The mode-specific template isolation feature requires modifications to three Prisma models: Template, ProductMapping, and ScanRecord. Additionally, a new ScanMode enum type must be introduced. These changes are designed to be additive (new fields with defaults) rather than destructive (no existing columns removed), ensuring backward compatibility with existing data and allowing a gradual migration. The following subsections detail each schema change, the rationale behind it, and the default values that maintain compatibility with the current system behavior.
7.2 ScanMode Enum
A new Prisma enum type ScanMode must be defined at the top of the schema file, before any model that references it. This enum standardizes the scan mode values across the entire application stack. The enum contains three values: IMAGE, EXCEL, and POS. The PDF source is not included as a separate value because the current implementation routes PDFs through the same pipeline as images, and both produce identical data structures. If a future implementation separates PDF processing into a distinct pipeline, a PDF value can be added to this enum without breaking existing data.
7.2.1 Prisma Enum Definition
The Prisma enum definition follows the standard syntax. Add the following block to schema.prisma before the Template model definition:
enum ScanMode {
  IMAGE
  EXCEL
  POS
}
7.3 Template Model Changes
The Template model requires two new fields: scanMode and posSystem. The scanMode field is the core addition that enables mode-specific template isolation, while the posSystem field provides an optional POS system identifier that is only relevant when scanMode is POS. Both fields are added with default values to ensure backward compatibility with existing templates that do not have a scan mode assigned.
7.3.1 New Field: scanMode
The scanMode field is a required ScanMode enum field added to the Template model. For backward compatibility, the field is added with a default value of IMAGE, which is the most common scan mode for existing templates (since the majority of existing templates process invoice images or PDFs). Existing templates that were created for POS or Excel workflows will need to be migrated manually or through a migration script (described in Section 10). The scanMode field is non-nullable, ensuring that every template has a well-defined mode. The Prisma field definition is as follows:
scanMode  ScanMode  @default(IMAGE)
The default value of IMAGE was chosen based on analysis of the existing Nest deployment data. The majority of templates in production are configured for invoice scanning (IMAGE mode), with POS and Excel templates comprising a smaller subset. Setting IMAGE as the default ensures that the migration has minimal impact on the most common use case, while the less common POS and Excel templates can be updated through a targeted migration script that infers the correct scanMode from existing template configuration (e.g., templates with columnMappings are likely EXCEL, templates whose names contain 'POS' or 'Toast' are likely POS).
7.3.2 New Field: posSystem
The posSystem field is an optional string field that identifies which POS system's field schema the template follows. This field is only meaningful when scanMode is POS, because different POS systems (Toast, Oracle Simphony, SALIDO) produce different field key naming conventions. When a POS template specifies a posSystem value, the Mapping View can display the correct field keys for that POS system, and the Auto-Detect feature can use system-specific pattern matching rules. The field is nullable and defaults to null. The Prisma field definition is as follows:
posSystem  String?
7.4 ProductMapping Model Changes
The ProductMapping model requires one new JSON field: matchingRule. This field stores the configurable matching rule configuration described in Section 5.3. The existing ProductMapping fields (templateId, productId, accountId, postingType, classId) remain unchanged.
7.4.1 New Field: matchingRule
The matchingRule field stores the matching rule configuration as a JSON object or array. When the field is null, the product mapping uses the default matching behavior (exact match first, then fuzzy match with threshold 0.85), preserving backward compatibility with existing product mappings. When the field contains a JSON object or array, the matching engine uses the configured rule(s) instead of the default behavior. The Prisma field definition is as follows:
matchingRule  Json?
The JSON structure stored in matchingRule follows the schema defined in Section 5.3. Single-rule configurations are stored as a JSON object with fields ruleType, threshold, pattern, caseSensitive, and priority. Multi-rule configurations are stored as a JSON array of such objects, sorted by priority. The matching engine detects whether matchingRule is an object or an array and handles both cases appropriately: a single object is treated as a one-element array with priority 0.
7.5 ScanRecord Model Changes
The ScanRecord model currently has a source field of type String that stores values like 'pos', 'excel', 'image', and 'pdf'. This field should be migrated to use the ScanMode enum type for consistency with the Template model. However, the current 'pdf' value does not have a corresponding ScanMode enum value. The migration strategy handles this by converting 'pdf' values to 'IMAGE' during the migration, since PDF files are processed through the IMAGE pipeline.
7.5.1 Field Type Change: source to scanMode
The existing source field on the ScanRecord model should be renamed to scanMode and its type changed from String to ScanMode. This change aligns the ScanRecord model with the Template model and enables direct comparison between a scan record's mode and a template's mode for mismatch detection. The migration must handle the value mapping as follows: 'pos' maps to POS, 'excel' maps to EXCEL, 'image' and 'pdf' both map to IMAGE.
Old source Value	New scanMode Value	Migration Action
'pos'	POS	Direct enum conversion
'excel'	EXCEL	Direct enum conversion
'image'	IMAGE	Direct enum conversion
'pdf'	IMAGE	Merge into IMAGE mode (same pipeline)
null or undefined	IMAGE	Default to IMAGE for backward compatibility
7.6 Complete Prisma Schema Diff
The following summary table lists all schema changes with their field definitions, types, defaults, and migration considerations. This table serves as the authoritative reference for implementing the Prisma migration.
Model	Field	Type	Default	Nullable	Migration Notes
(new enum)	ScanMode	enum { IMAGE, EXCEL, POS }	N/A	N/A	Add before Template model
Template	scanMode	ScanMode	IMAGE	No	Required field with backward-compat default
Template	posSystem	String	null	Yes	Optional; only used when scanMode=POS
ProductMapping	matchingRule	Json	null	Yes	Null = use default exact+ fuzzy behavior
ScanRecord	scanMode	ScanMode	IMAGE	No	Rename from 'source'; map 'pdf' to IMAGE
7.7 Migration Strategy
The Prisma migration must be designed to avoid data loss and minimize downtime. The recommended strategy uses a three-phase approach: add fields, migrate data, enforce constraints. In Phase 1 (Add Fields), the migration adds the ScanMode enum, the scanMode and posSystem fields to Template (with defaults), the matchingRule field to ProductMapping (nullable), and the scanMode field to ScanRecord (with default). All new fields have defaults or are nullable, so the migration is non-destructive and can be applied without modifying existing data.
In Phase 2 (Data Migration), a post-migration script scans existing templates and updates their scanMode field based on heuristic analysis of their configuration. Templates with populated columnMappings fields are set to EXCEL. Templates whose names contain case-insensitive substrings 'pos', 'toast', 'oracle', or 'salido' are set to POS. All remaining templates are left at the default IMAGE value. The script also converts ScanRecord.source values from 'pdf' to 'IMAGE'. This phase is idempotent and can be re-run safely if it fails partway through.
In Phase 3 (Enforce Constraints), after the data migration has been verified, a subsequent migration makes the scanMode field on Template non-nullable (if not already) and adds a composite index on (locationId, scanMode, transactionType) to optimize template lookup queries filtered by mode and transaction type. This index supports the smart template suggestion feature described in Section 4.5, which queries templates by location and scan mode to find the best match for a given scan source.
8. API Endpoint Changes
8.1 Overview of API Modifications
The introduction of scan mode isolation and configurable product matching rules requires targeted changes to the existing Nest API endpoints. The modifications follow three guiding principles: backward compatibility (existing API consumers continue to work without changes unless they opt into new features), mode-aware filtering (endpoints that return template or mapping data filter results by scan mode when the mode parameter is provided), and explicit validation (mode mismatch and rule validation errors are returned as structured warnings rather than hard errors, allowing the frontend to present actionable guidance). This section catalogs every affected endpoint, describes the changes, and specifies the new request and response fields.
8.2 Template Endpoints
8.2.1 GET /api/templates
The template listing endpoint is the primary entry point for template retrieval and must support mode-aware filtering. A new optional query parameter scanMode is added. When provided, the endpoint returns only templates whose scanMode matches the requested value. When omitted, all templates are returned (preserving backward compatibility). The response payload gains a scanMode field on each template object and a posSystem field when the template's scanMode is POS.
8.2.1.1 Request Parameters
Parameter	Type	Required	Default	Description
locationId	String	Yes	—	Filter templates by location (existing)
transactionType	String	No	null	Filter by transaction type: JE, BILL, VC, CHEQUE (existing)
scanMode	String	No	null	Filter by scan mode: IMAGE, EXCEL, POS (new)
includeMappings	Boolean	No	false	Include mapping data in response (existing)
8.2.1.2 Response Changes
Each template object in the response array now includes the following additional fields. The scanMode field is always present and defaults to 'IMAGE' for templates created before the migration. The posSystem field is present only when scanMode is 'POS' and the template has a posSystem configured. The modeMismatch object is included when a query parameter activeScanMode is provided and differs from the template's scanMode, providing the frontend with the data needed to render a warning banner.
Field	Type	Condition	Description
scanMode	String	Always	The template's scan mode: IMAGE, EXCEL, or POS
posSystem	String|null	scanMode=POS only	POS system identifier (e.g., 'toast', 'oracle')
modeMismatch	Object|null	activeScanMode provided	Contains {scanMode, templateMode, severity, message} when modes differ
8.2.2 POST /api/templates
The template creation endpoint must accept the new scanMode and posSystem fields in the request body. The scanMode field is required for new templates; omitting it returns a 400 error with a descriptive message. When scanMode is 'POS', the posSystem field becomes recommended (the API will accept a POS template without a posSystem, but the frontend should prompt the user to select one). The endpoint must validate the template type and scan mode combination against the compatibility matrix defined in Section 6.4. If an incompatible combination is detected (e.g., transactionType='BILL' and scanMode='POS'), the API returns a 422 Unprocessable Entity with a structured error object.
8.2.2.1 New Request Body Fields
Field	Type	Required	Validation	Description
scanMode	String	Yes	Must be IMAGE, EXCEL, or POS	Declares the template's scan mode
posSystem	String	No	Max 50 chars; required if scanMode=POS	POS system identifier for POS templates
8.2.2.2 Validation Error Response
When the template type and scan mode combination is incompatible, the API returns a 422 response with the following structured error payload. The errorCode field enables the frontend to distinguish mode compatibility errors from other validation errors and render the appropriate UI (e.g., a blocking error dialog versus a dismissible warning). The allowedModes field tells the frontend which modes are valid for the requested transaction type, enabling it to update the mode selector dynamically.
Field	Type	Description
errorCode	String	'MODE_TYPE_INCOMPATIBLE' — constant for this specific validation failure
message	String	Human-readable message, e.g., 'Bill templates do not support POS scan mode'
transactionType	String	The transaction type that was rejected
requestedMode	String	The scan mode that was rejected
allowedModes	String[]	Array of allowed scan modes for this transaction type, e.g., ['IMAGE', 'EXCEL']
8.2.3 PATCH /api/templates/:id
The template update endpoint must handle scanMode changes with care. Changing a template's scanMode may invalidate existing field mappings or product mappings that are mode-specific. The endpoint performs the following validation sequence when scanMode is included in the patch payload. First, it checks the mode-type compatibility matrix (same as POST). Second, it identifies any existing mappings that are incompatible with the new mode (e.g., columnMappings exist but the new mode is IMAGE, or product mappings exist but the new mode is POS). Third, it returns a warning response listing the affected mappings rather than silently deleting them, allowing the user to review and confirm the change.
8.2.3.1 Mode Change Warning Response
When a scanMode change would affect existing mappings, the PATCH endpoint returns a 200 response with a warnings array alongside the updated template. The frontend must display these warnings to the user and require explicit confirmation before the mappings are deactivated (not deleted). The warnings include enough detail for the frontend to render a summary like "3 column mappings will be hidden in IMAGE mode" with an expandable list of affected mappings.
Field	Type	Description
warnings	Array	List of mode-change warnings
warnings[].type	String	'MAPPING_INCOMPATIBLE' — indicates a mapping that is not visible in the new mode
warnings[].mappingType	String	'columnMapping', 'productMapping', or 'fieldMapping'
warnings[].count	Number	Number of affected mappings of this type
warnings[].modeVisibility	String	The visibility status in the new mode: 'hidden' or 'conditional'
confirmationRequired	Boolean	true if warnings exist; the client must send a follow-up request with confirmed:true
8.3 Mapping Endpoints
8.3.1 GET /api/templates/:id/mappings
The mapping retrieval endpoint returns the field and product mappings for a specific template. The response now includes a scanMode field at the top level (inherited from the template) and a sections array that groups mappings by their mode-specific section (as defined in Section 4). Each section object includes an isCompatible boolean that indicates whether the section is visible for the template's current scanMode. The frontend uses this to render only the compatible sections, replacing the current approach of showing all sections and hiding irrelevant ones with CSS.
8.3.1.1 Response Structure Changes
The response envelope gains the following new fields. The scanMode field mirrors the template's mode, allowing the frontend to initialize the mode context without a separate template fetch. The sections array replaces the flat mappings array with a structured, mode-aware organization. Each section includes a key (matching the composable section component name), a label (human-readable section name), an isCompatible flag, and the mapping data relevant to that section. The productMappings section includes an additional matchingRules field that contains the parsed matchingRule JSON from each ProductMapping record, normalized to an array format (single rules are wrapped in a one-element array).
Field	Type	Description
scanMode	String	Template's scan mode: IMAGE, EXCEL, or POS
sections	Array	Mode-aware grouping of mappings
sections[].key	String	Section identifier: 'fieldMapping', 'columnMapping', 'productMatching', 'templateDefaults'
sections[].label	String	Human-readable section name, e.g., 'Column Mapping'
sections[].isCompatible	Boolean	Whether this section is visible for the current scanMode
sections[].mappings	Array	Mapping data for this section (structure varies by section key)
8.3.2 POST /api/templates/:id/mappings (Batch Update)
The batch mapping update endpoint must validate that all submitted mappings are compatible with the template's scanMode. Specifically, column mapping data should not be submitted for IMAGE or POS mode templates, and field mapping data should not include POS-specific keys for IMAGE mode templates. Incompatible mappings are not rejected with an error; instead, they are silently ignored with a warning entry in the response. This design prevents partial update failures when a frontend sends all mapping data regardless of mode (a common pattern in form submissions). The response includes a skippedMappings array listing any mappings that were ignored due to mode incompatibility.
8.3.2.1 Response Changes for Batch Update
Field	Type	Description
updated	Number	Count of mappings successfully updated
skippedMappings	Array	List of mappings skipped due to mode incompatibility
skippedMappings[].section	String	The section key of the skipped mapping
skippedMappings[].reason	String	Human-readable reason, e.g., 'Column mapping not applicable for IMAGE mode'
8.4 Product Matching Rule Endpoints (New)
The configurable product matching rules feature requires two new API endpoints: one for updating a single product mapping's matching rule, and one for testing a matching rule against sample input. These endpoints support the Matching Rule Editor modal described in Section 5.5.3.
8.4.1 PUT /api/product-mappings/:id/matching-rule
This endpoint updates the matchingRule JSON field on a specific ProductMapping record. The request body must contain a valid matching rule configuration object or array, conforming to the schema defined in Section 5.3. The endpoint performs the following validation steps before persisting the change: (1) verify that the referenced ProductMapping exists and belongs to a template whose scanMode supports product matching (not POS); (2) validate the ruleType against the allowed values (EXACT, CONTAINS, STARTS_WITH, FUZZY, REGEX); (3) for FUZZY rules, validate that the threshold is between 0.0 and 1.0; (4) for REGEX rules, validate that the pattern compiles without errors; (5) for multi-rule arrays, validate that priorities are unique and sequential.
8.4.1.1 Request Body Schema
The request body must conform to the matchingRule JSON schema. A single-rule configuration is a JSON object with the following fields. Multi-rule configurations use a JSON array of such objects. The endpoint accepts both formats and normalizes internally to an array.
Field	Type	Required	Validation	Description
ruleType	String	Yes	One of: EXACT, CONTAINS, STARTS_WITH, FUZZY, REGEX	The matching algorithm to apply
threshold	Number	FUZZY only	0.0 to 1.0 inclusive	Similarity threshold for FUZZY matching (default: 0.80)
pattern	String	REGEX only	Valid JavaScript regex pattern	The regular expression pattern to match against
caseSensitive	Boolean	No	Default: false	Whether the match is case-sensitive
priority	Number	No	Unique per array; default: 0	Evaluation order (lower = evaluated first)
8.4.1.2 Error Responses
HTTP Status	errorCode	Condition
404	PRODUCT_MAPPING_NOT_FOUND	The specified product mapping ID does not exist
422	INVALID_RULE_TYPE	ruleType is not one of the five allowed values
422	INVALID_FUZZY_THRESHOLD	threshold is missing or outside [0.0, 1.0] for FUZZY rule
422	INVALID_REGEX_PATTERN	pattern fails to compile as a valid regex
422	DUPLICATE_PRIORITY	Two rules in the array share the same priority value
422	POS_MODE_UNSUPPORTED	Product matching rules cannot be set on POS-mode template mappings
8.4.2 POST /api/product-mappings/test-match
This endpoint enables the Test Match feature in the Matching Rule Editor (Section 5.5.4). It accepts a matching rule configuration and a test input string, evaluates the rule, and returns the match result without persisting any data. This allows users to experiment with rule configurations before committing them. The endpoint evaluates the rule exactly as the matching engine would during a live scan, ensuring that the test results are representative of actual matching behavior.
8.4.2.1 Request Body
Field	Type	Required	Description
rules	Array|Object	Yes	Single rule object or array of rule objects (same schema as matchingRule)
testInput	String	Yes	The product name string to test against (e.g., 'Coca-Cola 330ml')
productName	String	No	The mapped product's QuickBooks name (for context in the response)
8.4.2.2 Response
Field	Type	Description
matched	Boolean	Whether the testInput matched any of the provided rules
matchedRule	Object|null	The first rule that matched (null if no match)
matchedRule.ruleType	String	The rule type that triggered the match
matchedRule.priority	Number	The priority of the matching rule
matchDetail	String	Human-readable explanation, e.g., 'CONTAINS match: "Coca-Cola" found in input'
allResults	Array	Evaluation results for every rule in priority order
allResults[].ruleType	String	The rule type evaluated
allResults[].matched	Boolean	Whether this individual rule matched
allResults[].detail	String	Explanation of why this rule matched or did not match
similarity	Number|null	For FUZZY rules: the computed similarity score; null for other types
8.5 Scan Record Endpoints
8.5.1 POST /api/scans
The scan creation endpoint now records the scanMode enum value (replacing the former source string). When a scan is created, the endpoint performs a mode-template compatibility check: if the user selects a template whose scanMode differs from the scan's source mode, the response includes a modeWarning object. This warning is informational only; the scan is still created and processed. The frontend must display the warning to the user but should not block the scan from proceeding. The modeWarning object contains the scan's mode, the template's mode, a severity level ('high' for POS vs IMAGE/EXCEL, 'medium' for IMAGE vs EXCEL), and a suggested action (e.g., "Consider using an IMAGE-mode template for this PDF scan").
8.5.1.1 New Response Field: modeWarning
Field	Type	Condition	Description
modeWarning	Object|null	scanMode and template.scanMode differ	Contains mode mismatch details
modeWarning.scanMode	String	Always when present	The scan's source mode
modeWarning.templateMode	String	Always when present	The selected template's mode
modeWarning.severity	String	Always when present	'high' (POS vs non-POS) or 'medium' (IMAGE vs EXCEL)
modeWarning.message	String	Always when present	Human-readable warning message
modeWarning.suggestion	String	Always when present	Suggested action, e.g., template ID to use instead
8.5.2 GET /api/scans/:id
The scan detail endpoint now returns the scanMode enum value instead of the legacy source string. The response includes a new scanMode field of type String with values IMAGE, EXCEL, or POS. The legacy source field is deprecated but remains in the response for one release cycle (v2.x) with a deprecation notice in the field's description. Clients should migrate to reading scanMode instead. In the subsequent major version (v3.0), the source field will be removed entirely. The response also includes a modeWarnings array that captures any mode mismatch warnings generated during scan creation, allowing the scan detail view to display historical warnings even if the user dismissed them during the initial scan.
8.6 Mode Validation Middleware
To avoid duplicating mode validation logic across multiple endpoints, a shared middleware function validateScanMode should be implemented. This middleware is applied to all template and mapping endpoints and performs the following checks. First, if the request includes a scanMode parameter or body field, it validates that the value is one of the three allowed enum values (IMAGE, EXCEL, POS). Second, if both scanMode and transactionType are present, it validates the combination against the compatibility matrix. Third, if the request is modifying a template's scanMode, it queries the database for any existing mappings that would be affected and attaches a warnings object to the request context.
8.6.1 Middleware Function Signature
The middleware follows the standard Express.js middleware pattern. It attaches validation results to the request object (req.modeValidation) so that downstream handlers can access them without re-querying. The middleware does not send responses directly; it calls next() with an error object if validation fails, or next() without arguments if validation passes. The downstream handler is responsible for deciding whether to return validation failures as errors (422) or warnings (200 with warnings array).
function validateScanMode(req, res, next) {
  // 1. Validate scanMode enum value
  // 2. Check mode-type compatibility matrix
  // 3. Query affected mappings for mode changes
  // 4. Attach results to req.modeValidation
  // 5. Call next() or next(error)
}
8.6.2 Validation Rules Reference
The following table summarizes the validation rules enforced by the middleware. The severity column determines the response behavior: 'error' results in a 422 response, while 'warning' results in a 200 response with a warnings array. The mode-type compatibility checks are always errors because they represent invalid data combinations, while mode-change mapping impacts are warnings because the data is technically valid but may have undesirable side effects.
Validation Rule	Severity	Condition	Response Behavior
Invalid scanMode value	Error	scanMode not in {IMAGE, EXCEL, POS}	422 with INVALID_SCAN_MODE error code
Mode-type incompatibility	Error	e.g., BILL + POS	422 with MODE_TYPE_INCOMPATIBLE error code
Mode change affects mappings	Warning	Changing mode hides existing mappings	200 with warnings array listing affected mappings
POS template without posSystem	Warning	scanMode=POS and posSystem is null	200 with POS_SYSTEM_MISSING warning
8.7 API Versioning and Deprecation
The API changes described in this section follow a deprecation-first strategy. New fields (scanMode, posSystem, matchingRule, modeWarning) are added alongside existing fields, and no existing fields are removed in the current version. The legacy source field on ScanRecord is deprecated in v2.x and will be removed in v3.0. The deprecated field is still populated with the string equivalent of the scanMode enum value (lowercase) to maintain compatibility with older frontend versions during the transition period. All new endpoints follow the existing REST conventions and authentication requirements. The matching rule endpoints require the same location-based access control as the template endpoints, ensuring that a user can only modify matching rules for templates within their authorized locations.
The API versioning strategy uses URL path versioning (/api/v2/) for breaking changes and header-based feature negotiation for additive changes. The scanMode filter on GET /api/templates is an additive change that is available without a version bump; clients that do not pass the scanMode parameter receive the same response as before. The modeWarning field on scan responses is also additive; clients that do not handle this field are unaffected. The only breaking change is the removal of the source field in v3.0, which is communicated through the deprecation notice in the API documentation and the Deprecation HTTP header on responses that include the source field.
8.8 Endpoint Change Summary
The following table provides a consolidated reference of all API changes described in this section. The Impact column indicates whether the change is additive (new fields/parameters that do not break existing clients), modifying (changes to existing field behavior), or new (entirely new endpoints). This summary enables developers to quickly assess the scope of API changes and plan their frontend integration work accordingly.
Endpoint	Method	Change Type	Impact	Key Changes
/api/templates	GET	Modified	Additive	Added scanMode filter param, scanMode/posSystem in response, modeMismatch object
/api/templates	POST	Modified	Additive	Required scanMode field, optional posSystem, mode-type validation (422)
/api/templates/:id	PATCH	Modified	Additive	Mode change validation, warnings for affected mappings, confirmation flow
/api/templates/:id/mappings	GET	Modified	Additive	scanMode in response, sections array with isCompatible flags
/api/templates/:id/mappings	POST	Modified	Additive	Mode-aware validation, skippedMappings in response
/api/product-mappings/:id/matching-rule	PUT	New	New	CRUD for matching rule configuration with full validation
/api/product-mappings/test-match	POST	New	New	Test-match endpoint returning per-rule evaluation results
/api/scans	POST	Modified	Additive	modeWarning object in response for mode-template mismatches
/api/scans/:id	GET	Modified	Additive	scanMode enum field (replacing deprecated source), modeWarnings array
9. Frontend Implementation Guide
9.1 Overview of Frontend Changes
This section provides a component-level implementation guide for the frontend changes required by the mode-specific template isolation and configurable product matching rules features. The current MappingView component in the Nest Chrome Extension is a monolithic file spanning approximately 1,900 lines (MappingView/index.tsx). It renders all mapping sections regardless of scan mode, relying on conditional CSS and ad-hoc boolean checks to toggle section visibility. This approach is fragile, difficult to test, and confusing for users who see irrelevant sections (e.g., Column Mapping when scanning an image invoice). The redesign replaces this monolith with a composable, mode-aware section architecture where each mapping section is an independent component that declares its compatibility with scan modes.
The implementation guide is organized into five phases, ordered by dependency: first establish the shared mode context, then refactor the container component, then implement individual section components, then add the mode mismatch warning system, and finally build the product matching rule editor. Each phase includes a list of files to modify or create, the component interfaces to implement, and the acceptance criteria to verify. The phases can be developed and tested incrementally; each phase produces a working build that can be merged to the main branch without breaking existing functionality.
9.2 Phase 1: Scan Mode Context Provider
The first phase establishes a React context that propagates the active scan mode throughout the component tree. Every mode-aware component reads from this context rather than receiving the scanMode as an individual prop, which eliminates prop drilling and ensures consistency. The context also provides helper functions for mode comparison, compatibility checking, and warning generation. This phase has no visible UI changes; it creates the foundation that subsequent phases depend on.
9.2.1 ScanModeContext Interface
The ScanModeContext provides the following value to all consumer components. The activeMode field reflects the scan mode of the currently selected template (or the scan source, if no template is selected). The templateMode field reflects the template's declared scanMode, which may differ from the scan source mode when a mode mismatch occurs. The isCompatible function checks whether a section should be visible for the current mode, using the visibility rules defined in Section 3.5. The setMode function allows the template creation wizard to update the active mode when the user selects a scan mode during template setup.
interface ScanModeContextValue {
  activeMode: 'IMAGE' | 'EXCEL' | 'POS';
  templateMode: 'IMAGE' | 'EXCEL' | 'POS';
  isCompatible(sectionKey: string): boolean;
  getVisibility(sectionKey: string): 'visible' | 'hidden' | 'conditional';
  setMode(mode: ScanMode): void;
  modeMismatch: { scanMode: string; templateMode: string; severity: string } | null;
}
9.2.2 Files to Create or Modify
File Path	Action	Description
src/contexts/ScanModeContext.tsx	Create	React context provider with ScanModeContextValue interface
src/types/scanMode.ts	Create	ScanMode enum type definition and visibility rules map
src/hooks/useScanMode.ts	Create	Custom hook wrapping useContext(ScanModeContext) with error boundary
src/App.tsx or equivalent root	Modify	Wrap MappingView with ScanModeContext.Provider
9.2.3 Acceptance Criteria
•	ScanModeContext.Provider wraps the entire mapping view and initializes with template.scanMode
•	useScanMode() hook returns the correct context value in any child component
•	isCompatible() returns true for IMAGE + FieldMapping, false for IMAGE + ColumnMapping
•	getVisibility() returns 'conditional' for EXCEL + ProductMatching when no productName column is mapped
•	modeMismatch is null when activeMode equals templateMode, non-null otherwise
9.3 Phase 2: MappingView Container Refactoring
The second phase replaces the monolithic MappingView/index.tsx with a slim container component that renders only the mode-compatible section components. The container is responsible for three things: fetching the template and mapping data from the API (using the updated GET /api/templates/:id/mappings endpoint that returns the sections array with isCompatible flags), rendering the section components in the correct order for the active scan mode (using the section composition tables from Section 4), and providing a shared callback interface for section components to communicate mapping changes back to the container.
9.3.1 New MappingView Structure
The refactored MappingView component follows a container/presentational pattern. The container manages state (template data, mapping data, active section, unsaved changes) and the presentational layer renders the section components. The key change is that the container no longer contains any section-specific rendering logic; instead, it maps over the sections array from the API response and renders the corresponding component for each section where isCompatible is true. The section order is determined by the API response, which returns sections in the mode-specific order defined in Section 4.
// Pseudocode for refactored MappingView
function MappingView({ templateId }) {
  const { data } = useQuery(`/api/templates/${templateId}/mappings`);
  const { activeMode, isCompatible } = useScanMode();

  const sectionComponents = {
    fieldMapping: FieldMappingSection,
    columnMapping: ColumnMappingSection,
    productMatching: ProductMatchingSection,
    templateDefaults: TemplateDefaultsSection,
  };

  return (
    <div className="mapping-view">
      <ModeMismatchBanner />
      {data.sections
        .filter(s => isCompatible(s.key))
        .map(s => {
          const Component = sectionComponents[s.key];
          return Component ?
            <Component key={s.key} data={s.mappings} /> : null;
        })
      }
    </div>
  );
}
9.3.2 Files to Create or Modify
File Path	Action	Description
src/views/MappingView/index.tsx	Rewrite	Replace 1,900-line monolith with slim container (~150 lines)
src/views/MappingView/useMappingData.ts	Create	Custom hook for fetching and caching mapping data from API
src/views/MappingView/MappingView.types.ts	Create	TypeScript interfaces for section data, mapping responses
src/views/MappingView/sectionRegistry.ts	Create	Registry mapping section keys to component references
9.3.3 Acceptance Criteria
•	MappingView renders only sections where isCompatible is true for the active scan mode
•	IMAGE mode shows FieldMapping + ProductMatching + TemplateDefaults (3 sections)
•	EXCEL mode shows ColumnMapping + ProductMatching (conditional) + TemplateDefaults (3 sections)
•	POS mode shows FieldMapping + TemplateDefaults (2 sections, no ProductMatching)
•	No regression in existing mapping save/load functionality
9.4 Phase 3: Mode-Aware Section Components
The third phase implements the four composable section components that replace the inline rendering logic in the current MappingView. Each section component declares its compatibility via a static isCompatible method and renders its specific UI. The components are self-contained: they manage their own local state (e.g., expanded/collapsed, selected mapping, validation errors) and communicate mapping changes to the parent container via callback props.
9.4.1 FieldMappingSection
The FieldMappingSection component renders the field-to-QuickBooks mapping interface. In IMAGE mode, it displays the full set of header fields (vendor, invoice number, date, total, tax) and line item fields (description, quantity, unit price, amount). In POS mode, it displays a simplified set of flat key-value fields (total sales, total tips, net sales, category breakdowns). The component receives the field mapping data from the API response's sections array and renders the appropriate sub-layout based on the active scan mode from ScanModeContext. The component also displays the POS system indicator when the template's posSystem field is set, showing a badge like "Toast" or "Oracle Simphony" near the section header.
Prop	Type	Description
data	FieldMappingData	Mapping data from API section response
onMappingChange	(field, value) => void	Callback when a field mapping is updated
onSave	() => void	Callback to persist mapping changes
9.4.2 ColumnMappingSection
The ColumnMappingSection component is exclusive to EXCEL mode. It renders the column-to-field mapping interface where users assign Excel column letters (A, B, C, ...) to QuickBooks field names. The component includes a column preview feature that displays the first few rows of the uploaded Excel file, allowing users to verify their column assignments against actual data. The component also manages the conditional visibility of the ProductMatchingSection: when the user maps a column to the 'productName' field, the component emits an event that activates the product matching section. If the user removes the productName column mapping, the product matching section is deactivated but its configuration is preserved (not deleted) so that re-mapping the productName column restores the previous product matching rules.
Prop	Type	Description
data	ColumnMappingData	Column mapping data from API section response
onColumnMap	(column, field) => void	Callback when a column is assigned to a field
onProductNameMapped	(columnName: string) => void	Callback when productName column is mapped (activates product matching)
onProductNameRemoved	() => void	Callback when productName column mapping is removed (deactivates product matching)
9.4.3 ProductMatchingSection
The ProductMatchingSection component renders the product-to-account mapping interface with matching rule configuration. In IMAGE mode, it displays the full product matching interface with rule badges and the Matching Rule Editor (see Phase 5). In EXCEL mode, the section is conditionally visible based on whether a productName column has been mapped (see ColumnMappingSection). In POS mode, the section is entirely hidden and replaced by a static message explaining that product matching is handled by POS category defaults. The component displays each product mapping as a card showing the product name, the assigned account, and a rule badge indicating the matching rule type (e.g., "FUZZY 0.80", "EXACT", "REGEX").
Prop	Type	Description
data	ProductMatchingData	Product mapping data with matching rules from API section response
onRuleUpdate	(mappingId, rule) => void	Callback when a matching rule is configured or updated
onTestMatch	(rule, testInput) => Promise<TestResult>	Callback to invoke the test-match API endpoint
isActive	Boolean	Whether the section is active (relevant for EXCEL conditional visibility)
9.4.4 TemplateDefaultsSection
The TemplateDefaultsSection component renders the default values configuration for the template. The available defaults vary by scan mode and transaction type. In IMAGE mode, it shows default date format, currency, and tax handling. In EXCEL mode, it adds default row start and header row configuration. In POS mode, it shows the POS system selection, date range defaults, and category-to-account mapping. For Bill/VC/Cheque templates, it additionally shows the default vendor, AP account, and bank account fields (which are not applicable to JE templates). The component reads the scan mode from ScanModeContext to determine which default fields to display.
Prop	Type	Description
data	TemplateDefaultsData	Default values from API section response
onDefaultChange	(field, value) => void	Callback when a default value is updated
transactionType	String	JE, BILL, VC, or CHEQUE — determines additional default fields
9.4.5 Section Component Files
File Path	Component	Mode Compatibility
src/views/MappingView/sections/FieldMappingSection.tsx	FieldMappingSection	IMAGE, POS
src/views/MappingView/sections/ColumnMappingSection.tsx	ColumnMappingSection	EXCEL only
src/views/MappingView/sections/ProductMatchingSection.tsx	ProductMatchingSection	IMAGE (always), EXCEL (conditional)
src/views/MappingView/sections/TemplateDefaultsSection.tsx	TemplateDefaultsSection	IMAGE, EXCEL, POS
9.5 Phase 4: Mode Mismatch Warning System
The fourth phase implements the mode mismatch detection and warning display system. When a user scans a document in one mode but selects a template configured for a different mode, the system displays a warning banner at the top of the mapping view. The warning is informational (not blocking); the user can dismiss it and proceed with the mismatched template. However, the system also provides a smart suggestion: a link to the best-matching template for the current scan mode, if one exists.
9.5.1 ModeMismatchBanner Component
The ModeMismatchBanner component renders an amber-colored warning banner at the top of the mapping view when modeMismatch is not null in the ScanModeContext. The banner displays three elements: a warning icon and message (e.g., "This template is configured for IMAGE mode, but you scanned an Excel file"), a severity indicator (high = red icon for POS vs non-POS, medium = amber icon for IMAGE vs EXCEL), and a suggestion link (e.g., "Switch to 'Daily Sales - Excel' template") that, when clicked, updates the selected template to the suggested one. The banner includes a dismiss button that hides it for the current session (stored in component state, not persisted). The banner reappears if the user changes templates and the new selection also has a mode mismatch.
9.5.2 ModeMismatchBanner Props
Prop	Type	Description
mismatch	ModeMismatch | null	The mismatch object from ScanModeContext; null hides the banner
suggestedTemplateId	String | null	ID of the best-matching template for the current scan mode
suggestedTemplateName	String | null	Display name of the suggested template for the link text
onSwitchTemplate	(id: string) => void	Callback when user clicks the suggestion link
onDismiss	() => void	Callback when user dismisses the banner
9.5.3 Smart Template Suggestion Logic
The smart template suggestion is implemented as a custom hook (useSuggestedTemplate) that queries the GET /api/templates endpoint with the scan's source mode as the scanMode filter parameter and the same locationId and transactionType as the current template. The hook returns the first template from the results (sorted by lastUsedAt descending) as the suggested template. If no matching template exists, the hook returns null and the suggestion link is not displayed. The hook is invoked only when a mode mismatch is detected, avoiding unnecessary API calls when the modes match.
9.5.4 Files to Create or Modify
File Path	Action	Description
src/components/ModeMismatchBanner.tsx	Create	Amber warning banner component with severity, suggestion, dismiss
src/hooks/useSuggestedTemplate.ts	Create	Custom hook for smart template suggestion query
src/views/MappingView/index.tsx	Modify	Add ModeMismatchBanner above section list
9.6 Phase 5: Product Matching Rule Editor
The fifth and final phase implements the Matching Rule Editor modal and the Test Match feature, which allow users to configure the matching rule for each product mapping and test it against sample input. This phase depends on the ProductMatchingSection component from Phase 3 and the API endpoints from Section 8.4. The rule editor is launched by clicking the rule badge on a product mapping card in the ProductMatchingSection.
9.6.1 MatchingRuleEditorModal Component
The MatchingRuleEditorModal is a modal dialog that allows the user to configure one or more matching rules for a product mapping. The modal has two panels: the rule configuration panel (left) and the test match panel (right). The rule configuration panel displays the current rule(s) as a priority-ordered list. Each rule has a dropdown for ruleType (EXACT, CONTAINS, STARTS_WITH, FUZZY, REGEX), a threshold slider for FUZZY rules (range 0.0 to 1.0, step 0.05), a pattern input for REGEX rules, a case-sensitive toggle, and a priority number. The user can add, remove, and reorder rules. The test match panel has a text input for the test string and a "Test" button that calls the POST /api/product-mappings/test-match endpoint. The results display the matched status, the matching rule (if any), and the similarity score (for FUZZY rules).
9.6.2 MatchingRuleEditorModal Props
Prop	Type	Description
isOpen	Boolean	Whether the modal is visible
mappingId	String	The product mapping ID being edited
productName	String	The QuickBooks product name for display in the modal header
currentRules	MatchingRule | MatchingRule[] | null	Existing rule configuration (null = use defaults)
onSave	(rules: MatchingRule[]) => void	Callback to persist the updated rule configuration
onClose	() => void	Callback when the modal is closed without saving
9.6.3 TestMatchPanel Component
The TestMatchPanel is the right panel of the MatchingRuleEditorModal. It provides an input field for the test string and a results display area. When the user clicks "Test", the panel calls the onTestMatch callback, which invokes the API. The results area shows each rule in priority order with a green checkmark (matched) or red cross (not matched), along with the match detail text. For FUZZY rules, the similarity score is displayed as a percentage (e.g., "87% similarity"). If no rules match, the panel displays a message suggesting that the user lower the FUZZY threshold or try a CONTAINS rule. The panel also shows a history of recent test inputs (stored in component state) so the user can re-test against multiple product names without retyping.
9.6.4 Product Mapping Card and Rule Badge
Each product mapping in the ProductMatchingSection is displayed as a card with three elements: the product name (from the scanned data), the assigned QuickBooks account (with a dropdown to change it), and a rule badge. The rule badge is a small colored pill that displays the matching rule type and key parameter. For example, a FUZZY rule with threshold 0.80 displays as "FUZZY 0.80" in a blue pill; an EXACT rule displays as "EXACT" in a green pill; a REGEX rule displays as "REGEX" in a purple pill. If no custom rule is configured (matchingRule is null), the badge displays "DEFAULT" in a gray pill, indicating that the system default matching behavior (exact then fuzzy) will be used. Clicking the rule badge opens the MatchingRuleEditorModal for that product mapping.
9.6.5 Files to Create or Modify
File Path	Action	Description
src/components/MatchingRuleEditorModal.tsx	Create	Modal with rule config panel and test match panel
src/components/TestMatchPanel.tsx	Create	Right panel of modal with test input and results display
src/components/ProductMappingCard.tsx	Create	Card component with product name, account dropdown, and rule badge
src/components/RuleBadge.tsx	Create	Colored pill component displaying rule type and key parameter
src/views/MappingView/sections/ProductMatchingSection.tsx	Modify	Integrate ProductMappingCard and rule badge click handler
9.7 Implementation Order and Dependency Graph
The five phases must be implemented in order due to their dependencies. Phase 1 (Scan Mode Context) has no dependencies and can be developed first. Phase 2 (MappingView Refactoring) depends on Phase 1 because the container reads from ScanModeContext. Phase 3 (Section Components) depends on Phase 2 because the section components are rendered by the refactored container. Phase 4 (Mode Mismatch Warning) depends on Phase 1 for context and Phase 2 for the container insertion point. Phase 5 (Product Matching Rule Editor) depends on Phase 3 for the ProductMatchingSection and on the backend API endpoints from Section 8.4.
Phase	Component	Depends On	Estimated Effort	Can Deploy Independently?
1	ScanModeContext	None	2-3 days	Yes (no visible changes)
2	MappingView Refactoring	Phase 1	3-5 days	Yes (existing sections still work)
3	Section Components	Phase 2	5-7 days	Partial (each section can be deployed individually)
4	Mode Mismatch Warning	Phase 1, 2	2-3 days	Yes (additive feature)
5	Product Matching Rule Editor	Phase 3, Backend 8.4	4-6 days	Yes (additive feature)
9.7.1 Testing Strategy
Each phase should include unit tests for the new components and integration tests for the mode-aware filtering logic. The ScanModeContext tests should verify that isCompatible returns correct values for all mode-section combinations defined in Section 3.5. The MappingView tests should verify that the correct section components are rendered for each scan mode. The section component tests should verify that each component renders its UI correctly and fires the expected callbacks. The mode mismatch tests should verify that the banner appears when modes differ and the suggestion link navigates to the correct template. The rule editor tests should verify that rule configuration is saved correctly and test match results are displayed accurately.
End-to-end tests should cover the three primary user flows: (1) creating an IMAGE-mode template and verifying that FieldMapping, ProductMatching, and TemplateDefaults sections are visible but ColumnMapping is not; (2) creating an EXCEL-mode template and verifying that ColumnMapping is visible and ProductMatching appears only after mapping a productName column; (3) scanning a POS source and selecting an IMAGE-mode template, verifying that the mode mismatch warning appears with the correct severity and suggestion. These E2E tests should be automated using a browser testing framework compatible with the Chrome Extension environment (e.g., Playwright with the extension loaded).
10. Migration & Rollout Plan
10.1 Overview of Migration Strategy
The migration from the current mode-agnostic template system to the mode-specific template isolation architecture must be executed without data loss, without extended downtime, and without breaking the existing user experience. This section defines a phased rollout plan that introduces each feature incrementally, allowing the team to validate each stage before proceeding. The plan is designed around three core principles: zero-downtime deployment (all schema changes are additive and backward-compatible), gradual feature exposure (new features are hidden behind feature flags until explicitly enabled), and rollback safety (each phase can be independently rolled back without affecting previously deployed phases). The total rollout spans four release cycles (approximately 8-10 weeks), with each release adding one or more capabilities while maintaining full backward compatibility with the previous release.
10.2 Release 1: Schema Foundation (Week 1-2)
The first release applies the Prisma schema changes described in Section 7.7 Phase 1 (Add Fields). This release adds the ScanMode enum, the scanMode and posSystem fields to Template, the matchingRule field to ProductMapping, and the scanMode field to ScanRecord. All new fields have default values or are nullable, so the migration is purely additive. No existing API behavior changes in this release; the new fields are present in the database but are not yet read or written by any API endpoint. This release also runs the data migration script described in Section 7.7 Phase 2 (Data Migration), which infers the correct scanMode for existing templates and converts ScanRecord.source values to the ScanMode enum.
10.2.1 Deployment Checklist
Step	Action	Verification	Rollback
1	Run prisma migrate deploy to add ScanMode enum and new fields	Verify all new columns exist in database; confirm Template.scanMode defaults to 'IMAGE'	Run prisma migrate resolve --rolled-back <migration-name>
2	Run data migration script: infer scanMode for existing templates	Query Template table: count templates per scanMode; verify EXCEL templates have columnMappings	UPDATE Template SET scanMode='IMAGE' WHERE scanMode IS NOT NULL; re-run script
3	Run data migration script: convert ScanRecord.source to scanMode	Query ScanRecord table: verify no records with source='pdf' remain; all have scanMode='IMAGE'	UPDATE ScanRecord SET scanMode='IMAGE'; script is idempotent so re-run is safe
4	Deploy API with new fields in response (opt-in via query param)	GET /api/templates returns scanMode field; legacy clients unaffected	Remove scanMode from API response; no data loss since field is additive
10.2.2 Feature Flags
The following feature flags control the visibility of Release 1 changes. All flags default to false (disabled), ensuring that existing API consumers are not affected until the flags are explicitly enabled. The flags are stored in the application configuration (environment variables or a feature flag service) and are read at runtime, allowing changes without redeployment.
Flag Name	Default	Description	When to Enable
ENABLE_SCANMODE_FIELD	false	Include scanMode and posSystem in API responses	After data migration script completes successfully
ENABLE_SCANMODE_FILTER	false	Allow scanMode query parameter on GET /api/templates	Simultaneously with ENABLE_SCANMODE_FIELD
ENABLE_MATCHING_RULE_FIELD	false	Include matchingRule in ProductMapping API responses	After schema migration completes successfully
10.3 Release 2: API and Validation Layer (Week 3-4)
The second release activates the mode-aware API endpoints and validation logic described in Section 8. This includes the scanMode filter on GET /api/templates, the required scanMode field on POST /api/templates, the mode-type compatibility validation (422 for incompatible combinations like BILL + POS), the mode change warning system on PATCH /api/templates/:id, and the sections array response on GET /api/templates/:id/mappings. The validateScanMode middleware (Section 8.6) is deployed but initially configured to log warnings rather than reject requests, allowing the team to observe real-world validation failures without breaking existing client behavior.
10.3.1 Deployment Checklist
Step	Action	Verification	Rollback
1	Deploy validateScanMode middleware in log-only mode	Check server logs for MODE_TYPE_INCOMPATIBLE warnings; count frequency	Remove middleware from route chain
2	Enable ENABLE_SCANMODE_FIELD and ENABLE_SCANMODE_FILTER flags	GET /api/templates?scanMode=IMAGE returns only IMAGE templates; POST /api/templates requires scanMode	Disable flags; API reverts to pre-release behavior
3	Deploy sections array response on mapping endpoint	GET /api/templates/:id/mappings returns sections array with isCompatible flags	API returns flat mappings array if flag disabled
4	Deploy mode-type validation (422) on POST /api/templates	Creating BILL + POS template returns 422 with MODE_TYPE_INCOMPATIBLE error	Disable validation; allow all combinations temporarily
5	Monitor validation error rates for 48 hours	Error rate < 5% of total template creation requests = proceed; > 5% = investigate	N/A
10.3.2 Feature Flags
Flag Name	Default	Description	When to Enable
ENABLE_MODE_VALIDATION	false	Enforce mode-type compatibility matrix (422 errors)	After 48h log-only monitoring shows low error rates
ENABLE_SECTIONS_RESPONSE	false	Return sections array instead of flat mappings on mapping endpoint	After frontend Phase 2 (MappingView refactoring) is deployed
ENABLE_MODE_CHANGE_WARNINGS	false	Return warnings when PATCH changes scanMode and affects mappings	Simultaneously with ENABLE_MODE_VALIDATION
10.4 Release 3: Frontend Rollout (Week 5-7)
The third release deploys the frontend changes described in Section 9. The rollout follows the same five-phase implementation order: ScanModeContext (Phase 1), MappingView refactoring (Phase 2), section components (Phase 3), mode mismatch warning (Phase 4), and product matching rule editor (Phase 5). Each frontend phase is deployed behind its own feature flag, allowing incremental rollout to a subset of users (e.g., internal testers first, then beta users, then all users). The Chrome Extension's auto-update mechanism ensures that users receive the new version within 24 hours of publication, but feature flags provide more granular control over which features are active.
10.4.1 Frontend Feature Flags
Frontend feature flags are stored in the extension's local configuration and synced from the backend on startup. This allows the backend to control which features are active for each user, enabling percentage-based rollouts (e.g., enable the new MappingView for 10% of users initially, then increase to 50%, then 100%). The following flags correspond to the five implementation phases.
Flag Name	Phase	Default	What It Controls
FE_SCANMODE_CONTEXT	1	false	Activates ScanModeContext provider and useScanMode hook
FE_MODE_AWARE_MAPPING	2	false	Switches MappingView from monolith to composable container
FE_SECTION_COMPONENTS	3	false	Renders mode-aware section components instead of inline sections
FE_MODE_MISMATCH_BANNER	4	false	Shows mode mismatch warning banner when modes differ
FE_MATCHING_RULE_EDITOR	5	false	Enables Matching Rule Editor modal and Test Match feature
10.4.2 Canary Rollout Strategy
The frontend rollout uses a canary strategy with three tiers. Tier 1 (Internal) deploys to Nest team members only, representing approximately 5% of the user base. Tier 2 (Beta) deploys to opt-in beta testers, representing approximately 15% of the user base. Tier 3 (General Availability) deploys to all users. Each tier runs for at least 3 days before advancing to the next tier, and the advancement requires explicit approval from the product owner based on the following metrics: zero critical bugs, fewer than 3 medium bugs, user satisfaction score >= 4.0/5.0 (collected via in-extension feedback prompt), and no increase in mapping save failure rate.
Tier	User Segment	Duration	Success Criteria	Rollback Trigger
1 - Internal	Nest team members (~5%)	3 days	0 critical bugs, < 3 medium bugs	Any critical bug or data loss
2 - Beta	Opt-in beta testers (~15%)	5 days	Satisfaction >= 4.0, save failure rate unchanged	Satisfaction < 3.5 or save failure rate +2%
3 - GA	All users (100%)	Ongoing	No regression in core metrics	Save failure rate +5% or > 10 support tickets/week
10.5 Release 4: Matching Rules and Constraint Enforcement (Week 8-10)
The fourth and final release deploys the product matching rule endpoints (Section 8.4) and enforces the database constraints described in Section 7.7 Phase 3 (Enforce Constraints). The matching rule endpoints are new API routes that have no impact on existing functionality; they are only called by the frontend Matching Rule Editor when the FE_MATCHING_RULE_EDITOR flag is enabled. The constraint enforcement migration makes the Template.scanMode field strictly non-nullable (it already has a default, so this is a safety net) and adds the composite index on (locationId, scanMode, transactionType) to optimize template lookup queries. This index is critical for the smart template suggestion feature, which queries templates by location and scan mode.
10.5.1 Matching Rule API Deployment
The matching rule endpoints are deployed as new Express.js routes with no modifications to existing routes. The PUT /api/product-mappings/:id/matching-rule endpoint and the POST /api/product-mappings/test-match endpoint are registered in the router alongside the existing product mapping routes. Both endpoints require authentication and location-based access control, consistent with the existing template endpoints. The endpoints are deployed with the ENABLE_MATCHING_RULE_API feature flag set to false initially, and are enabled only after the FE_MATCHING_RULE_EDITOR frontend flag is enabled for Tier 1 (Internal) users.
10.5.2 Constraint Enforcement Migration
After the data migration from Release 1 has been running for at least 2 weeks with no issues, the constraint enforcement migration is applied. This migration adds the composite index and makes the scanMode field explicitly non-nullable (although the default value already prevents nulls, this migration adds a NOT NULL constraint at the database level for extra safety). The migration is non-blocking; the composite index is created concurrently (PostgreSQL CREATE INDEX CONCURRENTLY) to avoid locking the Template table during index creation.
Migration Step	SQL	Downtime	Verification
Add composite index	CREATE INDEX CONCURRENTLY idx_template_mode ON Template(locationId, scanMode, transactionType)	None (concurrent)	EXPLAIN ANALYZE shows index usage on mode-filtered queries
Add NOT NULL constraint	ALTER TABLE Template ALTER COLUMN scanMode SET NOT NULL	None (all rows already have values)	INSERT with null scanMode fails with constraint violation
10.6 Rollback Procedures
Each release has a defined rollback procedure that restores the system to the previous state without data loss. Because all schema changes are additive (no columns removed, no columns renamed in a breaking way), rollback does not require database schema reversal; it only requires disabling the feature flags that activate the new behavior. The following table provides the rollback procedure for each release, along with the estimated time to execute and the data integrity verification steps.
Release	Rollback Action	Estimated Time	Data Verification
1 - Schema	Disable ENABLE_SCANMODE_FIELD, ENABLE_MATCHING_RULE_FIELD flags	5 minutes	API responses no longer include scanMode/matchingRule fields
2 - API	Disable ENABLE_MODE_VALIDATION, ENABLE_SECTIONS_RESPONSE, ENABLE_MODE_CHANGE_WARNINGS	10 minutes	API accepts all mode-type combinations; mapping response is flat array
3 - Frontend	Disable all FE_* flags; extension reverts to monolithic MappingView on next load	15 minutes (auto-update)	MappingView renders all sections regardless of mode
4 - Rules + Constraints	Disable ENABLE_MATCHING_RULE_API; DROP INDEX idx_template_mode (optional)	10 minutes	Rule editor modal hidden; template queries use sequential scan (slower but correct)
10.6.1 Data Integrity Verification Script
After any rollback, run the following verification script to confirm data integrity. The script checks that all Template records have a valid scanMode value, that no ProductMapping records have a corrupted matchingRule JSON (valid JSON syntax but invalid schema), and that no ScanRecord records have a null scanMode field. The script outputs a summary report and exits with code 0 if all checks pass or code 1 if any check fails. The script should be run both immediately after rollback and 24 hours later to catch any delayed effects.
Check	SQL Query	Expected Result	Failure Action
Template scanMode valid	SELECT COUNT(*) FROM Template WHERE scanMode NOT IN ('IMAGE','EXCEL','POS')	0 rows	UPDATE SET scanMode='IMAGE' for invalid rows
ProductMapping matchingRule valid JSON	SELECT COUNT(*) FROM ProductMapping WHERE matchingRule IS NOT NULL AND json_typeof(matchingRule) IS NULL	0 rows	SET matchingRule=null for invalid rows
ScanRecord scanMode not null	SELECT COUNT(*) FROM ScanRecord WHERE scanMode IS NULL	0 rows	UPDATE SET scanMode='IMAGE' for null rows
10.7 Post-Rollout Monitoring
After the complete rollout (all four releases deployed, all feature flags enabled for 100% of users), the system enters a 30-day monitoring period. During this period, the following metrics are tracked daily and compared against baseline values from the pre-migration period. Any metric that deviates by more than two standard deviations from the baseline triggers an investigation. The monitoring dashboard is built using the existing observability stack (application metrics exported to Prometheus, visualized in Grafana) and includes alerts for critical thresholds.
Metric	Baseline (Pre-Migration)	Alert Threshold	Action on Alert
Template creation success rate	>= 98%	< 95%	Check mode validation error rates; consider relaxing validation
Mapping save success rate	>= 99%	< 97%	Check skippedMappings counts; investigate mode-aware filtering bugs
Mode mismatch warning frequency	N/A (new metric)	> 30% of scans	Review template naming conventions; add more mode-specific templates
Product matching accuracy	~85% (current fuzzy)	< 80%	Review matching rule configurations; adjust default thresholds
API response time p99	< 500ms	> 800ms	Check composite index usage; run EXPLAIN ANALYZE on slow queries
Chrome Extension crash rate	< 0.1%	> 0.5%	Check React error boundaries; review ScanModeContext edge cases
10.7.1 Success Criteria for Full Rollout
The migration is considered fully successful when all of the following criteria are met after the 30-day monitoring period. First, all four releases are deployed and all feature flags are enabled for 100% of users with no critical or high-severity bugs remaining open. Second, the mode mismatch warning frequency is below 20% of total scans, indicating that users are selecting mode-appropriate templates. Third, the product matching accuracy is at or above the pre-migration baseline (approximately 85%), confirming that the configurable matching rules are not degrading matching quality. Fourth, the API response time p99 remains below 500ms, confirming that the composite index and mode-aware filtering are performing well. Fifth, user feedback collected through the in-extension prompt shows a satisfaction score of 4.0 or higher out of 5.0 for the new mapping experience.
Once these criteria are met, the feature flags can be removed from the codebase in a cleanup release. The flag removal is a code-only change (no database migration) and simply replaces conditional feature flag checks with the enabled code path, removing the disabled code path. This cleanup reduces technical debt and simplifies the codebase, but it should only be performed after the monitoring period confirms that no rollback will be needed. After flag removal, the deprecated source field on ScanRecord can be scheduled for removal in the next major version (v3.0) as described in Section 8.7.
10.8 Rollout Timeline Summary
The following table summarizes the complete rollout timeline across all four releases. The timeline assumes a single development team working sequentially, but Releases 1 and 2 can be developed in parallel with the frontend phases of Release 3 if separate backend and frontend teams are available. The total duration of 8-10 weeks includes buffer time for bug fixes and monitoring between releases.
Week	Release	Key Milestones	Feature Flags Enabled
1	1 - Schema	Prisma migration deployed, data migration script executed	ENABLE_SCANMODE_FIELD, ENABLE_SCANMODE_FILTER, ENABLE_MATCHING_RULE_FIELD
2	1 - Schema	Monitor data migration results; fix any misclassified templates	All Release 1 flags confirmed stable
3	2 - API	validateScanMode middleware in log-only mode; API fields visible	ENABLE_MODE_VALIDATION (log-only), ENABLE_SECTIONS_RESPONSE
4	2 - API	Enable mode validation (422); monitor error rates for 48h	ENABLE_MODE_VALIDATION (enforced), ENABLE_MODE_CHANGE_WARNINGS
5	3 - Frontend	Deploy ScanModeContext + MappingView refactoring (Phases 1-2)	FE_SCANMODE_CONTEXT, FE_MODE_AWARE_MAPPING
6	3 - Frontend	Deploy section components (Phase 3); Tier 1 canary	FE_SECTION_COMPONENTS (Tier 1)
7	3 - Frontend	Deploy mode mismatch banner + rule editor (Phases 4-5); Tier 2-3	FE_MODE_MISMATCH_BANNER, FE_MATCHING_RULE_EDITOR
8	4 - Rules + Constraints	Deploy matching rule API endpoints; constraint enforcement migration	ENABLE_MATCHING_RULE_API
9-10	Monitoring	30-day monitoring period begins; track all metrics vs baseline	All flags enabled for 100% of users
11. Entry Approval Workflow & Role-Based Sync Control
11.1 Overview of Approval Workflow
In the current Nest system, when a user completes a scan and maps the extracted data, the resulting journal entry or transaction is synced directly to QuickBooks without any intermediate review step. This direct-sync approach creates significant risk in multi-user environments: a staff member may accidentally sync an incorrectly mapped entry, or an inexperienced user may post transactions that violate the organization's accounting policies. There is no mechanism for an administrator or accountant to review entries before they are committed to QuickBooks, and once synced, correcting an error requires creating a reversing entry in QuickBooks — a process that is error-prone and time-consuming.
The Entry Approval Workflow introduces a multi-state lifecycle for scanned entries. Instead of syncing immediately, each entry is created in an OPEN (draft) state where it can be reviewed, edited, and corrected. When the entry is ready, it is submitted for approval and enters a PENDING_APPROVAL state. An administrator or accountant then reviews the entry and either approves it (making it eligible for QuickBooks sync) or rejects it (sending it back for correction with a reason). Approved entries are locked and cannot be edited; they must be reverted to OPEN status before any modifications can be made, which then requires re-approval. Rejected entries are captured in a dedicated Rejected view so that administrators can track correction patterns and identify systematic mapping issues.
This workflow is governed by role-based permissions. Administrators can configure per-user restrictions: a restricted user can only create draft entries and cannot sync directly to QuickBooks, while an unrestricted user retains the ability to sync approved entries. Three roles are defined: Admin (full control including user permission management and approval authority), Accountant (approval authority without user management), and Staff Viewer (read-only access with no approval or sync capabilities). The approval workflow integrates seamlessly with the existing scan-mode template system described in Sections 1-10, applying the same mode-specific validation and field visibility rules to entries in every state.
11.2 Entry State Machine
Every scanned entry follows a defined state machine with four states and six valid transitions. The state machine ensures that entries progress through the review pipeline in a controlled manner and that no entry bypasses the approval step when the user is restricted from direct sync. The state of an entry is stored in the entryStatus field on the ScanRecord (or the linked journal entry record), and every state transition is logged with the transitioning user's ID, a timestamp, and an optional comment.
11.2.1 Entry States
State	Enum Value	Description	Editable?	Can Sync to QB?
Open (Draft)	OPEN	Initial state after scan; entry is a draft that can be freely edited	Yes	No
Pending Approval	PENDING_APPROVAL	Entry has been submitted for review; locked for editing until decision	No	No
Approved	APPROVED	Entry has been approved by Admin/Accountant; locked for editing; eligible for QB sync	No	Yes (if user has sync permission)
Rejected	REJECTED	Entry has been rejected by reviewer; visible in Rejected view; can be reopened for correction	No (must reopen first)	No
11.2.2 State Transitions
The following table defines all valid state transitions, the action that triggers them, and the roles authorized to perform each transition. Invalid transitions (e.g., moving directly from REJECTED to APPROVED without reopening) are blocked by both the API and the frontend. Each transition creates an audit log entry recording the from-state, to-state, user ID, timestamp, and any associated comment or rejection reason.
From State	To State	Action	Authorized Roles	Conditions
OPEN	PENDING_APPROVAL	Submit for Approval	Admin, Accountant, Staff (if restricted)	Entry must have all required fields populated
OPEN	APPROVED	Direct Approve (auto-approve)	Admin, Accountant	Only when user is unrestricted and auto-approve is enabled
PENDING_APPROVAL	APPROVED	Approve	Admin, Accountant	Entry passes all validation rules
PENDING_APPROVAL	REJECTED	Reject	Admin, Accountant	Rejection reason is required
APPROVED	OPEN	Revert to Open	Admin, Accountant	Entry has NOT been synced to QB yet; if already synced, must create reversal
REJECTED	OPEN	Reopen for Correction	Admin, Accountant, Staff (original creator)	Reopens entry for editing; must resubmit after correction
11.2.3 State Transition Diagram
The entry lifecycle follows this flow: a scan produces an OPEN entry. The user edits the entry as needed, then clicks "Submit for Approval" to move it to PENDING_APPROVAL. An admin or accountant reviews the entry in the approval queue and either approves it (moving to APPROVED) or rejects it (moving to REJECTED with a reason). An APPROVED entry can be synced to QuickBooks by a user with sync permission. If an error is discovered in an APPROVED entry before sync, the admin can revert it to OPEN for correction, after which it must go through the approval process again. A REJECTED entry can be reopened to OPEN for correction, and the corrected entry must be resubmitted for approval. The key invariant is: an entry can only be edited when it is in the OPEN state. All other states lock the entry to prevent unauthorized modifications.
11.3 Role-Based Sync Permissions
The approval workflow is governed by three user roles, each with distinct capabilities. The role assignments are managed by the Admin and stored in the User model. In addition to the three predefined roles, the Admin can toggle a per-user "restrict direct sync" setting that determines whether the user can bypass the approval workflow. When a user is restricted, they can only create draft (OPEN) entries and submit them for approval; they cannot approve, reject, or sync entries. When a user is unrestricted, they retain their role's full capabilities, including the ability to sync approved entries to QuickBooks (for Admin and Accountant roles).
11.3.1 Role Definitions
Role	Create/Edit Open Entries	Submit for Approval	Approve/Reject	Sync to QB	Manage User Permissions
Admin	Yes	Yes	Yes	Yes	Yes
Accountant	Yes	Yes	Yes	Yes	No
Staff Viewer	Yes (create only)	Yes (if restricted)	No	No	No
11.3.2 Per-User Sync Restriction
The Admin can configure a per-user "restrictDirectSync" toggle on the User model. This toggle overrides the role's default sync capability. When restrictDirectSync is true for a user, that user cannot sync any entry to QuickBooks regardless of their role. Instead, all entries they create are forced into the OPEN state, and they can only submit them for approval. This setting is particularly useful for new employees who are still learning the mapping system, or for organizations that require all entries to go through an approval process regardless of the creator's role. The restrictDirectSync field is stored on the User model as a boolean with a default of false (unrestricted), preserving backward compatibility with existing users who currently sync directly.
User Setting	Effect on Entry Flow	Can Bypass Approval?
restrictDirectSync = false (default)	User follows their role's default workflow	Yes (Admin/Accountant can auto-approve)
restrictDirectSync = true	All entries created by this user must go through approval	No — entries stay OPEN until approved by another user
11.3.3 Permission Enforcement Points
Permissions are enforced at three layers. First, the API layer checks the user's role and restrictDirectSync setting before allowing any state transition or sync operation. If a Staff Viewer attempts to approve an entry, the API returns a 403 Forbidden response with a PERMISSION_DENIED error code. Second, the frontend layer hides or disables UI elements based on the user's permissions (e.g., the "Sync to QuickBooks" button is hidden for Staff Viewers and restricted users). Third, the QuickBooks sync service checks the entry's state and the user's sync permission before executing the sync, providing a defense-in-depth safeguard against unauthorized syncs.
11.4 Draft/Open Entry Management
When a scan is completed and the extracted data is mapped using the template, the resulting entry is created in the OPEN state. The OPEN state is the only state where the entry is fully editable: users can modify account assignments, adjust amounts, change the memo, add or remove line items, and correct any mapping errors. The Open entries view serves as the user's working area where they can review and refine entries before submitting them for approval.
11.4.1 Open Entries View
The Open entries view displays a filterable, sortable table of all entries in the OPEN state that the current user has access to. The table columns include: entry date, vendor/payee name, total amount, transaction type (JE, Bill, VC, Cheque), scan mode (IMAGE, EXCEL, POS), template name, and the time elapsed since creation. Each row has action buttons: Edit (opens the entry in the mapping editor), Submit for Approval (transitions to PENDING_APPROVAL), and Delete (removes the draft entry permanently — only available for OPEN entries). The view supports batch operations: the user can select multiple entries and submit them all for approval at once.
11.4.2 Editing Open Entries
Clicking Edit on an OPEN entry opens the same mapping editor that was used during the initial scan, but pre-populated with the entry's current values. The editor respects the template's scan mode, showing only the mode-compatible sections as defined in Section 4. Edits are saved automatically (auto-save with a 3-second debounce) or manually via a Save button. The entry remains in the OPEN state throughout the editing process; no state transition occurs until the user explicitly clicks "Submit for Approval". The edit history is tracked: each save creates a revision record with the changed fields, the previous values, and the timestamp, providing a complete audit trail of all modifications made to the draft.
11.4.3 Submitting for Approval
When the user is satisfied with the entry, they click "Submit for Approval". This action validates that all required fields are populated (vendor for Bill/VC/Cheque, at least one line item, non-zero total). If validation passes, the entry transitions from OPEN to PENDING_APPROVAL. If validation fails, the user is shown the specific validation errors and the entry remains in OPEN. For unrestricted Admin and Accountant users, an additional "Auto-Approve & Sync" option is available that skips the PENDING_APPROVAL state and moves the entry directly to APPROVED, then immediately syncs it to QuickBooks. This option is not available for restricted users or Staff Viewers.
11.5 Approval Process & Admin Actions
The approval process is the central quality gate that prevents incorrect entries from reaching QuickBooks. Entries in the PENDING_APPROVAL state appear in the Approval Queue, which is accessible only to Admin and Accountant users. The queue provides a consolidated view of all entries awaiting review, with sorting and filtering capabilities that allow the reviewer to prioritize their work.
11.5.1 Approval Queue
The Approval Queue displays all entries in the PENDING_APPROVAL state across all users and locations that the reviewer has access to. The table columns include: entry date, submitted by (user name), vendor/payee, total amount, transaction type, scan mode, time in queue, and a priority indicator (entries that have been in the queue longest are flagged with an amber icon after 24 hours and a red icon after 48 hours). Each row has three action buttons: Review (opens the entry in a read-only detail view with all line items, mapping details, and edit history), Approve (transitions to APPROVED), and Reject (opens a rejection reason dialog). The reviewer can also use batch actions to approve or reject multiple entries at once.
11.5.2 Approve Action
When a reviewer clicks Approve, the entry transitions from PENDING_APPROVAL to APPROVED. The entry is now locked for editing and becomes eligible for QuickBooks sync. The approved entry's reviewedById field is set to the reviewer's user ID, and the reviewedAt field is set to the current timestamp. The entry's audit log records the approval action. If the reviewer has sync permission (Admin or Accountant with unrestricted access), a "Sync Now" button appears on the approved entry, allowing immediate sync to QuickBooks. Alternatively, approved entries can be synced in batch from the Approved entries view.
11.5.3 Reject Action
When a reviewer clicks Reject, a modal dialog appears requiring the reviewer to enter a rejection reason (minimum 10 characters) and optionally select a rejection category from a predefined list: Incorrect Account Mapping, Wrong Amount, Missing Information, Duplicate Entry, Wrong Transaction Type, or Other. The rejection reason is stored in the rejectionReason field on the entry, and the rejection category is stored in the rejectionCategory field. The entry transitions from PENDING_APPROVAL to REJECTED, and the original creator receives a notification (in-app and optional email) informing them that their entry was rejected with the specified reason. The entry appears in the Rejected entries view, where the creator can review the reason and reopen the entry for correction.
11.5.4 Batch Approve/Reject
The Approval Queue supports batch operations for efficiency. The reviewer can select multiple entries using checkboxes and click "Batch Approve" or "Batch Reject". Batch Approve transitions all selected entries to APPROVED in a single transaction, ensuring atomicity (either all entries are approved or none are). Batch Reject requires a single rejection reason and category that applies to all selected entries. If the reviewer needs to provide different reasons for different entries, they must reject them individually. The batch action creates individual audit log entries for each affected entry, maintaining the same level of traceability as individual actions.
11.6 Rejected Entry Management
Rejected entries represent a critical feedback mechanism in the approval workflow. They identify entries that did not pass review and need correction before they can be resubmitted. The Rejected entries view provides a dedicated space for tracking and managing these entries, separate from the Open and Approved views, so that they are not overlooked or confused with drafts that have not yet been submitted.
11.6.1 Rejected Entries View
The Rejected entries view displays all entries in the REJECTED state that the current user has access to. For Admin and Accountant users, this includes all rejected entries across all users. For Staff users, this includes only their own rejected entries. The table columns include: entry date, vendor/payee, total amount, rejected by (reviewer name), rejection date, rejection category, and a truncated rejection reason. Each row has two action buttons: View Reason (expands the row to show the full rejection reason and category) and Reopen for Correction (transitions the entry back to OPEN). The view also displays summary statistics at the top: total rejected entries, most common rejection category, and average time from rejection to reopening.
11.6.2 Reopening a Rejected Entry
When a user clicks "Reopen for Correction" on a rejected entry, the entry transitions from REJECTED to OPEN. The rejection reason and category are preserved in the entry's audit history but are cleared from the entry's active rejectionReason field (moved to the history log) so that the entry is not confused with a newly rejected entry. The entry is now fully editable, and the user can correct the issues identified by the reviewer. After correction, the user must resubmit the entry for approval (OPEN → PENDING_APPROVAL → APPROVED/REJECTED). The resubmission is tracked separately from the original submission, and the reviewer can see the full history of rejections and corrections in the entry's detail view.
11.6.3 Rejection Analytics
The Rejected entries view includes an analytics panel that helps administrators identify systematic issues. The panel displays three charts: (1) Rejection rate over time (line chart showing the percentage of submitted entries that are rejected per week), (2) Rejection category distribution (pie chart showing the proportion of each rejection category), and (3) Top rejected templates (bar chart showing which templates produce the most rejected entries). These analytics help administrators identify templates with poor default mappings, users who need additional training, or scan modes that produce lower-quality extractions. When a template's rejection rate exceeds 30%, the analytics panel highlights it with a red indicator and suggests reviewing the template's mapping configuration.
11.7 Edit Restrictions & State Transitions
The edit restriction model is the cornerstone of the approval workflow's integrity. The fundamental rule is simple: entries can only be edited when they are in the OPEN state. All other states lock the entry to prevent unauthorized modifications. This section details the specific edit restrictions for each state, the revert-to-open mechanism, and the re-approval requirement after reverting an approved entry.
11.7.1 Edit Permissions by State
Entry State	Can Edit Fields?	Can Change Account Assignments?	Can Modify Amounts?	Can Add/Remove Line Items?	Can Delete Entry?
OPEN	Yes	Yes	Yes	Yes	Yes (permanent delete)
PENDING_APPROVAL	No	No	No	No	No (must reject first, then reopen and delete)
APPROVED	No	No	No	No	No (must revert to OPEN first)
REJECTED	No (must reopen first)	No (must reopen first)	No (must reopen first)	No (must reopen first)	No (must reopen first, then delete)
11.7.2 Revert to Open (From Approved)
When an admin or accountant discovers an error in an APPROVED entry that has not yet been synced to QuickBooks, they can click "Revert to Open" to move the entry back to the OPEN state. This action requires a mandatory reason ("Why are you reverting this approved entry?"), which is logged in the audit trail. Once reverted, the entry is fully editable. After the corrections are made, the entry must be resubmitted for approval and go through the full approval cycle again (OPEN → PENDING_APPROVAL → APPROVED). The revert action is only available for entries that have NOT been synced to QuickBooks. If an entry has already been synced, reverting is not possible; instead, the admin must create a reversing entry in QuickBooks and then create a new corrected entry in Nest.
11.7.3 Audit Trail for State Changes
Every state transition is recorded in an EntryAuditLog table with the following fields: entryId, fromState, toState, actionedBy (user ID), actionedAt (timestamp), reason (optional for reject/revert), and metadata (JSON field for additional context like the batch operation ID). The audit log is append-only; records cannot be modified or deleted. The entry detail view displays the complete audit trail as a chronological timeline, showing every state change, the user who performed it, and the associated reason or comment. This audit trail serves both operational purposes (understanding why an entry was rejected) and compliance purposes (demonstrating that entries were reviewed before being posted to QuickBooks).
11.8 Data Model & Schema Changes for Approval
The approval workflow requires additions to three existing models (User, ScanRecord/Entry, Template) and two new models (EntryAuditLog, RejectionReason). The changes follow the same additive, backward-compatible approach established in Section 7: all new fields have defaults or are nullable, and no existing fields are removed.
11.8.1 New Enum: EntryState
A new Prisma enum defines the four entry states. Add this enum to schema.prisma after the ScanMode enum.
enum EntryState {
  OPEN
  PENDING_APPROVAL
  APPROVED
  REJECTED
}
11.8.2 User Model Changes
The User model gains two new fields: role and restrictDirectSync. The role field uses a new UserRole enum with values ADMIN, ACCOUNTANT, and STAFF_VIEWER. The restrictDirectSync field is a boolean that defaults to false (unrestricted), preserving backward compatibility. When restrictDirectSync is true, the user can only create OPEN entries and submit them for approval; they cannot approve, reject, or sync entries. These fields enable the admin to configure per-user permission profiles that control the entry lifecycle.
role                UserRole  @default(STAFF_VIEWER)
restrictDirectSync  Boolean  @default(false)
11.8.3 Entry/ScanRecord Model Changes
The ScanRecord (or Entry) model gains the following fields to track the approval state and review metadata. The entryStatus field uses the EntryState enum with a default of OPEN, ensuring that all new entries start as drafts. The reviewedById field references the User who approved or rejected the entry. The rejectionReason and rejectionCategory fields store the reviewer's feedback when rejecting an entry. The syncedToQbAt field records the timestamp when the entry was successfully synced to QuickBooks, which is used to determine whether revert-to-open is allowed (revert is blocked once syncedToQbAt is non-null).
entryStatus       EntryState  @default(OPEN)
reviewedById      String?
reviewedAt        DateTime?
rejectionReason   String?
rejectionCategory String?
syncedToQbAt      DateTime?
submittedAt       DateTime?
11.8.4 New Model: EntryAuditLog
The EntryAuditLog model records every state transition for every entry. This model is append-only; records are never updated or deleted. The audit log provides a complete, tamper-evident history of the entry lifecycle.
model EntryAuditLog {
  id          String    @id @default(cuid())
  entryId     String
  fromState   EntryState
  toState     EntryState
  actionedBy  String
  actionedAt  DateTime  @default(now())
  reason      String?
  metadata    Json?
  entry       ScanRecord @relation(fields: [entryId], references: [id])
  user        User       @relation(fields: [actionedBy], references: [id])
}
11.8.5 Schema Changes Summary
Model	Field	Type	Default	Nullable	Description
(new enum)	EntryState	enum { OPEN, PENDING_APPROVAL, APPROVED, REJECTED }	N/A	N/A	Entry lifecycle states
(new enum)	UserRole	enum { ADMIN, ACCOUNTANT, STAFF_VIEWER }	N/A	N/A	User role definitions
User	role	UserRole	STAFF_VIEWER	No	User's role; defaults to least privileged
User	restrictDirectSync	Boolean	false	No	When true, user cannot sync directly; must go through approval
ScanRecord	entryStatus	EntryState	OPEN	No	Current state of the entry; defaults to draft
ScanRecord	reviewedById	String	null	Yes	User who approved/rejected the entry
ScanRecord	reviewedAt	DateTime	null	Yes	Timestamp of approval/rejection
ScanRecord	rejectionReason	String	null	Yes	Reviewer's reason for rejection
ScanRecord	rejectionCategory	String	null	Yes	Category: Incorrect Mapping, Wrong Amount, etc.
ScanRecord	syncedToQbAt	DateTime	null	Yes	When entry was synced to QB; null = not synced
ScanRecord	submittedAt	DateTime	null	Yes	When entry was submitted for approval
(new model)	EntryAuditLog	Full model	N/A	N/A	Append-only audit log for all state transitions
11.9 API Endpoint Changes for Approval Workflow
The approval workflow introduces five new API endpoints and modifies two existing endpoints. All new endpoints require authentication and enforce role-based access control. The endpoints follow the same REST conventions and error response format established in Section 8.
11.9.1 POST /api/entries/:id/submit
Submits an OPEN entry for approval, transitioning it from OPEN to PENDING_APPROVAL. The endpoint validates that all required fields are populated before allowing the transition. If validation fails, it returns a 422 with a list of missing or invalid fields. If the user has restrictDirectSync set to true, this is the only way they can progress an entry beyond the OPEN state. For unrestricted Admin and Accountant users, an optional query parameter autoApprove=true can be provided to skip the approval step and move directly to APPROVED.
Parameter	Type	Required	Description
autoApprove	Boolean (query)	No	If true and user is unrestricted, skip approval and move to APPROVED
11.9.2 POST /api/entries/:id/approve
Approves an entry in PENDING_APPROVAL state, transitioning it to APPROVED. Only Admin and Accountant users can call this endpoint. The entry is locked for editing after approval. The reviewedById and reviewedAt fields are set automatically. The endpoint also accepts an optional comment field that is stored in the audit log.
11.9.3 POST /api/entries/:id/reject
Rejects an entry in PENDING_APPROVAL state, transitioning it to REJECTED. Only Admin and Accountant users can call this endpoint. The request body must include a rejection reason (minimum 10 characters) and an optional rejection category. The endpoint returns the updated entry with the rejection metadata.
Field	Type	Required	Validation	Description
reason	String	Yes	Min 10 characters	The reviewer's reason for rejecting the entry
category	String	No	One of: INCORRECT_MAPPING, WRONG_AMOUNT, MISSING_INFO, DUPLICATE, WRONG_TYPE, OTHER	Categorized rejection reason for analytics
11.9.4 POST /api/entries/:id/revert
Reverts an APPROVED entry back to OPEN, allowing edits. Only Admin and Accountant users can call this endpoint. The entry must not have been synced to QuickBooks (syncedToQbAt must be null). The request body must include a revert reason. After reverting, the entry must go through the full approval cycle again.
Field	Type	Required	Validation	Description
reason	String	Yes	Min 10 characters	Why the approved entry is being reverted for editing
11.9.5 POST /api/entries/:id/reopen
Reopens a REJECTED entry back to OPEN, allowing the creator to correct the issues. The original creator (the user who scanned the entry), Admin, and Accountant users can call this endpoint. The rejection reason is preserved in the audit history but cleared from the active rejectionReason field. The entry becomes fully editable.
11.9.6 Modified: GET /api/entries
The entry listing endpoint gains a new query parameter entryStatus that filters entries by their current state. When omitted, all entries are returned (preserving backward compatibility). The response includes the entryStatus, reviewedBy, rejectionReason, and rejectionCategory fields for each entry.
Parameter	Type	Required	Default	Description
entryStatus	String	No	null	Filter by state: OPEN, PENDING_APPROVAL, APPROVED, REJECTED
submittedBy	String	No	null	Filter by the user who submitted the entry
reviewedBy	String	No	null	Filter by the user who approved/rejected the entry
11.9.7 Modified: POST /api/entries/:id/sync
The QuickBooks sync endpoint now validates that the entry is in the APPROVED state before allowing the sync. If the entry is not APPROVED, the endpoint returns a 409 Conflict with an ENTRY_NOT_APPROVED error code. If the user does not have sync permission (Staff Viewer or restrictDirectSync is true), the endpoint returns a 403 Forbidden. After a successful sync, the syncedToQbAt field is set to the current timestamp, and the entry can no longer be reverted to OPEN.
11.9.8 Approval API Error Codes Summary
HTTP Status	errorCode	Condition
403	PERMISSION_DENIED	User's role does not allow this action (e.g., Staff trying to approve)
403	SYNC_RESTRICTED	User's restrictDirectSync is true; cannot sync directly
409	ENTRY_NOT_APPROVED	Attempt to sync an entry that is not in APPROVED state
409	ENTRY_ALREADY_SYNCED	Attempt to revert an entry that has been synced to QB
409	INVALID_STATE_TRANSITION	State transition is not valid (e.g., REJECTED → APPROVED)
422	VALIDATION_FAILED	Entry is missing required fields for submission
422	REJECTION_REASON_REQUIRED	Reject action submitted without a reason
11.10 Frontend Implementation for Approval Views
The frontend changes for the approval workflow add four new tab views to the entry management interface and modify the existing scan result view to support the OPEN state. The tabs follow the design pattern established in Section 9: each tab is a composable component that reads the user's role and permissions from context to determine which actions to display.
11.10.1 Entry Management Tab Bar
A new tab bar component is added to the main entry listing view with four tabs, each showing a count badge. The tabs are: Open (draft entries, editable), Pending Approval (entries awaiting review, visible to Admin/Accountant), Approved (locked entries eligible for sync), and Rejected (entries that need correction). The active tab is determined by the URL path or a query parameter. Each tab's badge shows the count of entries in that state, updated in real-time via WebSocket or polling. The Pending Approval tab badge uses a red indicator when there are entries that have been waiting more than 24 hours.
Tab	Entry State	Visible To	Primary Actions	Badge Color
Open	OPEN	All users (own entries); Admin/Accountant (all)	Edit, Submit for Approval, Delete	Blue
Pending Approval	PENDING_APPROVAL	Admin, Accountant only	Review, Approve, Reject	Amber (red if > 24h)
Approved	APPROVED	All users (own entries); Admin/Accountant (all)	Sync to QB, Revert to Open	Green
Rejected	REJECTED	All users (own entries); Admin/Accountant (all)	View Reason, Reopen for Correction	Red
11.10.2 Open Entries Tab Component
The Open Entries tab displays all OPEN entries accessible to the current user. For Staff users, only their own entries are shown. For Admin and Accountant users, all OPEN entries across all users are displayed. Each entry row shows the entry summary and two primary action buttons: Edit (opens the mapping editor with the entry's current values) and Submit for Approval (validates and transitions to PENDING_APPROVAL). A batch action bar appears at the top when entries are selected, allowing batch submission. For unrestricted Admin and Accountant users, a tertiary "Auto-Approve & Sync" action is available that skips the approval step entirely.
11.10.3 Approval Queue Tab Component
The Approval Queue tab is only visible to Admin and Accountant users. It displays all PENDING_APPROVAL entries with a priority indicator based on time in queue. Each row has three action buttons: Review (opens a read-only detail view with audit trail), Approve (one-click approval with optional comment), and Reject (opens rejection reason modal). The batch action bar supports batch approve and batch reject. The rejection modal includes a required reason text area (min 10 characters) and a category dropdown. The approval queue auto-refreshes every 30 seconds to show new submissions from other users.
11.10.4 Approved Entries Tab Component
The Approved Entries tab displays all APPROVED entries. Each row shows the entry summary and two action buttons: Sync to QB (calls the sync endpoint; only visible if user has sync permission) and Revert to Open (calls the revert endpoint; only visible if the entry has not been synced). A batch Sync to QB action is available for Admin and Accountant users. Entries that have already been synced show a "Synced" badge with the sync timestamp and a link to the QuickBooks transaction. The Sync to QB button is disabled for Staff Viewers and users with restrictDirectSync=true.
11.10.5 Rejected Entries Tab Component
The Rejected Entries tab displays all REJECTED entries. Each row shows the entry summary and a truncated rejection reason. Clicking the row expands it to show the full rejection reason, category, and reviewer name. The primary action is "Reopen for Correction" which transitions the entry to OPEN. The analytics panel at the top shows the three charts described in Section 11.6.3: rejection rate over time, category distribution, and top rejected templates. For Staff users, only their own rejected entries are shown. For Admin and Accountant users, all rejected entries are visible.
11.10.6 Files to Create or Modify
File Path	Action	Description
src/views/Entries/EntryTabBar.tsx	Create	Tab bar component with 4 tabs and count badges
src/views/Entries/OpenEntriesTab.tsx	Create	Open entries view with Edit, Submit, Delete actions
src/views/Entries/PendingApprovalTab.tsx	Create	Approval queue with Review, Approve, Reject actions
src/views/Entries/ApprovedEntriesTab.tsx	Create	Approved entries view with Sync and Revert actions
src/views/Entries/RejectedEntriesTab.tsx	Create	Rejected entries view with Reopen and analytics panel
src/components/RejectionModal.tsx	Create	Modal for entering rejection reason and category
src/components/RevertModal.tsx	Create	Modal for entering revert reason (from Approved to Open)
src/components/EntryAuditTimeline.tsx	Create	Chronological audit trail display for entry state changes
src/components/RejectionAnalytics.tsx	Create	Analytics panel with 3 charts for rejection insights
src/contexts/EntryPermissionsContext.tsx	Create	Context providing user role, restrictDirectSync, and action permissions
11.11 Integration with Existing Scan Flow
The approval workflow integrates with the existing scan → mapping → entry pipeline at a single point: when the user clicks "Create Entry" (or equivalent) after completing the mapping, the entry is created in the OPEN state instead of being immediately synced to QuickBooks. This is the only change to the existing scan flow; the mapping editor, template selection, and mode-specific validation all work exactly as described in Sections 1-10.
11.11.1 Scan-to-Entry Flow with Approval
The updated scan-to-entry flow proceeds as follows: (1) User scans a document/image/Excel file/POS page. (2) User selects a template (mode mismatch warning shown if applicable). (3) User maps the extracted data using the mode-specific mapping editor. (4) User clicks "Create Entry" — the entry is created in the OPEN state and appears in the Open Entries tab. (5) User reviews the entry in the Open Entries tab, makes any edits needed, and clicks "Submit for Approval" — the entry transitions to PENDING_APPROVAL. (6) Admin/Accountant reviews the entry in the Approval Queue and clicks "Approve" — the entry transitions to APPROVED. (7) User or Admin clicks "Sync to QB" — the entry is synced to QuickBooks and syncedToQbAt is set. If the user is unrestricted and has auto-approve enabled, steps 5-6 can be combined into a single "Auto-Approve & Sync" action from step 4.
11.11.2 Mode-Specific Approval Considerations
The approval workflow applies uniformly across all scan modes, but there are mode-specific considerations. For IMAGE mode entries, the reviewer should pay special attention to the double-counting risk (Section 6.4) when both header totals and line items are mapped. For EXCEL mode entries, the reviewer should verify that the column mapping was correct by checking the first few rows of data against the entry values. For POS mode entries, the reviewer should confirm that the category-to-account mapping is correct, as POS entries are typically flat summaries with no line-item detail. The entry detail view in the Approval Queue displays mode-specific warnings (e.g., "This IMAGE entry has both header total and line items mapped — verify no double-counting") to help reviewers focus their attention.
11.11.3 Notification System
The approval workflow includes an in-app notification system that alerts users when their entries are approved or rejected, and alerts reviewers when new entries are submitted for approval. Notifications are displayed in a bell icon dropdown in the Chrome Extension's toolbar. Each notification includes: the entry ID, the action (approved, rejected, submitted), the user who performed the action, and a timestamp. Clicking a notification navigates the user to the relevant entry. For rejected entries, the notification includes a preview of the rejection reason. Notifications are also sent via email (configurable per user) for users who want to be alerted outside the extension. The notification system uses the existing WebSocket connection (or falls back to 30-second polling) to deliver real-time updates.
Notification Event	Recipients	Content	Delivery
Entry submitted for approval	All Admin and Accountant users for the location	Entry ID, submitter name, amount, transaction type	In-app + optional email
Entry approved	Entry creator	Entry ID, reviewer name, approval timestamp	In-app + optional email
Entry rejected	Entry creator	Entry ID, reviewer name, rejection reason, category	In-app + mandatory email
Entry reverted to Open	Entry creator (if different from reverter)	Entry ID, reverter name, revert reason	In-app only
12. QuickBooks Sync Integration Deep Dive
12.1 Sync Pipeline Architecture
Once an entry reaches the APPROVED state and a user with sync permission initiates the sync operation, the entry enters the QuickBooks Sync Pipeline. This pipeline is a multi-stage process designed to reliably transmit entry data to QuickBooks Online (QBO), handle transient failures gracefully, and maintain a complete audit trail of every sync attempt. The pipeline is transactional at the application level: an entry's sync status only transitions to SYNCED after QuickBooks acknowledges successful creation of the corresponding entity. If any stage fails, the entry remains in a recoverable state and can be retried without producing duplicate records in QuickBooks.
The pipeline consists of six sequential stages. First, the Pre-Sync Validation stage re-checks that the entry is APPROVED, that all required fields are populated, and that the user has sync permission. Second, the Payload Construction stage transforms the Nest entry into the QuickBooks API request body, mapping Nest fields to the appropriate QuickBooks entity (Bill, JournalEntry, VendorCredit, or Purchase/Payment for Cheque). Third, the Idempotency Key Generation stage produces a unique key that is sent with the request so that QuickBooks can deduplicate retries. Fourth, the API Call stage executes the HTTP POST to the QuickBooks API with retry and backoff handling. Fifth, the Response Handling stage parses the response, extracts the QuickBooks entity ID, and updates the entry's sync status. Sixth, the Post-Sync Recording stage writes a SyncLog entry capturing the request payload, response body, latency, and outcome.
Stage	Purpose	Failure Handling	Result of Failure
1. Pre-Sync Validation	Verify entry state, field completeness, user permission	Return 422 with field-level errors	Sync aborted; entry remains APPROVED
2. Payload Construction	Map Nest entry to QuickBooks entity schema	Return 500 with mapping error	Sync aborted; entry remains APPROVED; logged as construction failure
3. Idempotency Key Generation	Generate deterministic key from entry ID + revision	N/A (always succeeds)	N/A
4. API Call	Execute POST to QuickBooks API	Retry with exponential backoff (3 attempts)	Sync marked SYNC_FAILED; entry remains APPROVED; admin notified
5. Response Handling	Parse QuickBooks response, extract entity ID	Mark as SYNC_FAILED with response body	Entry remains APPROVED; admin reviews response
6. Post-Sync Recording	Write SyncLog entry with full request/response	Log error; sync still considered successful if stage 5 succeeded	Sync status unaffected; log entry may be missing
12.2 QuickBooks API Payload Mapping
Nest entries are mapped to four QuickBooks Online entity types depending on the transaction type declared by the template: JournalEntry (for JE templates), Bill (for Bill templates), VendorCredit (for VC templates), and Purchase (for Cheque templates, modeled as a Purchase with payment method "CASH"). The mapping is deterministic and governed by the template's field mapping configuration. Each Nest field is mapped to a specific QuickBooks field, and unmapped fields are omitted from the payload to avoid sending stale or irrelevant data. The table below summarizes the high-level field mapping for each transaction type; detailed field-by-field mappings are documented in the API specification appendix.
Nest Entry Field	QuickBooks JournalEntry	QuickBooks Bill	QuickBooks VendorCredit	QuickBooks Purchase (Cheque)
Entry Date	TxnDate	TxnDate	TxnDate	TxnDate
Memo / Description	PrivateNote	PrivateNote	PrivateNote	PrivateNote
Doc Number / Ref	DocNumber	DocNumber	DocNumber	PaymentRefNum
Vendor / Payee	N/A (JE has no vendor)	VendorRef	VendorRef	EntityRef (Vendor)
Line Items	Line[] (JournalEntryLineDetail)	Line[] (AccountBasedExpenseDetail or ItemBasedExpenseDetail)	Line[] (AccountBasedExpenseDetail)	Line[] (AccountBasedExpenseDetail)
Account (per line)	JournalEntryLineDetail.PostingType + AccountRef	AccountBasedExpenseDetail.AccountRef	AccountBasedExpenseDetail.AccountRef	AccountBasedExpenseDetail.AccountRef
Amount (per line)	Line.Amount + JournalEntryLineDetail.PostingType (Debit/Credit)	Line.Amount	Line.Amount (negative)	Line.Amount
Department / Class	JournalEntryLineDetail.ClassRef	ClassRef (line-level)	ClassRef (line-level)	ClassRef (line-level)
Currency	CurrencyRef	CurrencyRef	CurrencyRef	CurrencyRef
Several transformations occur during payload construction that go beyond simple field copying. First, the line-item amount sign convention differs: QuickBooks VendorCredit expects negative amounts on lines, while Bill and Purchase expect positive amounts; the sync service applies the appropriate sign flip based on transaction type. Second, the JournalEntry line detail requires an explicit PostingType (DEBIT or CREDIT) for each line, which Nest derives from the line's account type and the configured debit/credit indicator in the template defaults. Third, account references use the QuickBooks AccountRef value object containing both the value (account ID) and name (account display name); the sync service looks up the QuickBooks account ID from the locally cached account map, which is refreshed nightly from the QuickBooks Chart of Accounts. If an account ID cannot be resolved, the sync fails at stage 1 with an UNRESOLVED_ACCOUNT error.
12.3 Idempotency & Retry Strategy
Duplicate syncs are a critical concern: if the QuickBooks API receives the same entry twice, it will create two separate transactions, requiring manual cleanup. Nest prevents duplicates through a combination of idempotency keys and a sync state machine. Every sync attempt is assigned an idempotency key derived deterministically from the entry ID and the entry's current revision number. The key is sent in the QuickBooks API request header as "X-Idempotency-Key" and is also stored locally in the SyncLog. If a sync fails after the request was sent but before a response was received (e.g., due to a network timeout), the retry uses the same idempotency key, allowing QuickBooks to recognize and reject the duplicate. The revision component of the key ensures that if the entry is reverted to OPEN, edited, and re-approved, the new sync attempt uses a different key (because the revision number has incremented), preventing false-positive duplicate rejection.
Scenario	Idempotency Key Behavior	Outcome
First sync attempt succeeds	Key X generated and stored	Entry marked SYNCED; key X retired
Sync attempt times out (no response from QB)	Same key X reused on retry	QB recognizes key X, returns original entity ID; no duplicate created
Sync fails with 4xx error	Same key X reused on manual retry	QB returns the original 4xx error; user must fix entry before re-sync
Entry reverted, edited, re-approved, re-synced	New key Y generated (revision incremented)	QB creates a new entity; both old and new are valid (user should void the old one in QB if needed)
Network glitch causes double-submit	Both requests carry key X	QB processes first, rejects second as duplicate; SyncLog records both attempts
The retry strategy uses exponential backoff with jitter. The sync service retries transient failures (5xx responses, network timeouts, rate-limit 429 responses) up to three times with delays of 2s, 4s, and 8s plus a random jitter of 0-1s. Non-transient failures (4xx responses, validation errors) are not retried; instead, the entry is marked SYNC_FAILED and the admin is notified. A separate background job (the "dead-letter processor") runs every 15 minutes and attempts to re-sync entries that have been in SYNC_FAILED state for more than 30 minutes, providing a self-healing mechanism for entries that failed due to temporary QuickBooks outages. Entries that fail five consecutive dead-letter attempts are escalated to the admin via a high-priority notification.
12.4 Conflict Resolution & Error Handling
QuickBooks API errors are categorized into three classes, each with a distinct handling strategy. The first class is validation errors (HTTP 400 with a QuickBooks error code indicating a business rule violation, such as a non-existent account reference or an unbalanced journal entry). These errors are surfaced to the user with the specific field and the QuickBooks error message; the entry is reverted to OPEN state so the user can correct the error and resubmit. The second class is authentication/authorization errors (HTTP 401 or 403, indicating an expired or revoked OAuth token). These errors trigger an automatic token refresh attempt; if the refresh fails, the sync is marked SYNC_FAILED with an AUTH_TOKEN_EXPIRED error code, and the admin is notified to re-authorize the QuickBooks connection. The third class is transient errors (HTTP 429, 500, 502, 503, 504, or network timeouts). These errors trigger the retry strategy described in Section 12.3.
Error Class	HTTP Status	QuickBooks Error Examples	Handling Strategy	Entry State After
Validation Error	400	AccountNotFound, UnbalancedTransaction, InvalidDate	Surface field-level error to user; revert entry to OPEN	OPEN (user must fix and resubmit)
Auth Error	401, 403	AuthenticationFailed, AuthorizationDenied	Attempt token refresh; if refresh fails, notify admin	APPROVED (sync failed; retry after re-auth)
Transient Error	429, 5xx	RateLimitExceeded, ServiceUnavailable, InternalServerError	Retry with exponential backoff (3 attempts); then dead-letter queue	APPROVED (sync failed; auto-retry later)
Conflict (duplicate)	409	DuplicateDetected (via idempotency key)	Return original entity ID; mark as SYNCED	SYNCED (deduplicated)
Network Failure	N/A (no response)	Timeout, ConnectionReset	Retry with same idempotency key	APPROVED (sync failed; auto-retry)
A specific conflict scenario deserves detailed treatment: the "phantom duplicate" case. This occurs when the sync service receives a network timeout, assumes the sync failed, and marks the entry SYNC_FAILED — but QuickBooks actually created the entity successfully. When the user retries the sync, QuickBooks may reject the new request as a duplicate of the phantom entity. The idempotency key mechanism handles this case for retries within the same revision: the retry carries the same key, QuickBooks recognizes it, and returns the phantom entity's ID, allowing the sync service to correctly mark the entry SYNCED. For cross-revision retries (after the entry was edited), the user is warned that a phantom entity may exist in QuickBooks and is given the option to search for it by the original DocNumber before confirming the new sync.
12.5 Sync Status Tracking
Each entry carries a syncStatus field that tracks the entry's position in the sync pipeline. The field is separate from the entryStatus field (which tracks the approval workflow) to allow entries to be APPROVED but not yet synced, SYNCED but later reverted, or SYNC_FAILED and awaiting retry. The syncStatus field has five possible values, and transitions are logged in the SyncLog table along with the timestamp, user ID, and any associated metadata (such as the QuickBooks entity ID assigned upon successful sync).
Sync Status	Description	Visible to User?	Automatic Transitions
NOT_SYNCED	Entry is APPROVED but has not been synced to QuickBooks	Yes ("Sync" button enabled)	→ SYNCING when user clicks Sync
SYNCING	Sync is in progress; request has been sent to QuickBooks	Yes (spinner shown)	→ SYNCED on success; → SYNC_FAILED on failure
SYNCED	Sync completed successfully; QuickBooks entity ID is recorded	Yes ("Synced" badge + QB entity link)	→ NOT_SYNCED if entry reverted to OPEN for editing
SYNC_FAILED	Sync attempted but failed; admin/user must review	Yes (red "Failed" badge + retry button)	→ SYNCING on manual retry; → SYNCING on dead-letter auto-retry
SYNC_VOIDED	Entry was synced but later voided in QuickBooks (via webhook)	Yes (grey "Voided" badge)	Terminal state; entry cannot be re-synced
The SyncLog table maintains a complete history of every sync attempt for each entry. Each SyncLog record contains: the entry ID, the attempt number, the idempotency key, the full request payload (JSON), the full response body (JSON), the HTTP status code, the latency in milliseconds, the user ID who initiated the sync, the timestamp, and the outcome (success, failure, or duplicate-detected). The SyncLog is append-only: records are never updated or deleted, providing an immutable audit trail. Administrators can access the SyncLog through the admin dashboard, where they can filter by entry ID, outcome, date range, or user, and drill into individual attempts to inspect the request and response payloads for debugging.
Sync progress is surfaced to the user in real time. When a sync is initiated, the entry's row in the Approved entries view updates to show a "Syncing…" spinner. The frontend polls the GET /api/entries/:id/sync-status endpoint every 2 seconds while the entry is in the SYNCING state, and stops polling once the status transitions to SYNCED or SYNC_FAILED. For batch syncs (multiple entries synced at once), the UI shows an aggregate progress bar plus per-entry status indicators. Once all entries in a batch have reached a terminal state (SYNCED or SYNC_FAILED), the UI displays a summary toast notification with the count of successful and failed syncs, and the failed entries are highlighted in the table for follow-up.
