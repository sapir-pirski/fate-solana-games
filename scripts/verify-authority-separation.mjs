import { readFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/verify-authority-separation.mjs <authority-manifest.json>");
const manifest = JSON.parse(await readFile(path, "utf8"));
if (manifest.network !== "devnet") throw new Error("Only a devnet authority manifest may be verified before external audit and licensing.");
if (!Number.isInteger(manifest.minimumThreshold) || !Number.isInteger(manifest.memberCount) || manifest.minimumThreshold < 2 || manifest.memberCount < 3 || manifest.minimumThreshold > manifest.memberCount) throw new Error("Multisig threshold/member policy is invalid.");

const roles = ["upgradeAuthority", "configAuthority", "pauseAuthority", "treasury", "deploymentIdentity"];
const addresses = roles.map((role) => {
  const value = String(manifest[role] ?? "");
  if (value.startsWith("replace-with-")) throw new Error(`${role} is still a placeholder.`);
  return [role, new PublicKey(value).toBase58()];
});
if (new Set(addresses.map(([, address]) => address)).size !== addresses.length) throw new Error("Every authority role must use a distinct address.");
if (addresses.some(([, address]) => address === manifest.programId)) throw new Error("An authority cannot equal the program ID.");

console.log(JSON.stringify({ status: "ok", network: manifest.network, threshold: `${manifest.minimumThreshold}-of-${manifest.memberCount}`, authorities: Object.fromEntries(addresses) }, null, 2));
