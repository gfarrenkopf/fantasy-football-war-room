import type { ModelRequest, ModelResponse, PlanModel } from "../provider";

/** A scripted PlanModel for tests. Records every request; `respond` returns the response or throws. */
export function createFakePlanModel(respond: (request: ModelRequest) => ModelResponse | Promise<ModelResponse>) {
  const calls: ModelRequest[] = [];
  const model: PlanModel & { calls: ModelRequest[] } = {
    provider: "fake",
    model: "fake-1",
    calls,
    async generate(request) {
      calls.push(request);
      return respond(request);
    },
  };
  return model;
}
