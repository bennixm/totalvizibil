/**
 * Feed browsing — the heaviest endpoint.
 * Every anonymous visitor hits this. Tests scoring query + DB read under load.
 *
 * Run: k6 run test/load/scenarios/feed.k6.js
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
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed:   ['rate<0.01'],
  },
};

const BASE = 'http://localhost:3099/api/v1';
const CATEGORIES = ['curatenie', 'instalatii', 'constructii', 'gradinarit', 'transport'];

export default function () {
  const cat = CATEGORIES[__VU % CATEGORIES.length];
  const page = (__ITER % 3) + 1;

  const res = http.get(`${BASE}/feed?category=${cat}&page=${page}&pageSize=12`);
  check(res, {
    'feed 200':               (r) => r.status === 200,
    'feed has items array':   (r) => Array.isArray(JSON.parse(r.body).items),
  });

  sleep(1);
}
