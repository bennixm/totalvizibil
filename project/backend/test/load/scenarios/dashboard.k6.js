/**
 * Authenticated dashboard — session validation + multi-table query under load.
 *
 * setUp() logs in as the seed user and extracts the session cookie.
 * All VUs share that cookie (read-only dashboard — no race condition risk).
 *
 * Run: k6 run test/load/scenarios/dashboard.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    dashboard: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<400'],
    http_req_failed:   ['rate<0.01'],
  },
};

const BASE = 'http://localhost:3099/api/v1';

export function setup() {
  // Log in as the seed user
  const loginRes = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: 'load@test.com', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(loginRes, { 'setup login 200': (r) => r.status === 200 });

  const cookieHeader = loginRes.headers['Set-Cookie'];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

  // Fetch the company list to get the first company ID
  const companiesRes = http.get(`${BASE}/companies`, {
    headers: { Cookie: cookie },
  });

  check(companiesRes, { 'companies 200': (r) => r.status === 200 });

  const companies = JSON.parse(companiesRes.body);
  const companyId = Array.isArray(companies)
    ? companies[0]?.id
    : companies?.items?.[0]?.id;

  return { cookie, companyId };
}

export default function (data) {
  const { cookie, companyId } = data;

  if (!companyId) {
    console.error('No company ID from setup — seed may not have run');
    return;
  }

  const res = http.get(`${BASE}/companies/${companyId}/dashboard`, {
    headers: { Cookie: cookie },
  });

  check(res, { 'dashboard 200': (r) => r.status === 200 });

  sleep(1);
}
