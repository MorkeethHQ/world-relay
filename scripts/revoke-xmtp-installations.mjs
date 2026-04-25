import { Client } from "@xmtp/node-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(import.meta.dirname, "../.env.local") });

const walletKey = process.env.XMTP_WALLET_KEY?.trim();
if (!walletKey) {
  console.error("XMTP_WALLET_KEY not set");
  process.exit(1);
}

const cleaned = walletKey.replace(/[^0-9a-fA-Fx]/g, "");
const key = cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
const account = privateKeyToAccount(key);

const signer = {
  type: "EOA",
  getIdentifier: () => ({
    identifier: account.address.toLowerCase(),
    identifierKind: 0,
  }),
  signMessage: async (message) => {
    const sig = await account.signMessage({ message });
    return Buffer.from(sig.slice(2), "hex");
  },
};

const dbEncryptionKey = new Uint8Array(
  createHash("sha256").update(`xmtp-relay-db-key:${walletKey}`).digest()
);

// Try to reuse an existing DB file (avoids registering a new installation)
const existingDbPath = "/tmp/xmtp-relay-test.db";

console.log("Attempting to build XMTP client from existing DB:", existingDbPath);
console.log("Address:", account.address);

try {
  // Client.build reuses an existing installation without registering a new one
  const client = await Client.build(signer, {
    dbEncryptionKey,
    dbPath: existingDbPath,
    env: "production",
  });

  console.log("Connected via existing installation. Inbox:", client.inboxId);
  console.log("Revoking all other installations...");
  await client.revokeAllOtherInstallations();
  console.log("Done. Stale installations revoked.");
  console.log("Production bot should be able to connect now.");
  process.exit(0);
} catch (buildErr) {
  console.error("Client.build failed:", buildErr.message);
  console.log("\nTrying Client.create with existing DB path...");

  try {
    const client = await Client.create(signer, {
      dbEncryptionKey,
      dbPath: existingDbPath,
      env: "production",
    });
    console.log("Connected via create. Inbox:", client.inboxId);
    await client.revokeAllOtherInstallations();
    console.log("Revoked. Production bot should reconnect now.");
    process.exit(0);
  } catch (createErr) {
    console.error("Client.create also failed:", createErr.message);
    process.exit(1);
  }
}
