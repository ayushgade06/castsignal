// Shared input shapes (client + server). Zod is the allowlist at the API boundary.
import { z } from "zod";
import { SEGMENTS } from "./scoring";

const name = z.string().trim().min(1).max(80);
// A user (or a prior run) may pin a name to a specific Qloo entity id.
const Pin = z.object({ name, id: z.string().regex(/^[0-9A-Fa-f-]{36}$/) });

export const BriefSchema = z.object({
  title: z.string().trim().min(1).max(120),
  logline: z.string().trim().max(500).default(""),
  comps: z.array(name).min(1).max(5),
  targets: z.array(z.enum(SEGMENTS)).max(8).default([]),
  roles: z
    .array(z.object({ role: z.string().trim().min(1).max(60), candidates: z.array(name).min(1).max(6) }))
    .min(1)
    .max(3),
  wildcards: z.boolean().default(true),
  pins: z.array(Pin).max(40).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export const ConstraintsInputSchema = z.object({
  mustInclude: z.array(name).max(6).default([]),
  exclude: z.array(name).max(12).default([]),
  maxAListers: z.number().int().min(0).max(3).nullable().default(null),
  fitFloor: z.number().min(0.5).max(1).default(0.9),
});
export type ConstraintsInput = z.infer<typeof ConstraintsInputSchema>;

export const RunRequestSchema = z.object({
  brief: BriefSchema,
  constraints: ConstraintsInputSchema.default({ mustInclude: [], exclude: [], maxAListers: null, fitFloor: 0.9 }),
  refine: z.string().trim().max(300).optional(),
  previousEnsemble: z.array(z.object({ role: z.string().max(60), name: z.string().max(80).nullable() })).max(3).optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const SAMPLE_BRIEF: Brief = {
  title: "House Rules",
  logline:
    "A social-thriller horror comedy: a newly engaged woman spends a weekend at her fiancé's family estate and realizes the family's charming traditions are a trap.",
  comps: ["Get Out", "Barbarian", "Ready or Not"],
  targets: [],
  roles: [
    { role: "Lead", candidates: ["Jenna Ortega", "Florence Pugh", "Daniel Kaluuya", "Bad Bunny", "Pete Davidson"] },
    { role: "Comedic best friend", candidates: ["Ayo Edebiri", "Awkwafina", "Bowen Yang", "Rachel Sennott"] },
  ],
  wildcards: true,
  pins: [],
};
