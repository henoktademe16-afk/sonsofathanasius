import { z } from 'zod';

export const SearchQuerySchema = z.object({
  q: z
    .string({ message: 'Query parameter "q" is required' })
    .min(1, 'Query parameter "q" cannot be empty')
    .max(200, 'Search query is too long (max 200 characters)')
    .trim(),
  lang: z.enum(['am', 'en', 'om', 'ti']).default('am'),
  category: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQueryParams = z.infer<typeof SearchQuerySchema>;
