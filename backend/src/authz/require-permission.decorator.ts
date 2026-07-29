import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from './permissions';

export const PERMISSION_KEY = 'authz:permission';

/**
 * The "edit own vs edit any" rows collapsed into one declaration: the guard
 * tries `any` first, and falls back to `own` only when the loaded resource's
 * `ownerField` equals the caller's id.
 */
export interface OwnAwarePermission {
  any: PermissionKey;
  own: PermissionKey;
  /** field on the resolved resource that names its author, e.g. 'authorId' */
  ownerField: string;
}

export type PermissionRequirement = PermissionKey | OwnAwarePermission;

/**
 * Declares what a route needs; the PermissionGuard evaluates it against the
 * matrix. Usage:
 *
 *   @RequirePermission('event:manage')
 *   @RequirePermission({ any: 'post:edit:any', own: 'post:edit:own', ownerField: 'authorId' })
 *
 * Routes without this decorator are not community-scoped (e.g. /auth/me) and
 * bypass the PermissionGuard entirely — authentication is still enforced
 * separately by the JwtAuthGuard.
 */
export const RequirePermission = (requirement: PermissionRequirement) =>
  SetMetadata(PERMISSION_KEY, requirement);
