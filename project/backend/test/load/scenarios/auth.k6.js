/**
 * Auth flow — register + login.
 * Tests argon2id hashing throughput under concurrent load.
 *
 * Throttle note: /auth/register is limited to 10 req/min per IP.
 * 5 VUs × 1 req/30s = 10 req/min — right at the limit.
 * ThrottlerGuard is active (not bypassed) in load env.
 *
 * Run: k6 run test/load/scenarios/auth.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    auth_flow: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
    },
  },
  thresholds: {
    'http_req_duration{name:register}': ['p(95)<1000'],
    'http_req_duration{name:login}':    ['p(95)<500'],
    http_req_failed:                    ['rate<0.02'],
  },
};

const BASE = 'http://localhost:3099/api/v1';

export default function () {
  // Unique email per iteration to avoid conflicts
  const id = `${__VU}-${__ITER}`;
  const email = `loadtest-${id}@example.com`;
  const password = 'LoadTest1!';

  const regRes = http.post(
    `${BASE}/auth/register`,
    JSON.stringify({ email, password, name: `Load User ${id}` }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'register' } },
  );
  check(regRes, { 'register 201': (r) => r.status === 201 });

  if (regRes.status !== 201) {
    sleep(30);
    return;
  }

  const loginRes = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  check(loginRes, { 'login 200': (r) => r.status === 200 });

  // 30s between register calls — 5 VUs × 1/30s = 10 req/min, at throttle limit
  sleep(30);
}
