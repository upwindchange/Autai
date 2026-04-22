import { z } from "zod";
import { ToolUIIdSchema, ToolUIRoleSchema } from "../shared/schema";
import { defineToolUiContract } from "../shared/contract";

export const InputCardDecisionSchema = z.enum(["submitted", "cancelled"]);

export type InputCardDecision = z.infer<typeof InputCardDecisionSchema>;

export const SerializableInputCardSchema = z.object({
  id: ToolUIIdSchema,
  role: ToolUIRoleSchema.optional(),

  question: z.string().min(1),
  context: z.string().optional(),
  placeholder: z.string().optional(),
  buttonLabel: z.string().optional(),

  choice: InputCardDecisionSchema.optional(),
  answer: z.string().optional(),
});

export type SerializableInputCard = z.infer<typeof SerializableInputCardSchema>;

const contract = defineToolUiContract("InputCard", SerializableInputCardSchema);

export const parseSerializableInputCard: (
  input: unknown,
) => SerializableInputCard = contract.parse;

export const safeParseSerializableInputCard: (
  input: unknown,
) => SerializableInputCard | null = contract.safeParse;

export interface InputCardProps extends SerializableInputCard {
  className?: string;
  onSubmit?: (answer: string) => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}
