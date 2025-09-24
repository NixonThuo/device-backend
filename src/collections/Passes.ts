// src/collections/Passes.ts
import type { CollectionConfig, Where } from 'payload'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
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
      validate: (value) => {
        if (!value) return 'Start date is required.'
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const start = new Date(value)
        if (start < today) return 'Start date cannot be before today.'
        return true
      },
    },
    {
      name: 'endDate',
      type: 'date',
      required: true,
      admin: { description: 'End date must be after start date.' },
      validate: (value, { data }) => {
        if (!value) return 'End date is required.'
        if (!(data as any)?.startDate) return true
        const start = new Date((data as any).startDate)
        const end = new Date(value)
        if (end <= start) return 'End date must be after start date.'
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
        // Generate a random 8-character alphanumeric label
        const randomLabel = Math.random().toString(36).substring(2, 10).toUpperCase()
        data.label = randomLabel
        return data
      },
      // No auto-compute of endDate based on type (type field removed)
      // If you want to auto-set endDate, do it based on startDate only, or remove this hook entirely
      ({ data }) => data,

      // Prevent overlapping active passes with date overlap (type field removed)
      async ({ data, req, originalDoc }) => {
        if (!data?.device) return data
        if (data?.status === 'revoked') return data

        const currentId = data?.id ?? originalDoc?.id
        const start = new Date(data.startDate)
        const end = new Date(data.endDate)

        // Only run the query if device is a valid string or number
        const deviceId =
          typeof data.device === 'string' || typeof data.device === 'number'
            ? data.device
            : data.device?.id

        if (!deviceId) return data

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
          throw new Error('An overlapping active pass already exists for this device.')
        }
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
