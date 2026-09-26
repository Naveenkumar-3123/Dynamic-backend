import http from 'http';
import app from '../src/app';
import { initDatabase } from '../src/db/pool';

let server: http.Server;
const PORT = 3001;
const BASE = `http://localhost:${PORT}`;

function makeRequest(
  method: string,
  urlPath: string,
  body?: any,
  followRedirect: boolean = false,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(extraHeaders || {}),
      },
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('--- Starting DecodeNow Dynamic QR Backend Test Suite ---');
  await initDatabase();

  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}`);

  try {
    // 1. Health check
    console.log('\n[1/11] Testing GET /api/health ...');
    const health = await makeRequest('GET', '/api/health');
    console.log('Health response:', health.body);
    if (health.status !== 200 || !health.body.success) {
      throw new Error(`Health check failed: ${JSON.stringify(health.body)}`);
    }
    console.log('✓ Health check passed');

    // 2 & 3. Create Dynamic QR & Receive short code
    console.log('\n[2/11 & 3/11] Testing POST /api/qr with destination https://example.com ...');
    const createRes = await makeRequest('POST', '/api/qr', {
      destinationUrl: 'https://example.com',
    });
    console.log('Create response:', createRes.body);
    if (createRes.status !== 201 || !createRes.body.success) {
      throw new Error(`Create QR failed: ${JSON.stringify(createRes.body)}`);
    }

    const { shortCode, dynamicUrl, destinationUrl, secretKey } = createRes.body.data;
    if (!shortCode || !dynamicUrl || destinationUrl !== 'https://example.com' || !secretKey) {
      throw new Error('Create QR returned invalid data structure or missing secretKey');
    }
    console.log(`✓ Created Dynamic QR: shortCode=${shortCode}, dynamicUrl=${dynamicUrl}`);

    // 4 & 5. Open /q/:shortCode and confirm redirect
    console.log(`\n[4/11 & 5/11] Testing GET /q/${shortCode} redirect ...`);
    const redirectRes = await makeRequest('GET', `/q/${shortCode}`);
    console.log(`Redirect status: ${redirectRes.status}, Location: ${redirectRes.headers.location}`);
    if (redirectRes.status !== 302 || redirectRes.headers.location !== 'https://example.com') {
      throw new Error(`Redirect failed! Expected 302 to https://example.com, got ${redirectRes.status} to ${redirectRes.headers.location}`);
    }
    console.log('✓ Redirect 302 to https://example.com confirmed');

    // Wait 100ms for async counter increment
    await delay(100);

    // 6. Confirm scan count
    console.log(`\n[6/11] Checking scan count for ${shortCode} ...`);
    const getRes = await makeRequest('GET', `/api/qr/${shortCode}`);
    console.log('Get details response:', getRes.body);
    if (getRes.status !== 200 || getRes.body.data.scanCount !== 1) {
      throw new Error(`Scan count check failed! Expected 1, got ${getRes.body.data?.scanCount}`);
    }
    console.log(`✓ Scan count increment verified: ${getRes.body.data.scanCount}`);

    // 6b. Verify unauthorized update without secret key is rejected
    console.log(`\n[6b] Verifying unauthorized update attempt without secret key is rejected ...`);
    const unauthorizedRes = await makeRequest('PUT', `/api/qr/${shortCode}`, {
      destinationUrl: 'https://hacked.com',
    });
    if (unauthorizedRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for unauthorized update, got ${unauthorizedRes.status}`);
    }
    console.log('✓ Unauthorized modification rejected with HTTP 403');

    // 7. Update destination
    console.log(`\n[7/11] Updating destination to https://newwebsite.com with X-Secret-Key ...`);
    const updateRes = await makeRequest(
      'PUT',
      `/api/qr/${shortCode}`,
      { destinationUrl: 'https://newwebsite.com' },
      false,
      { 'X-Secret-Key': secretKey }
    );
    console.log('Update response:', updateRes.body);
    if (updateRes.status !== 200 || updateRes.body.data.destinationUrl !== 'https://newwebsite.com') {
      throw new Error(`Update destination failed: ${JSON.stringify(updateRes.body)}`);
    }
    if (updateRes.body.data.shortCode !== shortCode) {
      throw new Error(`CRITICAL: Short code changed after update! Was ${shortCode}, now ${updateRes.body.data.shortCode}`);
    }
    console.log('✓ Destination updated while preserving short code');

    // 8 & 9. Open same /q/:shortCode and confirm redirect to new destination
    console.log(`\n[8/11 & 9/11] Testing GET /q/${shortCode} after update ...`);
    const redirectRes2 = await makeRequest('GET', `/q/${shortCode}`);
    console.log(`Redirect status: ${redirectRes2.status}, Location: ${redirectRes2.headers.location}`);
    if (redirectRes2.status !== 302 || redirectRes2.headers.location !== 'https://newwebsite.com') {
      throw new Error(`Redirect after update failed! Expected https://newwebsite.com, got ${redirectRes2.headers.location}`);
    }
    console.log('✓ Redirect 302 to updated destination (https://newwebsite.com) confirmed');

    // 10 & 11. Disable the QR and confirm it no longer redirects
    console.log(`\n[10/11 & 11/11] Testing DELETE /api/qr/${shortCode} with X-Secret-Key and checking disabled redirect ...`);
    const deleteRes = await makeRequest(
      'DELETE',
      `/api/qr/${shortCode}`,
      undefined,
      false,
      { 'X-Secret-Key': secretKey }
    );
    console.log('Disable response:', deleteRes.body);
    if (deleteRes.status !== 200 || deleteRes.body.data.isActive !== false) {
      throw new Error(`Disable QR failed: ${JSON.stringify(deleteRes.body)}`);
    }

    const disabledRedirect = await makeRequest('GET', `/q/${shortCode}`);
    console.log(`Disabled redirect status: ${disabledRedirect.status}`);
    if (disabledRedirect.status !== 410) {
      throw new Error(`Expected HTTP 410 for disabled QR, got ${disabledRedirect.status}`);
    }
    console.log('✓ Disabled QR properly returns HTTP 410 and blocks redirection');

    console.log('\n======================================================');
    console.log(' ALL 11 PHASE 2 BACKEND TEST REQUIREMENTS PASSED! ');
    console.log('======================================================\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  if (server) server.close();
  process.exit(1);
});
