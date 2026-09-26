-- DecodeNow Dynamic QR Table Definition
-- Compatible with Supabase PostgreSQL and standard PostgreSQL 12+

CREATE TABLE IF NOT EXISTS dynamic_qrs (
    id UUID PRIMARY KEY,
    short_code VARCHAR(20) UNIQUE NOT NULL,
    destination_url TEXT NOT NULL,
    scan_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup index for redirects & code verification
CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamic_qrs_short_code
ON dynamic_qrs(short_code);
