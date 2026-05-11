import type { Request } from 'express';
import type { AuthUser } from '@picup/shared';

export interface AuthenticatedRequest extends Request {
  authUser: AuthUser;
}
