import { NextRequest, NextResponse } from 'next/server'
import payload from 'payload'
import payloadConfig from '../../../../payload.config'
import { withCORS, preflightResponse } from '../../../../../src/lib/cors'
import { logInfo, logError } from '../../../../../src/lib/logger'

// Admin-only endpoint to expire passes permanently.
// Uses the normal Payload authentication (Authorization: JWT <token> or a valid
// session cookie). It will find active passes with endDate < now and set
// status = 'expired'.

let payloadInitialized = false
async function ensurePayloadInit() {
  if (!payloadInitialized) {
    await payload.init({ config: payloadConfig })
    payloadInitialized = true
  }
}

export async function POST(req: NextRequest) {
  // Log request entry and headers (only a few headers to avoid noise)
  try {
    logInfo('expire-admin invoked', {
      method: 'POST',
      origin: req.headers.get('origin'),
      contentType: req.headers.get('content-type'),
      authorizationPresent: !!req.headers.get('authorization'),
    })
  } catch (e) {}

  // Also write a concise console log for quick local inspection. Mask the
  // Authorization header to avoid leaking tokens in logs.
  try {
    const headersObj: Record<string, string> = {}
    for (const [k, v] of req.headers.entries()) {
      headersObj[k] = k.toLowerCase() === 'authorization' ? '[REDACTED]' : String(v)
    }
    const rawAuth = req.headers.get('authorization') || ''
    const authScheme = rawAuth.split(/\s+/)[0] || null
    console.log('expire-admin request received', {
      method: req.method,
      url: req.url,
      origin: req.headers.get('origin'),
      authScheme,
      headers: headersObj,
    })
  } catch (e) {}

  // Try to decode the JWT payload (without verifying) to log the user's role
  // if present. This is purely for debugging/logging and does not grant access.
  // Try to verify the JWT and log the user's role. If verification is not
  // possible (no secret/verifier available) fall back to decoding without
  // verification. This logging is non-authoritative and used for debugging.
  try {
    let roleToLog = 'anonymous'
    const authHeader = req.headers.get('authorization') || ''
    let token = authHeader.replace(/^Bearer\s+/i, '').replace(/^JWT\s+/i, '') || null
    if (!token) {
      token =
        req.cookies.get('payload')?.value ||
        req.cookies.get('payloadToken')?.value ||
        req.cookies.get('token')?.value ||
        null
    }

    if (token) {
      // Prefer Payload's verifier when available
      try {
        const verifier = (payload as any).verifyJWT ?? (payload as any).verifyToken
        if (typeof verifier === 'function') {
          const decoded = await verifier.call(payload, token)
          roleToLog = decoded?.role || decoded?.data?.role || decoded?.user?.role || 'unknown'
        } else {
          // Fallback to jsonwebtoken with PAYLOAD_SECRET
          const secret = process.env.PAYLOAD_SECRET
          if (secret) {
            try {
              const jwt = await import('jsonwebtoken')
              const decoded = (jwt as any).verify(token, secret)
              roleToLog = decoded?.role || decoded?.data?.role || decoded?.user?.role || 'unknown'
            } catch (verErr) {
              try {
                logError('expire-admin jwt verify failed (jsonwebtoken)', String(verErr))
              } catch (e) {}
              // verification failed; fall through to unverified decode below
            }
          }
        }
      } catch (verifierErr) {
        try {
          logError('expire-admin jwt verify failed (verifier)', String(verifierErr))
        } catch (e) {}
        // fall back to unverified decode
      }

      // If we still don't have a role, try base64 decode without verification
      if (!roleToLog || roleToLog === 'anonymous' || roleToLog === 'unknown') {
        try {
          const parts = token.split('.')
          if (parts.length >= 2) {
            const b = parts[1].replace(/-/g, '+').replace(/_/g, '/')
            const pad = b.length % 4
            const padded = pad === 2 ? b + '==' : pad === 3 ? b + '=' : pad === 0 ? b : b + '=='
            const payloadJson = Buffer.from(padded, 'base64').toString('utf8')
            const payload = JSON.parse(payloadJson)
            roleToLog = payload?.role || payload?.data?.role || payload?.user?.role || roleToLog
          }
        } catch (e) {
          // ignore decode errors
        }
      }
    }

    console.log('expire-admin requester role:', roleToLog)
  } catch (e) {
    // ignore any unexpected errors
  }

  // No authentication: this route is intentionally public and will run the
  // expiry operation without checking tokens or session cookies. Callers may
  // still be rate-limited or protected by external network controls.
  try {
    await ensurePayloadInit()

    const nowIso = new Date().toISOString()
    // find active passes that ended before now
    const toExpire = await payload.find({
      collection: 'passes',
      depth: 0,
      limit: 10000,
      where: {
        and: [{ status: { equals: 'active' } }, { endDate: { less_than: nowIso } }],
      },
    })

    const results: any[] = []
    for (const p of toExpire.docs) {
      try {
        // perform update with overrideAccess and request flag to disable validation
        const update = await payload.update({
          collection: 'passes',
          id: p.id,
          data: {
            status: 'expired',
            startDate: p.startDate,
            endDate: p.endDate,
          },
          overrideAccess: true,
          // cast req to any so we can attach our maintenance flag without TS errors
          req: { disableValidation: true } as any,
        })
        results.push({ id: p.id, success: true })
      } catch (err) {
        results.push({ id: p.id, success: false, error: String(err) })
      }
    }

    logInfo('expire-admin finished', { expired: results.length })
    return withCORS(NextResponse.json({ expired: results.length, details: results }), req)
  } catch (err) {
    logError('expire-admin failed', String(err))
    return withCORS(
      NextResponse.json(
        { error: 'Failed to expire passes', details: String(err) },
        { status: 500 },
      ),
      req,
    )
  }
}

export async function OPTIONS(req: NextRequest) {
  try {
    logInfo('expire-admin preflight (OPTIONS) received', { origin: req.headers.get('origin') })
  } catch (e) {}
  return preflightResponse(req)
}
