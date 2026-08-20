import { z } from 'zod';

export const ContactFormSchema = z.object({
  name: z
    .string({ required_error: 'Name is required', invalid_type_error: 'Name must be a string' })
    .trim()
    .min(1, 'Name must be at least 1 character')
    .max(100, 'Name must be at most 100 characters')
    .refine((val) => val.trim().length > 0, 'Name cannot be empty or whitespace only'),
  email: z
    .string({ required_error: 'Email is required', invalid_type_error: 'Email must be a string' })
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255, 'Email must be at most 255 characters'),
  subject: z
    .string()
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(200, 'Subject must be at most 200 characters')
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  message: z
    .string({ required_error: 'Message is required', invalid_type_error: 'Message must be a string' })
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(5000, 'Message must be at most 5000 characters')
    .refine((val) => val.trim().length >= 10, 'Message must be at least 10 characters of text'),
  website: z.string().optional(), // Honeypot field for bot detection
});

export type ContactFormData = z.infer<typeof ContactFormSchema>;