import { NextRequest, NextResponse } from 'next/server'
import payload from 'payload'
import payloadConfig from '../../../../payload.config'
import { withCORS, preflightResponse } from '../../../../../src/lib/cors'

// Ensure Payload is initialized before any operation
let payloadInitialized = false
async function ensurePayloadInit() {
  if (!payloadInitialized) {
    await payload.init({ config: payloadConfig })
    payloadInitialized = true
  }
}

export async function OPTIONS(req: NextRequest) {
  // Preflight CORS support (delegated to shared helper)
  return preflightResponse(req)
}

// GET /api/passes/by-device?device=<deviceId>
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const deviceId = searchParams.get('device')

  if (!deviceId) {
    return withCORS(NextResponse.json({ error: 'Missing device parameter' }, { status: 400 }), req)
  }

  try {
    await ensurePayloadInit()
    // Fetch passes then mark expired ones in-memory before returning.
    // We avoid writing back to the DB here to prevent validation errors
    // during on-read maintenance. If you want permanent updates, run a
    // separate maintenance job or endpoint that handles validation explicitly.

    // Now fetch and return current passes for the device (including updated statuses)
    const passesRes = await payload.find({
      collection: 'passes',
      where: { device: { equals: deviceId } },
      depth: 1,
    })
    const now = new Date()
    const docs = (passesRes.docs || []).map((p: any) => {
      try {
        const end = p?.endDate ? new Date(p.endDate) : undefined
        if (p?.status === 'active' && end && end < now) {
          // return a copy with status adjusted to 'expired' for the response
          return { ...p, status: 'expired', isCurrentlyValid: false }
        }
      } catch (e) {
        // ignore parsing errors and return original doc
      }
      return p
    })
    return withCORS(NextResponse.json(docs), req)
  } catch (err) {
    return withCORS(
      NextResponse.json({ error: 'Failed to fetch passes', details: String(err) }, { status: 500 }),
      req,
    )
  }
}
