import { CollectionConfig } from 'payload'
import { isAdmin } from '../access/roles'

export const Devices: CollectionConfig = {
  slug: 'devices',
  admin: {
    useAsTitle: 'deviceName',
    defaultColumns: ['deviceName', 'deviceType', 'serialNumber', 'owner', 'status'],
  },
  timestamps: true,
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { owner: { equals: user.id } }
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { owner: { equals: user.id } }
    },
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    { name: 'deviceName', type: 'text', required: true },
    {
      name: 'deviceType',
      type: 'select',
      options: ['Phone', 'Tablet', 'Laptop', 'Other'],
      required: true,
    },
    {
      name: 'serialNumber',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Pending Approval', value: 'pending' },
        { label: 'Deactivated', value: 'deactivated' },
      ],
      defaultValue: 'active',
    },
    // Reverse lookup: all passes for this device
    {
      name: 'passes',
      type: 'relationship',
      relationTo: 'passes',
      hasMany: true,
      admin: {
        description: 'All passes issued for this device',
      },
      // Keep it read-only in Admin, since Passes are created in Passes collection
      access: {
        update: ({ req: { user } }) => !!user && user.role === 'admin',
      },
    },
  ],
}
