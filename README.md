# e-Maanak: Sovereign Legal Metrology System
### Smart India Hackathon (SIH 2026) — Problem Statement: SIH26036
**Ministry of Consumer Affairs, Food & Public Distribution | Department of Consumer Affairs**
*Category: Software | Theme: Miscellaneous*

---

## 1. Executive Summary & Production Readiness
**e-Maanak** is a sovereign, production-oriented Legal Metrology digital verification and certificate authentication platform. It digitizes the statutory verification, stamping, re-verification, field inspection, and certificate lifecycle for commercial weighing and measuring instruments across India.

### Architectural Highlights:
- **Field Inspector Progressive Web App (PWA)**: Designed for low/zero-connectivity field environments (mandis, petrol pumps, warehouses) using an IndexedDB-backed offline inspection bench with automatic draft persistence.
- **Idempotent Synchronization Engine**: Client-generated operation IDs (`clientOperationId`) ensure duplicate-proof, conflict-aware synchronization when network connectivity is restored.
- **Zero-Trust Authoritative Engine**: The backend independently recalculates errors using precise decimal arithmetic, enforcing statutory Maximum Permissible Error (MPE) thresholds before digital certificate issuance.
- **Hardware Scanner & Optical Barcode Abstraction**: Built-in camera viewport simulator with quick nameplate barcodes and manual fallback for rapid field verification and registration.
- **Security & DDoS Hardening**: Sliding-window rate limiting (200 req/min general, 30 req/min auth), strict HTTP security headers (nosniff, SAMEORIGIN, STS, XSS protection), production error sanitization, and CORS whitelist.
- **High-Performance Database Indexes**: Composite and single-column indexes on high-frequency query paths (Serial Numbers, Applications, Certificates, Tokens, Audit Logs).
- **State Repository Federation Adapter**: Standardized, versioned OpenAPI (`/api/v1`) exchange contracts (`DOCA-LM-CENTRAL-NODE-01`) for national and state repository integration.
- **Public QR Verification**: Instant consumer transparency via tamper-evident QR verification tokens.

---

## 2. Full-Stack System Architecture

```
+-------------------------------------------------------------------------------+
|                             FIELD OFFICER PWA CLIENT                           |
|                                                                               |
|  [Hardware Optical Scanner / Barcode Modal]                                    |
|      │                                                                        |
|  [Online / Offline Heartbeat Detector]                                         |
|      │                                                                        |
|      ▼ (When Offline)                                                         |
|  [IndexedDB Local Store]                                                      |
|   ├── Assigned Applications Cache                                             |
|   ├── Statutory Calibration Rules (LM-RULE-2026.1)                            |
|   ├── Active Draft Auto-Save (Crash & Closure Protection)                     |
|   └── Offline Sync Queue (clientOperationId: OP-XXXXX, status: PENDING)       |
+--------------------------------------┬----------------------------------------+
                                       │
                                       │ (Connectivity Restored: Auto / Manual Sync)
                                       ▼
+-------------------------------------------------------------------------------+
|                       BACKEND SERVER & VERIFICATION ENGINE                    |
|                                                                               |
|  [Security Middlewares: Rate Limiter, Security Headers, CORS, Error Masker]   |
|      │                                                                        |
|  [POST /api/v1/verifications/sync]                                            |
|      │                                                                        |
|      ├── 1. Deduplication Guard: Checks if clientOperationId already exists   |
|      │      └── If exists: Returns SYNCED_EXISTING (No duplicate certs)       |
|      │                                                                        |
|      ├── 2. Conflict Detector: Checks application status & rule version       |
|      │      └── If conflict: Returns HTTP 409 CONFLICT without data loss      |
|      │                                                                        |
|      ├── 3. Authoritative Calculation: Decimal boundary evaluation vs MPE     |
|      │                                                                        |
|      └── 4. State Commit: Issues Certificate, QR Token & Audit Log           |
+--------------------------------------┬----------------------------------------+
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
+---------------------------------------+ +-------------------------------------+
|         PRISMA OPTIMIZED DATABASE     | |  STATE REPOSITORY FEDERATION GATEWAY|
|                                       | |                                     |
|  • Instrument (serialNumber, ownerId) | |  • Central Node (NDMC Central)      |
|  • VerificationApp (applicantId)      | |  • State Nodes (DL, MH, KA, TN)     |
|  • Certificate (certNumber, qrToken)  | |  • Immutable FederationLog Trail    |
|  • AuditLog (actorId, action, time)   | |  • Standardized JSON Contracts      |
+---------------------------------------+ +-------------------------------------+
```

---

## 3. Seed Accounts & Roles (SIH 2026 Demo Mode)

| Role | Email | Password | Primary Demonstrations |
| :--- | :--- | :--- | :--- |
| **Instrument Owner** | `techcorp@example.com` | `owner123` | Industrial & commercial instrument inventory, barcode scan search, statutory expiry warnings, registration, certificate access. |
| **Shop / Retail Merchant** | `shop@example.com` | `shop123` | Retail grocery/kirana commercial counter scales (Class II/III), verification certificate review, pending renewal application. |
| **Legal Metrology Officer** | `v.sharma@emaanak.gov.in` | `officer123` | **Field PWA**: Offline bench, auto-saved drafts, hardware barcode verification, offline sync queue, certificate revocation. |
| **Metrology Officer 2** | `p.patel@emaanak.gov.in` | `officer123` | Secondary field officer for multi-jurisdiction testing. |
| **State Administrator** | `admin@emaanak.gov.in` | `admin123` | Real-time analytics, federation gateway node monitoring, immutable audit trail. |

---

## 4. Hardware Scanner Abstraction

Field officers and instrument owners can utilize the integrated **Field Optical Barcode & QR Scanner**:
- **Camera Viewport Simulator**: Emulates mobile camera view with alignment crosshairs and optical recognition indicator.
- **Quick Sample Barcodes**: Click-to-scan buttons for real seeded instruments (`SN-TC-99882211`, `SN-TC-77665544`, `SN-AG-44332211`, `SN-ML-11223344`).
- **Manual Barcode Input**: Allows officers with external handheld laser scanners or manual entry to input serial codes.
- **Real-Time Verification**: On the physical inspection bench, scanning the barcode instantly performs a comparison against the application metadata, displaying an authoritative **`MATCH ✓`** or **`MISMATCH ✗`** badge.

---

## 5. Security & Production Hardening Checklist

- [x] **Sliding-Window Rate Limiting**: Prevents brute-force attacks on authentication endpoints (30 req/min) and general API routes (200 req/min) with `X-RateLimit-*` and `Retry-After` headers.
- [x] **Strict Security Headers**: Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection: 1; mode=block`, and `Strict-Transport-Security`.
- [x] **Production Error Sanitizer**: Masks internal database structures, stack traces, and filesystem paths behind unique correlation IDs (`ERR-XXXXXX`).
- [x] **CORS Whitelist**: Configured via `ALLOWED_ORIGINS` to allow only trusted frontend hostnames.
- [x] **Database Indexing**: High-performance indexes on `Instrument`, `VerificationApplication`, `VerificationInspection`, `Certificate`, `Notification`, and `AuditLog` ensure sub-millisecond query execution.
- [x] **Zero Hardcoded URLs**: Dynamically driven by environment variables (`VITE_API_URL`, `DATABASE_URL`, `PUBLIC_VERIFY_BASE_URL`).
- [x] **Graceful Process Shutdown**: Traps `SIGTERM` and `SIGINT` signals to safely close HTTP servers and disconnect Prisma clients without transaction corruption.

---

## 6. How to Run the System Locally

### Terminal 1: Backend Server
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npx ts-node prisma/seed.ts
npx ts-node index.ts
```
*Backend runs at `http://localhost:5000` with APIs at `/api/v1` and Swagger UI at `/api/docs`.*

### Terminal 2: Frontend PWA Application
```bash
cd frontend
npm install
npm run dev
```
*Frontend runs at `http://localhost:5173`.*

---

## 7. Production PostgreSQL / Supabase Deployment Guide

To deploy with production PostgreSQL (e.g. Supabase, AWS RDS, GCP Cloud SQL):

1. **Configure Environment Variables**:
   In `backend/.env`:
   ```env
   PORT=5000
   NODE_ENV=production
   DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/[DB]?sslmode=require"
   JWT_SECRET="sovereign-production-jwt-secret-key-replace-in-prod"
   ALLOWED_ORIGINS="https://your-frontend-domain.com"
   PUBLIC_VERIFY_BASE_URL="https://your-frontend-domain.com"
   ```

2. **Update Prisma Schema Provider**:
   In `backend/prisma/schema.prisma`, update datasource:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

3. **Run Production Migrations & Seed**:
   ```bash
   npx prisma migrate deploy
   npx ts-node prisma/seed.ts
   ```

4. **Build Frontend for Production**:
   In `frontend/.env`:
   ```env
   VITE_API_URL="https://your-backend-domain.com/api/v1"
   ```
   Run build:
   ```bash
   cd frontend
   npm run build
   # Serve dist/ with Nginx, Cloudflare Pages, Vercel, or AWS S3+CloudFront
   ```

---

## 8. Automated Test Suites (67+ Passing Assertions)

Run the automated verification suites from the `backend/` directory:

```bash
cd backend

# Phase 6: Production Readiness, Security Headers, Rate Limiting & Indexes (28 tests)
npx ts-node test-phase6-production-readiness.ts

# Phase 5: Offline PWA Sync, Idempotency & State Federation (18 tests)
npx ts-node test-phase5-sync-federation.ts

# Phase 4: Verification Engine Precision, Tolerances & Role Authorization (21 tests)
npx ts-node test-suite.ts

# Complete End-to-End Workflow Demonstration (10 live steps)
npx ts-node e2e-workflow.test.ts
```

---

## 9. 3-Minute SIH 2026 Demonstration Script

1. **Step 1: Instrument Owner Portal (<45 seconds)**
   - Log in as `techcorp@example.com` (`owner123`).
   - View registered weighing instruments and statutory 30-day expiration notice.
   - Click **Scan Barcode** next to search to simulate an optical nameplate scan.
   - Register a new instrument and click **Scan Barcode** to populate the Serial Number automatically.

2. **Step 2: Field Inspector PWA & Offline Verification (<60 seconds)**
   - Log in as `v.sharma@emaanak.gov.in` (`officer123`).
   - Click **Pre-Cache for Offline Field** to download assignments to IndexedDB.
   - Toggle DevTools Network to **Offline** (notice amber **Offline (Field Mode)** beacon).
   - Enter physical readings into the multi-point test bench.
   - Click **Verify** next to Serial Number to test optical nameplate matching (`MATCH ✓`).
   - Click **Queue for Offline Sync**. Notice the auto-saved draft and persistent queue.

3. **Step 3: Instant Sync & Authoritative Certificate Issuance (<30 seconds)**
   - Set DevTools Network back to **Online**.
   - Click **Sync Queue**. The server validates decimal tolerances and stamps certificate `CERT-2026-XXXX`.
   - Show idempotency: clicking sync again returns `SYNCED_EXISTING` without duplicate certificates.

4. **Step 4: Public QR Verification & Certificate Revocation (<30 seconds)**
   - Scan or open `/verify/<qrToken>` as an unauthenticated consumer: displays sovereign green **[VALID]** badge.
   - In Officer Dashboard, click **Revoke** with audit grounds ("Broken lead seal detected").
   - Refresh the public QR view: instantly reflects sovereign red **[REVOKED]** status.

5. **Step 5: State Federation & Audit Oversight (<15 seconds)**
   - Log in as `admin@emaanak.gov.in` (`admin123`).
   - Open **National Federation Gateway** to view active telemetry nodes (NDMC Central, Delhi, Maharashtra).
   - Review immutable **Audit Trail** capturing every registration, sync, calculation, and revocation.

---

## 10. Statutory & Prototype Disclaimer
*This platform is developed exclusively as a functional prototype for Smart India Hackathon 2026 (SIH26036). Generated certificates, seals, cryptographic tokens, and federation logs are simulated demonstrations of legal metrology verification technology and do not represent statutory government documents unless deployed within official state legal metrology departmental infrastructure.*
