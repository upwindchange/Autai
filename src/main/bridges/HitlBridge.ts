import { BaseBridge } from "@/bridges/BaseBridge";
import { HitlService } from "@/services";

export class HitlBridge extends BaseBridge {
  constructor(private hitlService: HitlService) {
    super();
  }

  setupHandlers(): void {
    // Renderer sends response for a pending HITL request
    this.handle<{ id: string; response: unknown }, void>(
      "hitl:respond",
      async (_, { id, response }) => {
        this.hitlService.respond(id, response);
      },
    );
  }
}
