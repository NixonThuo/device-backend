// src/collections/Passes.ts
import type { CollectionConfig, Where } from 'payload'
import { logInfo, logError } from '../lib/logger'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// Helpers
function formatDateISO(date: unknown) {
  if (!date) return undefined
  try {
    const d = new Date(String(date))
    if (Number.isNaN(d.getTime())) return undefined
    return d.toISOString().slice(0, 10)
  } catch {
    return undefined
  }
}

function generateRandomLabel(length = 8) {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length)
    .toUpperCase()
}

function isNewDocument(opts?: any) {
  // payload passes originalDoc in hooks/validators when updating
  return !opts?.originalDoc
}

async function ensureNoOverlap(data: any, req: any, originalDoc: any) {
  if (!data?.device) return
  if (data?.status === 'revoked') return

  const currentId = data?.id ?? originalDoc?.id
  const start = new Date(data.startDate)
  const end = new Date(data.endDate)

  const deviceId =
    typeof data.device === 'string' || typeof data.device === 'number'
      ? data.device
      : data.device?.id
  if (!deviceId) return

  const result = await req.payload.find({
    collection: 'passes',
    depth: 0,
    limit: 1,
    where: {
      and: [
        { device: { equals: deviceId } },
        { status: { equals: 'active' } },
        { startDate: { less_than: end.toISOString() } },
        { endDate: { greater_than: start.toISOString() } },
        ...(currentId ? [{ id: { not_equals: currentId } }] : []),
      ],
    },
  })

  if (result?.docs?.length) {
    // Log context so devs can trace back which records caused overlap
    try {
      logError('Overlap detected when creating/updating pass', {
        deviceId,
        dataStart: data.startDate,
        dataEnd: data.endDate,
        conflictingPassId: result.docs[0]?.id,
        currentId,
      })
    } catch (e) {
      // swallow logging errors
    }
    throw new Error('An overlapping active pass already exists for this device.')
  }
}

// Access helper: users can access passes for devices they own.
// Admin/Security can access everything.
// We compute a WHERE clause limiting device IDs that belong to the user.
async function wherePassesForUserDevices(req: any): Promise<true | Where | false> {
  const user = req?.user
  if (!user) return false
  if (user.role === 'admin' || user.role === 'security') return true

  const devices = await req.payload.find({
    collection: 'devices',
    depth: 0,
    limit: 1000,
    where: { owner: { equals: user.id } },
  })

  const deviceIDs = devices.docs.map((d: any) => (typeof d.id === 'string' ? d.id : String(d.id)))
  if (deviceIDs.length === 0) return { id: { equals: '___none___' } } // no matches
  return { device: { in: deviceIDs } }
}

export const Passes: CollectionConfig = {
  slug: 'passes',
  admin: {
    useAsTitle: 'label',
    defaultColumns: [
      'label',
      'type',
      'device',
      'startDate',
      'endDate',
      'status',
      'isCurrentlyValid',
    ],
  },
  timestamps: true,
  access: {
    // Owners (of the device) can see/create their passes; admin/security full.
    read: ({ req }) => wherePassesForUserDevices(req),
    create: ({ req }) => wherePassesForUserDevices(req),
    // Only admin/security may update or delete passes (optional; tweak if needed)
    update: ({ req: { user } }) => user?.role === 'admin' || user?.role === 'security',
    delete: ({ req: { user } }) => user?.role === 'admin' || user?.role === 'security',
  },
  fields: [
    // Convenience label (e.g., "JET2 Pass")
    {
      name: 'label',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'device',
      type: 'relationship',
      relationTo: 'devices',
      required: true,
    },
    // Removed 'type' field
    {
      name: 'startDate',
      type: 'date',
      required: true,
      admin: { description: 'Start date must be today or later.' },
      validate: (value, opts: any) => {
        if (!value) return 'Start date is required.'
        // Allow skipping validation when server-side maintenance requests set disableValidation
        if (opts?.req?.disableValidation) return true
        // Only enforce the "not before today" rule for new documents
        if (!isNewDocument(opts)) return true
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const start = new Date(String(value))
        if (start < today) {
          try {
            logError('startDate validation failed', { value, opts })
          } catch (e) {}
          return 'Start date cannot be before today.'
        }
        return true
      },
    },
    {
      name: 'endDate',
      type: 'date',
      required: true,
      admin: { description: 'End date must be after start date.' },
      validate: (value, { data, req }: any) => {
        if (!value) return 'End date is required.'
        // Allow skipping validation for maintenance requests
        if (req?.disableValidation) return true
        if (!(data as any)?.startDate) return true
        const start = new Date((data as any).startDate)
        const end = new Date(value)
        if (end <= start) {
          try {
            logError('endDate validation failed', { start: (data as any)?.startDate, end: value })
          } catch (e) {}
          return 'End date must be after start date.'
        }
        return true
      },
    },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Expired', value: 'expired' },
        { label: 'Revoked', value: 'revoked' },
      ],
      defaultValue: 'active',
    },
    {
      name: 'isCurrentlyValid',
      type: 'checkbox',
      admin: { readOnly: true },
    },
  ],
  hooks: {
    beforeValidate: [
      // Auto-generate label based on device
      async ({ data }) => {
        if (!data) return data
        data.label = generateRandomLabel(8)
        return data
      },
      // No auto-compute of endDate based on type (type field removed)
      // If you want to auto-set endDate, do it based on startDate only, or remove this hook entirely
      ({ data }) => data,

      // Prevent overlapping active passes with date overlap (type field removed)
      async ({ data, req, originalDoc }) => {
        await ensureNoOverlap(data, req, originalDoc)
        return data
      },
    ],
    afterRead: [
      async ({ doc }) => {
        const now = new Date()
        const start = new Date(doc.startDate)
        const end = new Date(doc.endDate)
        const valid = doc.status === 'active' && now >= start && now <= end
        doc.isCurrentlyValid = !!valid
        return doc
      },
    ],
  },
}
