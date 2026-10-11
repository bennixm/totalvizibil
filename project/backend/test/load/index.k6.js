/**
 * k6 entry point — runs all 4 scenarios concurrently.
 *
 * Each scenario has its own VU pool and thresholds.
 * They run in parallel (k6 default) against the same server.
 *
 * Run all:          k6 run test/load/index.k6.js
 * Run one scenario: k6 run test/load/scenarios/feed.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    feed_browse: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m',  target: 20 },
        { duration: '10s', target: 0 },
      ],
      exec: 'feedScenario',
    },
    lead_submit: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'leadScenario',
    },
    dashboard: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'dashboardScenario',
    },
  },
  thresholds: {
    'http_req_duration{scenario:feed_browse}':  ['p(95)<500'],
    'http_req_duration{scenario:lead_submit}':  ['p(95)<300'],
    'http_req_duration{scenario:dashboard}':    ['p(95)<400'],
    http_req_failed:                            ['rate<0.01'],
  },
};

const BASE = 'http://localhost:3099/api/v1';
const CATEGORIES = ['curatenie', 'instalatii', 'constructii', 'gradinarit', 'transport'];
const SLUGS = Array.from({ length: 20 }, (_, i) => `load-company-${i + 1}`);

// Shared cookie — populated in setup(), used by dashboardScenario
let sharedCookie = '';
let sharedCompanyId = '';

export function setup() {
  const loginRes = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: 'load@test.com', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(loginRes, { 'setup login 200': (r) => r.status === 200 });

  const cookieHeader = loginRes.headers['Set-Cookie'];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

  const companiesRes = http.get(`${BASE}/companies`, { headers: { Cookie: cookie } });
  const companies = JSON.parse(companiesRes.body);
  const companyId = Array.isArray(companies)
    ? companies[0]?.id
    : companies?.items?.[0]?.id;

  return { cookie, companyId };
}

export function feedScenario() {
  const cat = CATEGORIES[__VU % CATEGORIES.length];
  const res = http.get(`${BASE}/feed?category=${cat}&page=1&pageSize=12`);
  check(res, { 'feed 200': (r) => r.status === 200 });
  sleep(1);
}

export function leadScenario() {
  const slug = SLUGS[__VU % SLUGS.length];
  const res = http.post(
    `${BASE}/public/companies/${slug}/lead`,
    JSON.stringify({
      channel: 'form',
      name: `Load Tester ${__VU}`,
      email: `load${__VU}@example.com`,
      message: 'Load test lead',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'lead 202': (r) => r.status === 202 });
  sleep(6);
}

export function dashboardScenario(data) {
  if (!data?.companyId) return;
  const res = http.get(`${BASE}/companies/${data.companyId}/dashboard`, {
    headers: { Cookie: data.cookie },
  });
  check(res, { 'dashboard 200': (r) => r.status === 200 });
  sleep(1);
}
