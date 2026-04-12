import { BaseBridge } from "@/bridges/BaseBridge";
import { ApprovalService } from "@/services";

export class ApprovalBridge extends BaseBridge {
  constructor(private approvalService: ApprovalService) {
    super();
  }

  setupHandlers(): void {
    // Renderer sends approval decision for a pending plan
    this.handle<
      { planId: string; decision: "approved" | "rejected" },
      void
    >("approval:respond", async (_, { planId, decision }) => {
      this.approvalService.resolve(planId, decision);
    });
  }
}
