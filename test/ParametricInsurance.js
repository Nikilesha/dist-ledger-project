const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ParametricInsurance", function () {
  async function deploySystem() {
    const [owner, user, oracle1, oracle2, oracle3] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("LiquidityVault");
    const vault = await Vault.deploy();
    const Protocol = await ethers.getContractFactory("ParametricInsurance");
    const protocol = await Protocol.deploy(await vault.getAddress(), [oracle1.address, oracle2.address, oracle3.address], 2);
    await vault.setProtocol(await protocol.getAddress());
    await vault.connect(owner).deposit({ value: ethers.parseEther("10") });
    return { owner, user, oracle1, oracle2, oracle3, vault, protocol };
  }

  it("pays automatically after two verified flight reports exceed the threshold", async function () {
    const { user, oracle1, oracle2, protocol, vault } = await deploySystem();
    await protocol.connect(user).createPolicy("AI 101", 0, 180, ethers.parseEther("1"), { value: ethers.parseEther("0.05") });
    const vaultBefore = await ethers.provider.getBalance(await vault.getAddress());
    await protocol.connect(oracle1).submitOracleData(0, 240);
    await protocol.connect(oracle2).submitOracleData(0, 240);
    const policy = await protocol.getPolicy(0);
    expect(policy.status).to.equal(1n); // Paid
    expect(policy.verifiedValue).to.equal(240n);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(vaultBefore - ethers.parseEther("1"));
  });

  it("resolves with no payout when weather score stays below the threshold", async function () {
    const { user, oracle1, oracle2, protocol, vault } = await deploySystem();
    await protocol.connect(user).createPolicy("Mumbai storm", 1, 80, ethers.parseEther("1"), { value: ethers.parseEther("0.05") });
    const before = await ethers.provider.getBalance(await vault.getAddress());
    await protocol.connect(oracle1).submitOracleData(0, 55);
    await protocol.connect(oracle2).submitOracleData(0, 60);
    const policy = await protocol.getPolicy(0);
    expect(policy.status).to.equal(2n); // NoPayout
    expect(policy.verifiedValue).to.equal(57n);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(before);
  });

  it("rejects duplicate reports and unauthorised oracle calls", async function () {
    const { owner, user, oracle1, protocol } = await deploySystem();
    await protocol.connect(user).createPolicy("SG 500", 0, 100, ethers.parseEther("1"), { value: ethers.parseEther("0.05") });
    await protocol.connect(oracle1).submitOracleData(0, 120);
    await expect(protocol.connect(oracle1).submitOracleData(0, 120)).to.be.revertedWith("This oracle already reported");
    await expect(protocol.connect(owner).submitOracleData(0, 120)).to.be.revertedWith("Only oracle");
  });
});
