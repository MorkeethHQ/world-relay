import { NextResponse } from "next/server";
import { isUmaEnabled, UMA_ORACLE_ADDRESS } from "@/lib/uma-oracle";
import { isAutomationEnabled, isFunctionsEnabled, AUTOMATION_REGISTRY_ADDRESS, FUNCTIONS_ROUTER_ADDRESS } from "@/lib/chainlink-automation";

export async function GET() {
  return NextResponse.json({
    uma: {
      enabled: isUmaEnabled(),
      oracleAddress: isUmaEnabled() ? UMA_ORACLE_ADDRESS : null,
      features: ["dispute-escalation", "optimistic-oracle", "bond-based-arbitration"],
    },
    chainlink: {
      automation: {
        enabled: isAutomationEnabled(),
        registryAddress: isAutomationEnabled() ? AUTOMATION_REGISTRY_ADDRESS : null,
        features: ["auto-expire-tasks", "auto-refund"],
      },
      functions: {
        enabled: isFunctionsEnabled(),
        routerAddress: isFunctionsEnabled() ? FUNCTIONS_ROUTER_ADDRESS : null,
        features: ["on-chain-verification", "decentralized-ai-verdict"],
      },
    },
    disputeFlow: {
      levels: [
        { level: 1, name: "AI Verification", description: "Multi-model consensus (Claude + GPT-4o + Gemini)", automated: true },
        { level: 2, name: "Follow-up Question", description: "AI asks claimant for clarification", automated: true },
        { level: 3, name: "Poster Decision", description: "Task poster approves or rejects manually", automated: false },
        { level: 4, name: "AI Mediation", description: "Claude Opus reviews full thread and evidence", automated: true },
        { level: 5, name: "UMA Oracle", description: "On-chain dispute with bonded arbitration", automated: false },
      ],
    },
  });
}
