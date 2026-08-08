import { randomUUID } from "node:crypto";

const buckets = new Map();
let activeExpensiveRequests = 0;

function intEnv(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clientKey(req, suffix = "") {
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${suffix}`;
}

function pruneBuckets(now = Date.now()) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

const cleanupTimer = setInterval(pruneBuckets, 5 * 60 * 1000);
cleanupTimer.unref?.();

export function securityHeaders(req, res, next) {
  const requestId = String(req.get("x-request-id") || randomUUID()).slice(0, 128);
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' https://cdn.jsdelivr.net",
      "worker-src 'self' blob: https://cdn.jsdelivr.net",
      "manifest-src 'self'",
    ].join("; ")
  );

  const forwardedProto = String(req.get("x-forwarded-proto") || "").toLowerCase();
  if (req.secure || forwardedProto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (req.path.startsWith("/api/") || req.path === "/api") {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }
  next();
}

export function enforceSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  try {
    const originUrl = new URL(origin);
    const host = String(req.get("host") || "").toLowerCase();
    if (originUrl.host.toLowerCase() !== host) {
      console.warn(JSON.stringify({ event: "security_origin_reject", requestId: req.requestId, ip: req.ip, path: req.originalUrl, origin }));
      return res.status(403).json({ error: "ORIGIN_REJECTED", message: "Cross-site API requests are not allowed.", requestId: req.requestId });
    }
    return next();
  } catch {
    return res.status(403).json({ error: "ORIGIN_REJECTED", message: "Invalid request origin.", requestId: req.requestId });
  }
}

export function createRateLimiter({ windowMs, max, name }) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = clientKey(req, name);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      console.warn(JSON.stringify({ event: "security_rate_limit", requestId: req.requestId, ip: req.ip, path: req.originalUrl, limiter: name }));
      return res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Please wait and retry.", requestId: req.requestId, retryAfterSeconds: resetSeconds });
    }
    next();
  };
}

export const generalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: intEnv("API_REQUESTS_PER_MINUTE", 240, 30, 2000),
  name: "api-minute",
});

const expensiveLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: intEnv("EXPENSIVE_REQUESTS_PER_5_MIN", 50, 10, 500),
  name: "expensive-5min",
});

const dailyCostLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: intEnv("EXPENSIVE_REQUESTS_PER_DAY", 250, 25, 5000),
  name: "expensive-day",
});

const jobCreateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: intEnv("LONGDOC_JOBS_PER_10_MIN", 6, 1, 100),
  name: "longdoc-create",
});

export function protectExpensiveApi(req, res, next) {
  if (req.method !== "POST") return next();
  const path = req.path || "";
  if (!/^\/(?:rewrite|analyse|detector-scan|research|jobs)(?:\/|$)/.test(path)) return next();
  return expensiveLimiter(req, res, (err) => {
    if (err) return next(err);
    dailyCostLimiter(req, res, (dailyErr) => {
      if (dailyErr) return next(dailyErr);
      if (path === "/jobs" || path === "/jobs/") return jobCreateLimiter(req, res, next);
      next();
    });
  });
}

export function expensiveConcurrencyGate(req, res, next) {
  if (req.method !== "POST" || !/^\/(?:rewrite|analyse|detector-scan|research)(?:\/|$)/.test(req.path || "")) return next();
  const maxConcurrent = intEnv("MAX_CONCURRENT_EXPENSIVE_REQUESTS", 4, 1, 20);
  if (activeExpensiveRequests >= maxConcurrent) {
    res.setHeader("Retry-After", "5");
    console.warn(JSON.stringify({ event: "security_concurrency_reject", requestId: req.requestId, ip: req.ip, path: req.originalUrl, active: activeExpensiveRequests, maxConcurrent }));
    return res.status(503).json({ error: "SERVER_BUSY", message: "The revision service is at its safe concurrency limit. Retry shortly.", requestId: req.requestId });
  }
  activeExpensiveRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeExpensiveRequests = Math.max(0, activeExpensiveRequests - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

function validateDetectorObservation(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return false;
  const stringFields = ["detector", "version", "classification", "notes"];
  for (const field of stringFields) {
    const value = observation[field];
    if (value !== undefined && value !== null && typeof value !== "string") return false;
  }
  if (typeof observation.detector === "string" && observation.detector.length > 80) return false;
  if (typeof observation.version === "string" && observation.version.length > 80) return false;
  if (typeof observation.classification === "string" && observation.classification.length > 80) return false;
  if (typeof observation.notes === "string" && observation.notes.length > 1000) return false;
  for (const field of ["aiScore", "humanScore", "paraphrasedScore"]) {
    const value = observation[field];
    if (value !== undefined && value !== null && value !== "" && !Number.isFinite(Number(value))) return false;
  }
  if (observation.flaggedSentenceIndices !== undefined) {
    if (!Array.isArray(observation.flaggedSentenceIndices) || observation.flaggedSentenceIndices.length > 1000) return false;
  }
  return true;
}

export function validateApiPayload(req, res, next) {
  if (req.method !== "POST") return next();
  const path = req.path || "";
  const requiresJsonBody = path === "/rewrite" || path === "/analyse" || path === "/detector-scan" || path === "/detector-research" || path === "/jobs" || path === "/jobs/" || /^\/research(?:\/|$)/.test(path);
  if (!requiresJsonBody) return next();

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "A JSON object body is required.", requestId: req.requestId });
  }

  const {
    text,
    sourceText,
    candidateText,
    thoughts,
    manuscriptContext,
    researchContext,
    constraints,
    section,
    observations,
    styleFilters,
    rewriteIntensity,
    grammarIntensity,
    lengthPreference,
    naturalisation,
    label,
  } = req.body;
  for (const [key, value] of Object.entries({ text, sourceText, candidateText, thoughts, manuscriptContext, researchContext, constraints, section })) {
    if (value !== undefined && typeof value !== "string") {
      return res.status(400).json({ error: "BAD_REQUEST", message: `\`${key}\` must be a string.`, requestId: req.requestId });
    }
  }
  if (observations !== undefined) {
    if (!Array.isArray(observations) || observations.length > 20 || !observations.every(validateDetectorObservation)) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Invalid detector observations payload.", requestId: req.requestId });
    }
  }
  for (const [key, value] of Object.entries({ rewriteIntensity, grammarIntensity, lengthPreference, naturalisation, label })) {
    if (value !== undefined && (typeof value !== "string" || value.length > 80)) {
      return res.status(400).json({ error: "BAD_REQUEST", message: `\`${key}\` must be a short string.`, requestId: req.requestId });
    }
  }
  if (styleFilters !== undefined) {
    if (!styleFilters || typeof styleFilters !== "object" || Array.isArray(styleFilters) || Object.keys(styleFilters).length > 12) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "`styleFilters` must be a small object.", requestId: req.requestId });
    }
    for (const [key, value] of Object.entries(styleFilters)) {
      if (["__proto__", "prototype", "constructor"].includes(key) || typeof value !== "string" || key.length > 80 || value.length > 160) {
        return res.status(400).json({ error: "BAD_REQUEST", message: "Invalid style filter payload.", requestId: req.requestId });
      }
    }
  }
  next();
}

export function jsonBodyErrorHandler(err, req, res, next) {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the server safety limit.", requestId: req.requestId });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "BAD_JSON", message: "Malformed JSON request body.", requestId: req.requestId });
  }
  next(err);
}
