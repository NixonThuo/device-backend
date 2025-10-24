import { NextRequest, NextResponse } from 'next/server'
import payload from 'payload'
import payloadConfig from '../../../../payload.config'

// Ensure Payload is initialized before any operation
let payloadInitialized = false
async function ensurePayloadInit() {
  if (!payloadInitialized) {
    await payload.init({ config: payloadConfig })
    payloadInitialized = true
  }
}

const allowedOrigins = [
  'http://localhost:3001',
  'http://192.168.1.123:3001',
  'http://192.168.1.90:3001',
]

function withCORS(response: NextResponse, req: NextRequest) {
  const origin = req.headers.get('origin')
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  }
  return response
}

export async function OPTIONS(req: NextRequest) {
  // Preflight CORS support
  return withCORS(new NextResponse(null, { status: 204 }), req)
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
    // Before returning passes, expire any active passes whose endDate is in the past.
    // This keeps the stored status in sync with actual validity.
    const nowIso = new Date().toISOString()
    const toExpire = await payload.find({
      collection: 'passes',
      depth: 0,
      limit: 1000,
      where: {
        and: [
          { device: { equals: deviceId } },
          { status: { equals: 'active' } },
          { endDate: { less_than: nowIso } },
        ],
      },
    })

    if (toExpire?.docs?.length) {
      // Update each expired pass to status 'expired'
      await Promise.all(
        toExpire.docs.map((p: any) =>
          payload.update({ collection: 'passes', id: p.id, data: { status: 'expired' } }),
        ),
      )
    }

    // Now fetch and return current passes for the device (including updated statuses)
    const passes = await payload.find({
      collection: 'passes',
      where: { device: { equals: deviceId } },
      depth: 1,
    })
    return withCORS(NextResponse.json(passes.docs), req)
  } catch (err) {
    return withCORS(
      NextResponse.json({ error: 'Failed to fetch passes', details: String(err) }, { status: 500 }),
      req,
    )
  }
}
