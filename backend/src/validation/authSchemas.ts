import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email();
export const usernameSchema = z.string().trim().min(1).max(30);
const passwordSchema = z.string().min(8).max(256);

const createHouseholdSchema = z.object({
  mode: z.literal('create'),
  name: z.string().trim().min(1).max(100),
});

const joinHouseholdSchema = z.object({
  mode: z.literal('join'),
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z-]{4,12}$/),
});

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  household: z.discriminatedUnion('mode', [createHouseholdSchema, joinHouseholdSchema]),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const emailAvailabilityQuerySchema = z.object({
  email: emailSchema,
});

export const usernameAvailabilityQuerySchema = z.object({
  username: usernameSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
