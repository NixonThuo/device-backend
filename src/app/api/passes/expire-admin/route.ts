import { NextRequest, NextResponse } from 'next/server'
import payload from 'payload'
import payloadConfig from '../../../../payload.config'
import { withCORS, preflightResponse } from '../../../../../src/lib/cors'
import { logInfo, logError } from '../../../../../src/lib/logger'

// Admin-only endpoint to expire passes permanently. Requires header:
//   x-admin-secret: <value of process.env.ADMIN_SECRET>
// It will find active passes with endDate < now and set status = 'expired'.

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

  // Secure with Payload JWT: require Authorization: JWT <token>
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').replace(/^JWT\s+/i, '') || null
  if (!token) {
    return withCORS(
      NextResponse.json({ error: 'Unauthorized: missing Authorization header' }, { status: 401 }),
      req,
    )
  }

  try {
    await ensurePayloadInit()

    // Verify token: prefer Payload's verifier, otherwise fall back to jsonwebtoken
    let decoded: any = null
    try {
      const verifier = (payload as any).verifyJWT ?? (payload as any).verifyToken
      if (typeof verifier === 'function') {
        decoded = await verifier.call(payload, token)
      } else {
        // Fallback: try verifying JWT directly using jsonwebtoken and PAYLOAD_SECRET
        const secret = process.env.PAYLOAD_SECRET
        if (!secret) {
          return withCORS(
            NextResponse.json(
              { error: 'Server misconfigured: cannot verify JWT' },
              { status: 500 },
            ),
            req,
          )
        }
        try {
          const jwt = await import('jsonwebtoken')
          decoded = (jwt as any).verify(token, secret)
        } catch (err) {
          return withCORS(
            NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 401 }),
            req,
          )
        }
      }
    } catch (err) {
      return withCORS(
        NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 401 }),
        req,
      )
    }

    const userId = decoded?.id
    if (!userId) {
      return withCORS(
        NextResponse.json({ error: 'Unauthorized: token missing user id' }, { status: 401 }),
        req,
      )
    }

    // Ensure user is admin
    const user = await payload.findByID({ collection: 'users', id: userId, depth: 0 })
    if (!user || user.role !== 'admin') {
      return withCORS(
        NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 }),
        req,
      )
    }

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
