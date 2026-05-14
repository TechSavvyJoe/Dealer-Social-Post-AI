import { z } from "zod";

export const DealerSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  logo: z.string().optional().nullable(),
  code: z.string().optional().nullable(),
});

export type DealerZodType = z.infer<typeof DealerSchema>;

export const PocketBaseRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string().optional(),
  collectionName: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
});

export const DealerRecordSchema = PocketBaseRecordSchema.extend({
  name: z.string(),
  logo: z.string().optional().nullable(),
  code: z.string().optional().nullable(),
});

// Used to strictly validate Veo 3.1 polling response to prevent unstructured JSON crashes
export const GeminiVideoOperationSchema = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
  response: z.any().optional(), // The response can have varying structures (e.g. generateVideoResponse)
});
