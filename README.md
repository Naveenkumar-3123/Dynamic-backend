# DecodeNow – Dynamic QR Code Backend

High-performance, lightweight Node.js/TypeScript REST API and redirection engine for **DecodeNow – QR Generator & Editor**.

---

## 1. Overview & Dynamic QR Concept

DecodeNow originally generates static QR codes where the content (e.g., a website URL) is encoded directly into the QR image matrix. Once printed or shared, a static QR code cannot be changed.

**Dynamic QR** solves this by inserting a redirection layer:

```text
User Destination URL (e.g. https://example.com)
       ↓
Backend generates secure short code (e.g. A7K92P)
       ↓
Dynamic URL (https://YOUR-DOMAIN.vercel.app/q/A7K92P)
       ↓
Encoded into QR Image
```

When someone scans the QR code:

```text
Scan Dynamic QR
       ↓
Hits GET /q/A7K92P
       ↓
PostgreSQL lookup
       ↓
Validates is_active = true
       ↓
Increments scan_count (non-blocking)
       ↓
HTTP 302 Redirect to https://example.com
```

If the destination URL is updated later (e.g. to `https://newwebsite.com`), the short code and the QR image **never change**.

---

## 2. Architecture

```text
                 +-----------------------------------------+
                 |       DecodeNow Android Application     |
                 +-----------------------------------------+
                                      |
                                      | HTTPS REST API (JSON)
                                      v
                 +-----------------------------------------+
                 |       Vercel Serverless / Express       |
                 +-----------------------------------------+
                                      |
                                      | Parameterized Queries
                                      v
                 +-----------------------------------------+
                 |          Supabase PostgreSQL            |
                 |             (dynamic_qrs)               |
                 +-----------------------------------------+
                                      |
                                      | HTTP 302 Redirect
                                      v
                 +-----------------------------------------+
                 |         Destination Webpage             |
                 +-----------------------------------------+
```

---

## 3. Technology Stack

* **Runtime**: Node.js (v18+)
* **Language**: TypeScript
* **Framework**: Express.js
* **Database**: PostgreSQL (Supabase PostgreSQL / `pg`)
* **Deployment Target**: Vercel Serverless Functions
* **Middleware**: CORS, dotenv, custom error handler

---

## 4. Database Schema

Execute the following SQL in your **Supabase SQL Editor** or PostgreSQL console:

```sql
CREATE TABLE IF NOT EXISTS dynamic_qrs (
    id UUID PRIMARY KEY,
    short_code VARCHAR(20) UNIQUE NOT NULL,
    destination_url TEXT NOT NULL,
    scan_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamic_qrs_short_code
ON dynamic_qrs(short_code);
```

---

## 5. API Endpoints

### 1. Health Check
* **Method**: `GET`
* **Path**: `/api/health`
* **Response**:
```json
{
  "success": true,
  "service": "DecodeNow Dynamic QR API",
  "status": "online",
  "timestamp": "2026-09-26T10:00:00.000Z",
  "database": {
    "status": "healthy",
    "engine": "postgresql"
  }
}
```

---

### 2. Create Dynamic QR
* **Method**: `POST`
* **Path**: `/api/qr`
* **Headers**: `Content-Type: application/json`
* **Request Body**:
```json
{
  "destinationUrl": "https://example.com"
}
```
* **Response** (`201 Created`):
```json
{
  "success": true,
  "data": {
    "id": "e843c94f-f332-4be1-be99-0125d3fa9635",
    "shortCode": "A7K92P",
    "destinationUrl": "https://example.com",
    "dynamicUrl": "https://YOUR-VERCEL-DOMAIN.vercel.app/q/A7K92P"
  }
}
```

---

### 3. Get Dynamic QR Details
* **Method**: `GET`
* **Path**: `/api/qr/:shortCode`
* **Response** (`200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "e843c94f-f332-4be1-be99-0125d3fa9635",
    "shortCode": "A7K92P",
    "destinationUrl": "https://example.com",
    "scanCount": 14,
    "isActive": true,
    "createdAt": "2026-09-26T10:00:00.000Z",
    "updatedAt": "2026-09-26T10:00:00.000Z",
    "dynamicUrl": "https://YOUR-VERCEL-DOMAIN.vercel.app/q/A7K92P"
  }
}
```

---

### 4. Update Destination URL
* **Method**: `PUT`
* **Path**: `/api/qr/:shortCode`
* **Headers**: `Content-Type: application/json`
* **Request Body**:
```json
{
  "destinationUrl": "https://newwebsite.com"
}
```
* **Response** (`200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "e843c94f-f332-4be1-be99-0125d3fa9635",
    "shortCode": "A7K92P",
    "destinationUrl": "https://newwebsite.com",
    "scanCount": 14,
    "isActive": true,
    "createdAt": "2026-09-26T10:00:00.000Z",
    "updatedAt": "2026-09-26T10:15:00.000Z",
    "dynamicUrl": "https://YOUR-VERCEL-DOMAIN.vercel.app/q/A7K92P"
  }
}
```

---

### 5. Disable Dynamic QR
* **Method**: `DELETE`
* **Path**: `/api/qr/:shortCode`
* **Response** (`200 OK`):
```json
{
  "success": true,
  "message": "Dynamic QR code disabled successfully.",
  "data": {
    "id": "e843c94f-f332-4be1-be99-0125d3fa9635",
    "shortCode": "A7K92P",
    "destinationUrl": "https://newwebsite.com",
    "scanCount": 14,
    "isActive": false,
    "createdAt": "2026-09-26T10:00:00.000Z",
    "updatedAt": "2026-09-26T10:20:00.000Z",
    "dynamicUrl": "https://YOUR-VERCEL-DOMAIN.vercel.app/q/A7K92P"
  }
}
```

---

### 6. Dynamic Redirect
* **Method**: `GET`
* **Path**: `/q/:shortCode`
* **Behavior**:
  * Status: `302 Found`
  * Header: `Location: <destination_url>`
  * Increments `scan_count` in database asynchronously (never blocks redirect)
  * Returns user-friendly 404 page if code does not exist
  * Returns user-friendly 410 page if QR is disabled

---

## 6. Environment Variables

Create `.env` in the `backend/` directory:

```env
# PostgreSQL connection URL (e.g. from Supabase Settings -> Database -> Connection String -> URI)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# Base public domain used when returning dynamic URLs
# Local:
BASE_URL=http://localhost:3000
# Production:
# BASE_URL=https://your-decodenow-backend.vercel.app

PORT=3000
NODE_ENV=development
```

---

## 7. Local Setup & Testing

1. Navigate to backend:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Build TypeScript:
```bash
npm run build
```

4. Run development server:
```bash
npm run dev
```

5. Run automated local test suite:
```bash
npm run test
```

---

## 8. Supabase Setup Guide

1. Log in to [Supabase](https://supabase.com).
2. Create a new project (e.g. `decodenow-db`).
3. Open **SQL Editor**, paste the SQL from `src/db/schema.sql`, and click **Run**.
4. Go to **Project Settings** -> **Database**.
5. Copy the **URI Connection string** (under Connection Pooling or Direct Connection).
6. Set `DATABASE_URL` in your `.env` or Vercel Environment Variables.

---

## 9. Vercel Deployment

1. Install Vercel CLI or connect your GitHub repository in the Vercel dashboard.
2. In Vercel Project Settings:
   * **Root Directory**: `backend`
   * **Framework Preset**: Other
3. Add Environment Variables in Vercel:
   * `DATABASE_URL`: `postgresql://postgres:...`
   * `BASE_URL`: `https://YOUR-PROJECT.vercel.app`
   * `NODE_ENV`: `production`
4. Deploy!

---

## 10. Android Integration Notes (For Phase 5)

* Android app communicates strictly via HTTPS REST API (`POST /api/qr`, `PUT /api/qr/:code`, etc.).
* Database credentials are **never** bundled in the Android APK.
* Android generates QR image encoding the returned `dynamicUrl` (`https://YOUR-DOMAIN.vercel.app/q/A7K92P`), **not** the `destinationUrl`.
