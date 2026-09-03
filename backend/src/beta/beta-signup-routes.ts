import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateBody } from '../shared/http/validation.js';
import { betaRoles, type BetaSignupRepository } from './beta-signup.js';
import type { AccessNotificationService } from '../access/access-notifications.js';

const betaSignupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    role: z.enum(betaRoles),
    workflow: z.string().trim().max(1000).optional(),
    consentToContact: z.literal(true),
    publicAttributionConsent: z.boolean().default(false),
    attributionName: z.string().trim().max(120).optional(),
    companyWebsite: z.string().max(0).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.publicAttributionConsent && !value.attributionName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attributionName'],
        message: 'Attribution name is required when public attribution is permitted',
      });
    }
  });

export function createBetaSignupRouter(
  repository: BetaSignupRepository,
  notifications?: AccessNotificationService,
): Router {
  const router = Router();
  router.post(
    '/',
    validateBody(betaSignupSchema),
    asyncHandler(async (request, response) => {
      const input = request.body as z.infer<typeof betaSignupSchema>;
      const record = await repository.upsert({
        email: input.email,
        role: input.role,
        consentToContact: input.consentToContact,
        publicAttributionConsent: input.publicAttributionConsent,
        ...(input.workflow ? { workflow: input.workflow } : {}),
        ...(input.attributionName ? { attributionName: input.attributionName } : {}),
      });
      await notifications?.notifyNewRequest(record);
      response.status(202).json({
        success: true,
        data: { message: 'Thanks. Your private beta request has been recorded.' },
      });
    }),
  );
  return router;
}
