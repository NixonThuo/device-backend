import type { Access, FieldAccess } from 'payload'

export const isAdmin: Access = ({ req: { user } }) => user?.role === 'admin'
export const isAdminOrSecurity: Access = ({ req: { user } }) =>
  user?.role === 'admin' || user?.role === 'security'

export const isSelfOrAdmin: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  return { id: { equals: user.id } }
}

export const canAccessOwnDevice: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'security') return true
  // Non-admins can only access where device.owner == user.id
  return {
    owner: { equals: user.id },
  }
}

export const canAccessPassForOwnDevice: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'security') return true
  // Non-admins can access passes whose device.owner == user.id
  return {
    device: {
      in: [
        // Payload supports relation depth filtering; using nested where:
        { owner: { equals: user.id } } as any,
      ],
    },
  }
}
