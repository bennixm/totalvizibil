/**
 * Lead form submission — core revenue event.
 * Tests DB write throughput under sustained concurrency.
 *
 * Throttle note: PublicLeadController allows 15 req/min per IP.
 * At 10 VUs × 1 req/6s = ~100 req/min across the pool. k6 uses a single IP
 * so we sleep 6s between iterations to stay well under the 15 req/min limit.
 *
 * Run: k6 run test/load/scenarios/lead-submit.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    lead_submit: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed:   ['rate<0.01'],
  },
};

const BASE = 'http://localhost:3099/api/v1';

// 20 companies seeded by test/load/seed.ts
const SLUGS = Array.from({ length: 20 }, (_, i) => `load-company-${i + 1}`);

export default function () {
  const slug = SLUGS[__VU % SLUGS.length];

  const payload = JSON.stringify({
    channel: 'form',
    name: `Load Tester ${__VU}`,
    email: `load${__VU}@example.com`,
    message: 'Load test lead submission',
  });

  const res = http.post(
    `${BASE}/public/companies/${slug}/lead`,
    payload,
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(res, { 'lead 202': (r) => r.status === 202 });

  // Stay under 15 req/min throttle (6s per VU = safe headroom)
  sleep(6);
}
