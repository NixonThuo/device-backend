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
      // Update each expired pass to status 'expired'. Include start/end dates
      // formatted as ISO date strings (YYYY-MM-DD) to satisfy field-level
      // validation, and use overrideAccess to allow server-side updates.
      // Wrap each update in try/catch and log failures for easier debugging.
      const { logInfo, logError } = await import('../../../../../src/lib/logger')
      await Promise.all(
        toExpire.docs.map(async (p: any) => {
          const startStr = p.startDate
            ? new Date(p.startDate).toISOString().slice(0, 10)
            : undefined
          const endStr = p.endDate ? new Date(p.endDate).toISOString().slice(0, 10) : undefined
          const updateData: any = { status: 'expired' }
          if (startStr) updateData.startDate = startStr
          if (endStr) updateData.endDate = endStr
          try {
            logInfo('Expiring pass', { id: p.id, updateData })
            return await payload.update({
              collection: 'passes',
              id: p.id,
              data: updateData,
              overrideAccess: true,
            })
          } catch (err) {
            // Log full context to help debug validation errors
            logError('Failed to expire pass', {
              id: p.id,
              original: p,
              updateData,
              error: String(err),
            })
            // rethrow so the outer catch returns error to client
            throw err
          }
        }),
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
