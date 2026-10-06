const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer, oracleOne, oracleTwo, oracleThree] = await hre.ethers.getSigners();
  const Vault = await hre.ethers.getContractFactory("LiquidityVault");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();

  const Protocol = await hre.ethers.getContractFactory("ParametricInsurance");
  const protocol = await Protocol.deploy(await vault.getAddress(), [oracleOne.address, oracleTwo.address, oracleThree.address], 2);
  await protocol.waitForDeployment();
  await (await vault.setProtocol(await protocol.getAddress())).wait();

  const addresses = { protocol: await protocol.getAddress(), vault: await vault.getAddress(), chainId: 31337 };
  fs.writeFileSync(path.join(__dirname, "../frontend/src/contract-address.json"), JSON.stringify(addresses, null, 2));
  fs.writeFileSync(path.join(__dirname, "../oracle/oracle-config.json"), JSON.stringify({
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    protocolAddress: addresses.protocol,
    // Hardhat's publicly documented local development keys only. Never use these on a real network.
    mnemonic: "test test test test test test test test test test test junk"
  }, null, 2));
  console.log("Protocol:", addresses.protocol);
  console.log("Vault:", addresses.vault);
  console.log("Deployment files written for frontend and oracle.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
