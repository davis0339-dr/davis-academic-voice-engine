import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  securityHeaders,
  enforceSameOrigin,
  createRateLimiter,
  validateApiPayload,
} from "../server/lib/security.js";

function mockReq(overrides = {}) {
  const headers = Object.fromEntries(Object.entries(overrides.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: "GET",
    path: "/health",
    originalUrl: "/api/health",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    secure: false,
    body: undefined,
    get(name) { return headers[String(name).toLowerCase()]; },
    ...overrides,
    headers,
  };
}

function mockRes() {
  const emitter = new EventEmitter();
  const headers = new Map();
  return Object.assign(emitter, {
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.emit("finish"); return this; },
  });
}

test("security headers include CSP, frame denial, request id and no-store for API responses", () => {
  const req = mockReq({ path: "/api/rewrite", originalUrl: "/api/rewrite", headers: { "x-forwarded-proto": "https" } });
  const res = mockRes();
  let nextCalled = false;
  securityHeaders(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.match(res.getHeader("content-security-policy"), /default-src 'self'/);
  assert.match(res.getHeader("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(res.getHeader("x-frame-options"), "DENY");
  assert.equal(res.getHeader("cache-control"), "no-store, max-age=0");
  assert.match(res.getHeader("strict-transport-security"), /max-age=31536000/);
  assert.ok(res.getHeader("x-request-id"));
});

test("same-origin middleware rejects a cross-site POST but permits a same-origin POST", () => {
  const badReq = mockReq({ method: "POST", headers: { origin: "https://evil.example", host: "voice.example" }, originalUrl: "/api/rewrite" });
  const badRes = mockRes();
  enforceSameOrigin(badReq, badRes, () => assert.fail("cross-site request must not pass"));
  assert.equal(badRes.statusCode, 403);
  assert.equal(badRes.body.error, "ORIGIN_REJECTED");

  const goodReq = mockReq({ method: "POST", headers: { origin: "https://voice.example", host: "voice.example" }, originalUrl: "/api/rewrite" });
  const goodRes = mockRes();
  let nextCalled = false;
  enforceSameOrigin(goodReq, goodRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("rate limiter blocks requests beyond its configured window allowance", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, name: `test-${Date.now()}` });
  const req = mockReq({ path: "/rewrite", originalUrl: "/api/rewrite", ip: "10.0.0.1" });
  const first = mockRes();
  let firstNext = false;
  limiter(req, first, () => { firstNext = true; });
  assert.equal(firstNext, true);

  const second = mockRes();
  limiter(req, second, () => assert.fail("second request must be rate-limited"));
  assert.equal(second.statusCode, 429);
  assert.equal(second.body.error, "RATE_LIMITED");
  assert.ok(Number(second.getHeader("retry-after")) >= 1);
});

test("payload validator rejects prototype-like filter keys and malformed option types", () => {
  const req = mockReq({
    method: "POST",
    path: "/rewrite",
    body: { text: "Academic text.", styleFilters: { constructor: "bad" }, rewriteIntensity: "auto" },
  });
  const res = mockRes();
  validateApiPayload(req, res, () => assert.fail("malformed payload must not pass"));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "BAD_REQUEST");
});

test("detector research payload accepts bounded observations and manuscript strings", () => {
  const req = mockReq({
    method: "POST",
    path: "/detector-research",
    body: {
      sourceText: "Human source text.",
      candidateText: "Candidate revision text.",
      observations: [{ detector: "GPTZero", classification: "ai", aiScore: 87, flaggedSentenceIndices: [0] }],
    },
  });
  const res = mockRes();
  let nextCalled = false;
  validateApiPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("detector research payload rejects oversized or malformed observation records", () => {
  const req = mockReq({
    method: "POST",
    path: "/detector-research",
    body: {
      candidateText: "Candidate revision text.",
      observations: [{ detector: "x".repeat(81), classification: "ai", aiScore: "not-a-number" }],
    },
  });
  const res = mockRes();
  validateApiPayload(req, res, () => assert.fail("malformed detector research payload must not pass"));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "BAD_REQUEST");
});

test("rewrite accepts bounded candidate-linked feedback and rejects stale-shaped identifiers", () => {
  const valid = mockReq({
    method: "POST",
    path: "/rewrite",
    body: {
      text: "Academic source.",
      detectorFeedback: {
        candidateId: "a".repeat(24),
        observations: [{ detector: "GPTZero", classification: "ai", aiScore: 100, flaggedExcerpts: ["Academic candidate sentence."] }],
      },
    },
  });
  const validRes = mockRes();
  let nextCalled = false;
  validateApiPayload(valid, validRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const invalid = mockReq({ method: "POST", path: "/rewrite", body: { text: "Academic source.", detectorFeedback: { candidateId: "stale", observations: [] } } });
  const invalidRes = mockRes();
  validateApiPayload(invalid, invalidRes, () => assert.fail("invalid feedback must not pass"));
  assert.equal(invalidRes.statusCode, 400);
});

test("rewrite accepts only explicit source or tested-candidate refinement modes", () => {
  const valid = mockReq({ method: "POST", path: "/rewrite", body: { text: "Candidate text.", refinementMode: "tested_candidate" } });
  const validRes = mockRes();
  let nextCalled = false;
  validateApiPayload(valid, validRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const invalid = mockReq({ method: "POST", path: "/rewrite", body: { text: "Candidate text.", refinementMode: "unbounded_retry" } });
  const invalidRes = mockRes();
  validateApiPayload(invalid, invalidRes, () => assert.fail("invalid refinement mode must not pass"));
  assert.equal(invalidRes.statusCode, 400);
});

test("payload validator does not require a JSON body for chunk retry routes", () => {
  const req = mockReq({ method: "POST", path: "/jobs/id/chunks/1/retry", body: undefined });
  const res = mockRes();
  let nextCalled = false;
  validateApiPayload(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
