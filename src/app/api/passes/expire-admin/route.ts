import { NextRequest, NextResponse } from 'next/server'
import payload from 'payload'
import payloadConfig from '../../../../payload.config'

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
  const adminSecret = req.headers.get('x-admin-secret')
  if (!process.env.ADMIN_SECRET) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_SECRET not set' },
      { status: 500 },
    )
  }
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    return NextResponse.json({ expired: results.length, details: results })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to expire passes', details: String(err) },
      { status: 500 },
    )
  }
}
