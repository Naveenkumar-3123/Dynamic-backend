import http from 'http';
import app from '../src/app';
import { initDatabase, query } from '../src/db/pool';

let server: http.Server;
const PORT = 3002;
const BASE = `http://localhost:${PORT}`;

function makeRequest(
  method: string,
  urlPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const payload = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;
    const reqHeaders: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSecuritySuite() {
  console.log('===============================================================');
  console.log('  DecodeNow Dynamic QR — Security & Vulnerability Hardening Test');
  console.log('===============================================================\n');

  await initDatabase();
  server = app.listen(PORT);

  try {
    // -------------------------------------------------------------
    // TEST 1: SQL Injection Protection
    // -------------------------------------------------------------
    console.log('[1/8] Testing SQL Injection attacks on destinationUrl and shortCode...');
    const sqliPayloads = [
      "https://example.com' OR '1'='1",
      "https://example.com'; DROP TABLE dynamic_qrs; --",
      "https://example.com' UNION SELECT * FROM dynamic_qrs --",
    ];

    for (const payload of sqliPayloads) {
      const res = await makeRequest('POST', '/api/qr', { destinationUrl: payload });
      // Either rejected as invalid URL (400) or safely escaped as a string literal (201)
      if (res.status !== 400 && res.status !== 201) {
        throw new Error(`Unexpected SQLi status ${res.status}`);
      }
    }

    // Verify table dynamic_qrs still exists and is not dropped
    const checkTable = await query("SELECT 1 FROM dynamic_qrs LIMIT 1");
    if (!checkTable) throw new Error("Database damaged by SQLi!");

    // Test SQLi on /api/qr/:shortCode
    const sqliCode = await makeRequest('GET', "/api/qr/A7' OR '1'='1");
    if (sqliCode.status !== 404 && sqliCode.status !== 400) {
      throw new Error(`SQLi on shortCode returned unexpected status: ${sqliCode.status}`);
    }
    console.log('✓ SQL Injection Protection: PASSED (parameterized queries intact, no injection succeeded)');

    // -------------------------------------------------------------
    // TEST 2: URL & SSRF Validation
    // -------------------------------------------------------------
    console.log('\n[2/8] Testing Dangerous Scheme & SSRF Target Rejection...');
    const maliciousUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://ftp.example.com/file',
      'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end',
      'http://localhost/admin',
      'http://127.0.0.1:8080/secret',
      'http://169.254.169.254/latest/meta-data/', // AWS metadata SSRF
      'http://0.0.0.0/debug',
      'http://192.168.1.1/router',
      'http://10.0.0.1/internal',
      'https://user:password@malicious-site.com',
    ];

    for (const url of maliciousUrls) {
      const res = await makeRequest('POST', '/api/qr', { destinationUrl: url });
      if (res.status !== 400 || res.body.success !== false) {
        throw new Error(`Malicious/SSRF URL was not blocked: ${url} (status: ${res.status})`);
      }
    }

    // Confirm legitimate URLs succeed
    const validRes = await makeRequest('POST', '/api/qr', { destinationUrl: 'https://example.com' });
    if (validRes.status !== 201 || !validRes.body.data.secretKey) {
      throw new Error('Legitimate URL failed to create');
    }
    const createdQr = validRes.body.data;
    console.log(`✓ URL Validation & SSRF Protection: PASSED (blocked 12 malicious schemes/private ranges, created QR: ${createdQr.shortCode})`);

    // -------------------------------------------------------------
    // TEST 3: Rate Limiting
    // -------------------------------------------------------------
    console.log('\n[3/8] Testing Endpoint Rate Limiting...');
    let hitRateLimit = false;
    // Attempt rapid creations past limit (window allows 30)
    for (let i = 0; i < 35; i++) {
      const res = await makeRequest('POST', '/api/qr', { destinationUrl: `https://example.com/page-${i}` });
      if (res.status === 429) {
        hitRateLimit = true;
        if (!res.headers['retry-after']) {
          throw new Error('Retry-After header missing on 429 response');
        }
        break;
      }
    }
    if (!hitRateLimit) {
      throw new Error('Rate limiter failed to trigger 429 after 30 rapid creation attempts');
    }
    console.log('✓ Rate Limiting: PASSED (429 Too Many Requests received with Retry-After header)');

    // -------------------------------------------------------------
    // TEST 4: Management Authorization (Secret Key)
    // -------------------------------------------------------------
    console.log('\n[4/8] Testing Ownership Authorization for Updates & Disabling...');
    
    // Attacker tries to update without secretKey
    const unauthorizedUpdate = await makeRequest('PUT', `/api/qr/${createdQr.shortCode}`, {
      destinationUrl: 'https://hacked-destination.com',
    });
    if (unauthorizedUpdate.status !== 403) {
      throw new Error(`Expected 403 Forbidden for unauthorized update, got ${unauthorizedUpdate.status}`);
    }

    // Attacker tries with invalid secretKey
    const wrongSecretUpdate = await makeRequest(
      'PUT',
      `/api/qr/${createdQr.shortCode}`,
      { destinationUrl: 'https://hacked-destination.com' },
      { 'X-Secret-Key': 'wrong-secret-key-12345' }
    );
    if (wrongSecretUpdate.status !== 403) {
      throw new Error(`Expected 403 Forbidden for wrong secret, got ${wrongSecretUpdate.status}`);
    }

    // Legitimate owner updates with correct secretKey
    const authorizedUpdate = await makeRequest(
      'PUT',
      `/api/qr/${createdQr.shortCode}`,
      { destinationUrl: 'https://safe-updated.com' },
      { 'X-Secret-Key': createdQr.secretKey }
    );
    if (authorizedUpdate.status !== 200 || authorizedUpdate.body.data.destinationUrl !== 'https://safe-updated.com') {
      throw new Error('Authorized update failed with valid secret key');
    }
    console.log('✓ Management Authorization: PASSED (403 for unauthorized clients, 200 with valid X-Secret-Key)');

    // -------------------------------------------------------------
    // TEST 5: Redirect Security
    // -------------------------------------------------------------
    console.log('\n[5/8] Testing Public Redirection Security...');
    const redirectRes = await makeRequest('GET', `/q/${createdQr.shortCode}`);
    if (redirectRes.status !== 302 || redirectRes.headers.location !== 'https://safe-updated.com') {
      throw new Error(`Redirect failed: expected 302 to https://safe-updated.com, got ${redirectRes.status} to ${redirectRes.headers.location}`);
    }

    // Unknown QR gives 404
    const unknownRedirect = await makeRequest('GET', '/q/NONEXISTENT999');
    if (unknownRedirect.status !== 404) {
      throw new Error(`Expected 404 for unknown shortCode, got ${unknownRedirect.status}`);
    }

    // Disable QR with secretKey
    const disableRes = await makeRequest(
      'DELETE',
      `/api/qr/${createdQr.shortCode}`,
      undefined,
      { 'X-Secret-Key': createdQr.secretKey }
    );
    if (disableRes.status !== 200 || disableRes.body.data.isActive !== false) {
      throw new Error(`Failed to disable QR with valid secretKey: ${JSON.stringify(disableRes.body)}`);
    }

    // Disabled QR gives 410 Gone and does not redirect
    const disabledRedirect = await makeRequest('GET', `/q/${createdQr.shortCode}`);
    if (disabledRedirect.status !== 410) {
      throw new Error(`Expected 410 Gone for disabled QR, got ${disabledRedirect.status}`);
    }
    console.log('✓ Redirect Security: PASSED (verified 302 active, 404 unknown, 410 disabled without open-redirect risk)');

    // -------------------------------------------------------------
    // TEST 6: Atomic Scan Counter Concurrency
    // -------------------------------------------------------------
    console.log('\n[6/8] Testing Concurrent Atomic Scan Counting...');
    // Create new active QR for concurrency test
    // Reset IP limit for test
    const concQrRes = await query(`
      INSERT INTO dynamic_qrs (id, short_code, destination_url, secret_key, scan_count, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 0, TRUE, NOW(), NOW())
      RETURNING *
    `, [crypto.randomUUID(), 'CONC01', 'https://example.com/concurrent', 'test-secret-123']);
    
    // Simulate 20 concurrent scan redirects
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(makeRequest('GET', '/q/CONC01'));
    }
    await Promise.all(promises);
    await delay(300); // Allow async DB updates to settle

    const concCheck = await query('SELECT scan_count FROM dynamic_qrs WHERE short_code = $1', ['CONC01']);
    console.log(`Concurrent 20 scans recorded: ${concCheck.rows[0].scan_count}`);
    if (concCheck.rows[0].scan_count !== 20) {
      throw new Error(`Scan concurrency lost updates! Expected 20, got ${concCheck.rows[0].scan_count}`);
    }
    console.log('✓ Atomic Scan Counter: PASSED (atomic UPDATE dynamic_qrs SET scan_count = scan_count + 1 preserved all 20 hits)');

    // -------------------------------------------------------------
    // TEST 7: Payload Size Limit (DOS Prevention)
    // -------------------------------------------------------------
    console.log('\n[7/8] Testing Request Payload Size Limits (32KB Max)...');
    const largeBody = JSON.stringify({
      destinationUrl: 'https://example.com/' + 'A'.repeat(40000),
    });
    const largeRes = await makeRequest('POST', '/api/qr', largeBody);
    if (largeRes.status !== 413) {
      throw new Error(`Expected 413 Payload Too Large, got ${largeRes.status}`);
    }
    console.log('✓ Payload Size Protection: PASSED (413 Payload Too Large returned for oversized requests)');

    // -------------------------------------------------------------
    // TEST 8: Progressive Local Load Testing (10, 50, 100, 250 requests)
    // -------------------------------------------------------------
    console.log('\n[8/8] Running Progressive Concurrency & Latency Load Test...');
    const levels = [10, 50, 100, 250];

    for (const level of levels) {
      const startTime = Date.now();
      const batch = [];
      for (let i = 0; i < level; i++) {
        batch.push(makeRequest('GET', '/api/health'));
      }
      const results = await Promise.all(batch);
      const duration = Date.now() - startTime;
      const successes = results.filter((r) => r.status === 200).length;
      const avgLatency = (duration / level).toFixed(2);

      console.log(`  -> Concurrency ${level} requests: Completed in ${duration}ms (Avg ${avgLatency}ms/req, Success: ${successes}/${level})`);
      if (successes !== level) {
        throw new Error(`Load test failure at concurrency ${level}`);
      }
    }
    console.log('✓ Progressive Load Testing: PASSED (zero failed requests up to 250 concurrent requests)');

    console.log('\n===============================================================');
    console.log('🎉 ALL SECURITY & RELIABILITY HARDENING TESTS PASSED!');
    console.log('===============================================================\n');
  } finally {
    server.close();
  }
}

runSecuritySuite().catch((err) => {
  console.error('\n❌ Security test failed:', err);
  if (server) server.close();
  process.exit(1);
});
