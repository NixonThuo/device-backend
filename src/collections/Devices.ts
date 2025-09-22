// src/collections/Devices.ts
import { CollectionConfig } from 'payload'

export const Devices: CollectionConfig = {
  slug: 'devices',
  admin: {
    useAsTitle: 'deviceName',
  },
  access: {
    read: ({ req: { user } }) => !!user,
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'deviceName',
      type: 'text',
      required: true,
    },
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
      options: ['Active', 'Pending Approval', 'Deactivated'],
      defaultValue: 'Active',
    },
  ],
}
