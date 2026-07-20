import { z } from "zod";
import { PublicPlanSlugSchema } from "./index.js";

export const WooviCheckoutRequestSchema = z.object({
  plan: PublicPlanSlugSchema,
  couponCode: z.string().trim().toUpperCase().min(3).max(32).regex(/^[A-Z0-9_-]+$/).optional(),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().email().max(180),
    phone: z.string().trim().min(10).max(20),
    taxID: z.string().trim().regex(/^\d{11}$|^\d{14}$/, "Informe CPF ou CNPJ somente com números."),
    address: z.object({
      zipcode: z.string().trim().regex(/^\d{8}$/, "Informe o CEP somente com números."),
      street: z.string().trim().min(3).max(180),
      number: z.string().trim().min(1).max(30),
      neighborhood: z.string().trim().min(2).max(100),
      city: z.string().trim().min(2).max(100),
      state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
      complement: z.string().trim().max(100).optional().default(""),
    }),
  }),
});
export type WooviCheckoutRequest = z.infer<typeof WooviCheckoutRequestSchema>;

export const WooviCheckoutResponseSchema = z.object({
  subscriptionId: z.string(),
  correlationID: z.string(),
  paymentLinkUrl: z.string().url(),
  emv: z.string(),
  status: z.string(),
  pixRecurringStatus: z.string(),
  discount: z.object({
    code: z.string(),
    originalPriceCents: z.number().int().nonnegative(),
    finalPriceCents: z.number().int().positive(),
    savedCents: z.number().int().nonnegative(),
  }).optional(),
});
export type WooviCheckoutResponse = z.infer<typeof WooviCheckoutResponseSchema>;
