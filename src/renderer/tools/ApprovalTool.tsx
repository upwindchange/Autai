import { makeAssistantTool, tool } from "@assistant-ui/react";
import { z } from "zod";
import { useState } from "react";

export const ApprovalTool = makeAssistantTool({
  ...tool({
    description: "Request user approval for an action",
    parameters: z.object({
      action: z.string(),
      details: z.any(),
    }),
    execute: async ({ action, details }, { human }) => {
      // Request approval from user
      const response = await human({ action, details });

      return {
        approved: response.approved,
        reason: response.reason,
      };
    },
  }),
  toolName: "requestApproval",
  render: ({ args, result, interrupt, resume }) => {
    const [reason, setReason] = useState("");

    // Show result after approval/rejection
    if (result) {
      return (
        <div className={result.approved ? "text-green-600" : "text-red-600"}>
          {result.approved ? "✅ Approved" : `❌ Rejected: ${result.reason}`}
        </div>
      );
    }

    // Show approval UI when waiting for user input
    if (interrupt) {
      return (
        <div className="rounded border-2 border-yellow-400 p-4">
          <h4 className="font-bold">Approval Required</h4>
          <p className="my-2">{interrupt.payload.action}</p>
          <pre className="rounded bg-gray-100 p-2 text-sm">
            {JSON.stringify(interrupt.payload.details, null, 2)}
          </pre>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => resume({ approved: true })}
              className="rounded bg-green-500 px-4 py-2 text-white"
            >
              Approve
            </button>
            <button
              onClick={() => resume({ approved: false, reason })}
              className="rounded bg-red-500 px-4 py-2 text-white"
            >
              Reject
            </button>
            <input
              type="text"
              placeholder="Rejection reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex-1 rounded border px-2"
            />
          </div>
        </div>
      );
    }

    return <div>Processing...</div>;
  },
});
