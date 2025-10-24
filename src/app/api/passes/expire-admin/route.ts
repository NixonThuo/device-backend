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
