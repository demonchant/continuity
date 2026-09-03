import type { NextFunction, Request, Response } from 'express';
import type { AccessPrincipal, AccessRole } from './access.js';
import type { AccessService } from './access-service.js';
import { AppError } from '../shared/errors/app-error.js';

export const accessCookieName = 'continuity_session';

export function cookieValue(request: Pick<Request, 'header'>, name: string): string | undefined {
  const cookie = request.header('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function accessAuthenticated(service: AccessService, roles?: readonly AccessRole[]) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const token = cookieValue(request, accessCookieName);
    const principal = token ? await service.session(token) : null;
    if (!principal)
      return next(
        new AppError({
          statusCode: 401,
          code: 'ACCESS_AUTH_REQUIRED',
          message: 'Sign in to continue',
        }),
      );
    if (roles && !roles.includes(principal.role)) {
      return next(
        new AppError({
          statusCode: 403,
          code: 'ACCESS_ROLE_REQUIRED',
          message: 'Your workspace role cannot perform this action',
        }),
      );
    }
    response.locals.accessPrincipal = principal;
    next();
  };
}

export function accessPrincipal(response: Response): AccessPrincipal {
  return response.locals.accessPrincipal as AccessPrincipal;
}
