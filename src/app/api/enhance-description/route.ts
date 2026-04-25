import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT =
  "You are a task description optimizer for RELAY, an errand platform. Given a rough task description, rewrite it to be clear, specific, and actionable. Keep it under 200 characters. Include what to photograph/check, where exactly, and any specific details that will help the runner and the verification system. Return ONLY the enhanced description, nothing else.";

export async function POST(req: NextRequest) {
  try {
    const { description, category, location } = await req.json();

    if (!description) {
      return NextResponse.json({ enhanced: description ?? "" });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ enhanced: description });
    }

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20250414",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Category: ${category || "custom"}\nLocation: ${location || "unspecified"}\nDescription: ${description}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : description;

    return NextResponse.json({ enhanced: text });
  } catch {
    return NextResponse.json({ enhanced: "" });
  }
}
