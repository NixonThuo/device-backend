// src/collections/Users.ts
import { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: ['employee', 'security', 'admin'],
      defaultValue: 'employee',
      required: true,
    },
    {
      name: 'devices',
      type: 'relationship',
      relationTo: 'devices',
      hasMany: true,
    },
  ],
}
