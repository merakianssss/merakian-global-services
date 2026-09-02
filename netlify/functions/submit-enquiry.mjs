// netlify/functions/submit-enquiry.mjs
// P3 - Production contact form handler
//
// Architecture: Netlify Function + Resend email service
// - No database (not required for v1)
// - Honeypot + IP-based rate limiting for spam protection
// - Zod schema validation
// - Configurable recipients via env vars

import { z } from 'zod';
import { Resend } from 'resend';

// ─── Configuration ───────────────────────────────────────────────
// CONTACT_TO_EMAIL: business recipient (default: contact from site)
// RESEND_API_KEY:   Resend transactional email API key
// FROM_EMAIL:       sender address (must be verified in Resend)
// TURNSTILE_SECRET: optional Cloudflare Turnstile secret
// ALLOWED_ORIGINS:  comma-separated list of origins allowed to POST
//                   (default: production domain + localhost dev)
const {
  CONTACT_TO_EMAIL = 'kapil.songara@merakian.net',
  RESEND_API_KEY,
  FROM_EMAIL = 'Merakian Global <enquiries@merakian.net>',
  TURNSTILE_SECRET_KEY,
  ALLOWED_ORIGINS = 'https://merakian.net,http://localhost:4321,http://localhost:8888',
} = process.env;

const ALLOWED_ORIGIN_LIST = ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

// ─── Constants ────────────────────────────────────────────────────
const MAX_BODY_BYTES = 20_000; // 20 KB payload cap
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 submissions per window per IP
const EMAIL_SERVICE_LABEL = 'enquiry-notification';

// In-memory rate limit store (per Lambda warm instance).
// Best-effort only — serverless rate limiting has documented limits.
const rateLimitStore = new Map();

// ─── Service type allowlist (mirrors form options) ───────────────
const SERVICE_TYPE_VALUES = [
  'travel_charter',
  'travel_hotel',
  'travel_insurance',
  'travel_packages',
  'recruit_manpower',
  'recruit_healthcare',
  'recruit_executive',
  'recruit_blue_collar',
  'recruit_domestic',
  'courier_express',
  'courier_international',
  'courier_warehousing',
  'other',
];

// ─── Zod validation schema ───────────────────────────────────────
const enquirySchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  phone: z.string().trim().min(6, 'Phone is too short').max(40),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  company: z.string().trim().max(120).optional().or(z.literal('')),
  service_type: z.enum(SERVICE_TYPE_VALUES, {
    errorMap: () => ({ message: 'Invalid service type' }),
  }),
  scope: z.string().trim().max(2000).optional().or(z.literal('')),
  headcount: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' || v == null ? undefined : Number(v)))
    .pipe(
      z
        .number()
        .int()
        .min(1, 'Must be at least 1')
        .max(100000, 'Too large')
        .optional(),
    )
    .optional(),
  origin: z.string().trim().max(120).optional().or(z.literal('')),
  destination: z.string().trim().max(120).optional().or(z.literal('')),
  pref_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .optional()
    .or(z.literal('')),
  message: z.string().trim().min(2, 'Message is too short').max(4000),
  consent: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'on' || v === 'true' || v === '1'),
  // Honeypot field — must be empty
  website: z.string().max(0, 'Bot detected').optional().or(z.literal('')),
});

// ─── Helpers ─────────────────────────────────────────────────────
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
      // CORS restricted to configured origins (also checked server-side)
      'Access-Control-Allow-Origin': 'https://merakian.net',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

function getClientIp(event) {
  const headers = event.headers || {};
  return (
    headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    headers['x-real-ip'] ||
    headers['client-ip'] ||
    event.requestContext?.identity?.sourceIp ||
    'unknown'
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

function escapeHtml(input) {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailBody(d) {
  return [
    'NEW MERAKIAN GLOBAL SERVICES ENQUIRY',
    '═'.repeat(50),
    '',
    `Submitted:    ${new Date().toISOString()}`,
    `Service:      ${d.service_type}`,
    '',
    '— Contact —',
    `Name:         ${d.name}`,
    `Email:        ${d.email}`,
    `Phone:        ${d.phone}`,
    `Country:      ${d.country || '(not provided)'}`,
    `Company:      ${d.company || '(not provided)'}`,
    '',
    '— Project —',
    `Scope:        ${d.scope || '(not provided)'}`,
    `Headcount:    ${d.headcount ?? '(not provided)'}`,
    `Origin:       ${d.origin || '(not provided)'}`,
    `Destination:  ${d.destination || '(not provided)'}`,
    `Date:         ${d.pref_date || '(not provided)'}`,
    '',
    '— Message —',
    d.message,
    '',
    '— Consent —',
    `User consented: ${d.consent ? 'Yes' : 'No'}`,
    '',
    '═'.repeat(50),
    'Reply directly to: ' + d.email,
  ].join('\n');
}

function buildEmailHtml(d) {
  const row = (label, value) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#d0c5af;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#e5e2e1;font-size:14px;">${escapeHtml(value) || '<em style="color:#99907c">not provided</em>'}</td></tr>`;
  return `<!doctype html><html><body style="background:#000;color:#e5e2e1;font-family:Hanken Grotesk,Arial,sans-serif;padding:24px;">
<div style="max-width:640px;margin:0 auto;background:#1E1E1E;border:1px solid #4d4635;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(90deg,#f2ca50,#C5A028);padding:16px 24px;">
    <h1 style="margin:0;color:#000;font-family:Libre Caslon Text,Georgia,serif;font-weight:400;font-size:24px;">New Enquiry</h1>
    <p style="margin:4px 0 0 0;color:#3c2f00;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Merakian Global Services</p>
  </div>
  <div style="padding:24px;">
    <p style="color:#f2ca50;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px 0;">Service Requested</p>
    <p style="color:#e5e2e1;font-size:18px;margin:0 0 24px 0;">${escapeHtml(d.service_type)}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">${row('Name', d.name)}${row('Email', d.email)}${row('Phone', d.phone)}${row('Country', d.country)}${row('Company', d.company)}</table>
    <hr style="border:none;border-top:1px solid #4d4635;margin:24px 0;"/>
    <table cellpadding="0" cellspacing="0" style="width:100%;">${row('Scope', d.scope)}${row('Headcount', d.headcount ?? '')}${row('Origin', d.origin)}${row('Destination', d.destination)}${row('Date', d.pref_date)}</table>
    <hr style="border:none;border-top:1px solid #4d4635;margin:24px 0;"/>
    <p style="color:#f2ca50;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px 0;">Message</p>
    <div style="background:#131313;border:1px solid #4d4635;border-radius:4px;padding:16px;color:#e5e2e1;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(d.message)}</div>
    <hr style="border:none;border-top:1px solid #4d4635;margin:24px 0;"/>
    <p style="color:#99907c;font-size:12px;margin:0;">Reply directly to ${escapeHtml(d.email)}.</p>
  </div>
</div>
</body></html>`;
}

function logEvent(level, message, meta = {}) {
  const safe = { ...meta };
  // Strip any fields that could contain PII bulk data; we keep only identifiers
  delete safe.message;
  delete safe.scope;
  delete safe.body;
  console.log(JSON.stringify({
    level,
    service: EMAIL_SERVICE_LABEL,
    timestamp: new Date().toISOString(),
    message,
    ...safe,
  }));
}

async function sendEmailWithRetry(resend, emailParams, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await resend.emails.send(emailParams);
    if (!result.error) return result;
    lastError = result.error;
    // Only retry on likely-transient 5xx-style errors (Resend uses error.name/code)
    const isRetryable =
      result.error?.name === 'validation_error' && String(result.error?.message).startsWith('Internal server error');
    if (!isRetryable || attempt === retries) break;
    logEvent('warn', 'resend_retry', { attempt: attempt + 1, error: result.error.message });
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return { error: lastError };
}

// ─── Handler ──────────────────────────────────────────────────────
export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, '');
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  // Get IP before any branching to use in logs
  const ip = getClientIp(event);

  // Origin validation — defence in depth (CORS header is already set server-side)
  const origin = event.headers?.origin;
  if (origin && !ALLOWED_ORIGIN_LIST.includes(origin)) {
    logEvent('warn', 'invalid_origin', { ip, origin });
    return jsonResponse(403, { ok: false, error: 'Forbidden' });
  }

  // Rate limit check
  if (isRateLimited(ip)) {
    logEvent('warn', 'rate_limit_exceeded', { ip });
    return jsonResponse(429, {
      ok: false,
      error: 'Too many submissions. Please try again in a minute.',
    });
  }

  // Content-Type guard
  const contentType = (event.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.includes('application/x-www-form-urlencoded')) {
    return jsonResponse(415, { ok: false, error: 'Unsupported content type' });
  }

  // Body size guard
  const rawBody = event.body || '';
  if (rawBody.length > MAX_BODY_BYTES) {
    logEvent('warn', 'payload_too_large', { ip, bytes: rawBody.length });
    return jsonResponse(413, { ok: false, error: 'Payload too large' });
  }

  // Parse body
  let payload;
  try {
    if (contentType.includes('application/json')) {
      payload = JSON.parse(rawBody);
    } else {
      // application/x-www-form-urlencoded
      const params = new URLSearchParams(rawBody);
      payload = Object.fromEntries(params.entries());
      // Checkbox: presence == true
      if ('consent' in payload) payload.consent = 'on';
    }
  } catch (err) {
    logEvent('warn', 'invalid_json', { ip });
    return jsonResponse(400, { ok: false, error: 'Invalid request body' });
  }

  // Validate
  const parsed = enquirySchema.safeParse(payload);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    logEvent('info', 'validation_failed', {
      ip,
      field: firstError?.path?.join('.'),
      reason: firstError?.message,
    });
    return jsonResponse(400, {
      ok: false,
      error: firstError?.message || 'Invalid input',
      field: firstError?.path?.[0],
    });
  }

  // Honeypot check (also enforced by schema, but be explicit)
  if (parsed.data.website && parsed.data.website.length > 0) {
    logEvent('warn', 'honeypot_triggered', { ip });
    // Pretend success to confuse bots
    return jsonResponse(200, { ok: true, message: 'Enquiry received.' });
  }

  // Optional Turnstile verification (skipped silently if not configured)
  if (TURNSTILE_SECRET_KEY && payload['cf-turnstile-response']) {
    try {
      const verifyRes = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: TURNSTILE_SECRET_KEY,
            response: payload['cf-turnstile-response'],
          }),
        },
      );
      const verifyJson = await verifyRes.json();
      if (!verifyJson.success) {
        logEvent('warn', 'turnstile_failed', { ip });
        return jsonResponse(400, { ok: false, error: 'Verification failed' });
      }
    } catch (err) {
      logEvent('error', 'turnstile_verify_error', { error: String(err) });
      // Don't block submission on Turnstile errors; log and continue
    }
  }

  const data = parsed.data;

  // Email delivery
  if (!RESEND_API_KEY) {
    logEvent('error', 'resend_key_missing');
    return jsonResponse(503, {
      ok: false,
      error: 'Email service not configured. Please contact us directly.',
    });
  }

  try {
    const resend = new Resend(RESEND_API_KEY);
    const subject = `New enquiry: ${data.service_type} — ${data.name}`;
    const result = await sendEmailWithRetry(resend, {
      from: FROM_EMAIL,
      to: CONTACT_TO_EMAIL,
      reply_to: data.email,
      subject,
      text: buildEmailBody(data),
      html: buildEmailHtml(data),
    });

    if (result.error) {
      logEvent('error', 'resend_error', { detail: result.error?.message });
      return jsonResponse(502, {
        ok: false,
        error: 'Unable to send enquiry right now. Please try again later.',
      });
    }

    logEvent('info', 'enquiry_sent', { id: result.data?.id });
    return jsonResponse(200, {
      ok: true,
      message: 'Your enquiry has been received. We will respond within 1 business day.',
    });
  } catch (err) {
    // Catch unexpected runtime errors (network, etc.) — never leak full stack to client
    logEvent('error', 'enquiry_send_failed', { kind: err?.name || 'unknown' });
    return jsonResponse(502, {
      ok: false,
      error: 'Unable to send enquiry right now. Please try again later.',
    });
  }
}
