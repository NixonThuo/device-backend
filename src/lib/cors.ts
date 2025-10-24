import { NextRequest, NextResponse } from 'next/server'

export const allowedOrigins = [
  'http://localhost:3001',
  'http://192.168.1.123:3001',
  'http://192.168.1.90:3001',
]

export function withCORS(response: NextResponse, req: NextRequest) {
  const origin = req.headers.get('origin')
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  }
  return response
}

export function preflightResponse(req: NextRequest) {
  return withCORS(new NextResponse(null, { status: 204 }), req)
}
