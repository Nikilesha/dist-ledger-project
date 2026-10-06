/* Replace getMockMeasurements with adapters for Chainlink, aviation APIs, or weather APIs later. */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const config = require("./oracle-config.json");
const abi = require("../frontend/src/contractAbi.json");

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function getMockMeasurements(value) {
  // Three separate simulated sources. In a real version each would call a separate API.
  return [value, value + 2, value - 1];
}

async function main() {
  const policyId = Number(option("policy", "0"));
  const value = Number(option("value", "240"));
  const selectedNode = option("nodes", "both");
  if (!Number.isInteger(policyId) || !Number.isInteger(value) || value < 0) throw new Error("Use integer --policy and --value");
  if (!["1", "2", "both"].includes(selectedNode)) throw new Error("Use --nodes 1, --nodes 2, or omit it for both nodes");
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const readings = getMockMeasurements(value);
  const nodesToRun = selectedNode === "both" ? [0, 1] : [Number(selectedNode) - 1];
  for (const i of nodesToRun) { // two-of-three consensus is enough for this prototype
    const signer = ethers.HDNodeWallet.fromPhrase(config.mnemonic, undefined, `m/44'/60'/0'/0/${i + 1}`).connect(provider);
    const contract = new ethers.Contract(config.protocolAddress, abi, signer);
    try {
      const tx = await contract.submitOracleData(policyId, readings[i]);
      console.log(`Oracle node ${i + 1} sent ${readings[i]}. Tx: ${tx.hash}`);
      await tx.wait();
    } catch (error) {
      // Makes the demo command safe to run again when one simulated node already reported.
      if ((error.shortMessage || error.message).includes("This oracle already reported")) {
        console.log(`Oracle node ${i + 1} already reported; skipping it.`);
      } else {
        throw error;
      }
    }
  }
  console.log("Verification completed. Check the policy in the DApp.");
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
