import { SEARCH_PLACE_TOOL, executeProviderTool } from "./toolDefinitions.js";

export interface GeminiToolDefinition {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface GeminiToolExecutionContext {
  name: string;
  args: Record<string, unknown>;
}

export function getGeminiVerificationTools(): GeminiToolDefinition[] {
  return [
    {
      functionDeclarations: [SEARCH_PLACE_TOOL],
    },
  ];
}

export async function executeGeminiTool({
  name,
  args,
}: GeminiToolExecutionContext): Promise<Record<string, unknown>> {
  return executeProviderTool(name, args, "geminiTools");
}
