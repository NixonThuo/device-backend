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

const allowedOrigins = ['http://localhost:3001', 'http://192.168.1.123:3001']

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
