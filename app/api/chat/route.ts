import { createGateway } from "@ai-sdk/gateway";
import { convertToModelMessages, streamText } from "ai";

const gatewayUrl = process.env.AI_GATEWAY_URL?.replace(/\/$/, "");

const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: gatewayUrl,
});

export async function POST(req: Request) {
  if (!process.env.AI_GATEWAY_API_KEY || !gatewayUrl) {
    return new Response(
      "Missing AI gateway configuration. Set AI_GATEWAY_URL and AI_GATEWAY_API_KEY.",
      { status: 500 }
    );
  }

  const { messages = [], model = "gpt-4o-mini" } = await req.json();

  const result = await streamText({
    model: gateway(model),
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
