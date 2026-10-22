// Load test for the website: homepage at / and the Voice Pitch Trainer at /voice/.
// Each real visitor costs the server one or two page loads; everything after that runs in their browser.
// Run:  k6 run -e BASE_URL=https://example.com deploy/loadtest/k6.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");

export const options = {
  scenarios: {
    visitors: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 1000,
      stages: [
        { duration: "1m", target: 50 },    // warm up
        { duration: "3m", target: 300 },   // ramp: watch the HPAs add pods
        { duration: "3m", target: 300 },   // hold
        { duration: "1m", target: 0 }      // cool down: watch them scale back
      ]
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{page:home}": ["p(95)<300"],
    "http_req_duration{page:trainer}": ["p(95)<300"]
  }
};

const gz = { "Accept-Encoding": "gzip" };

export default function () {
  // A typical visit: land on the homepage, then open the trainer
  const home = http.get(`${BASE_URL}/`, { headers: gz, tags: { page: "home" } });
  check(home, {
    "home 200": r => r.status === 200,
    "home links to trainer": r => r.body && r.body.includes('href="/voice/"')
  });
  sleep(0.5);

  const trainer = http.get(`${BASE_URL}/voice/`, { headers: gz, tags: { page: "trainer" } });
  check(trainer, {
    "trainer 200": r => r.status === 200,
    "is the trainer page": r => r.body && r.body.includes("Voice Pitch Trainer"),
    "mic allowed on /voice/": r => (r.headers["Permissions-Policy"] || "").includes("microphone=(self)")
  });
  sleep(1);
}
