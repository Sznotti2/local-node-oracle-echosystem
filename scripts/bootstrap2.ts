// scripts/bootstrap.ts
import fs from "fs";
import path from "path";
import hre from "hardhat";
import { parseUnits } from "ethers/lib/utils";
const { ethers } = hre as any;

async function main() {
  const nodeWalletAddress = process.env.NODE_WALLET || "0x6373C5BE3B0CD642A3D734cd26414E99C5A03185";
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Deploy LinkToken
  const LinkToken = await ethers.getContractFactory("LinkToken");
  const link = await LinkToken.deploy();
  await link.deployed();
  console.log("LinkToken:", link.address);

  // Deploy Operator
  const Operator = await ethers.getContractFactory("Operator");
  const operator = await Operator.deploy(link.address, deployer.address);
  await operator.deployed();
  console.log("Operator:", operator.address);

  // Authorize node sender
  const txAuth = await operator.setAuthorizedSenders([nodeWalletAddress]);
  await txAuth.wait();
  console.log("Authorized sender set:", nodeWalletAddress);

  // Fund node with ETH
  const txEth = await deployer.sendTransaction({
    to: nodeWalletAddress,
    value: ethers.utils.parseEther("5"),
  });
  await txEth.wait();
  console.log("Node wallet funded with 5 ETH");

  // Check deployer LINK balance (after deploy — LinkToken implementations often mint to deployer)
  const decimals = 18;
  let deployerLinkBalance = await link.balanceOf(deployer.address);
  console.log("Deployer LINK balance:", ethers.utils.formatUnits(deployerLinkBalance, decimals));

  // Ensure we have enough LINK to fund node. If not, increase amount or fail loudly.
  const needed = ethers.utils.parseUnits("10", decimals); // szükséges mennyiség, módosíthatod
  if (deployerLinkBalance.lt(needed)) {
    console.warn("Deployer LINK balance is low. Current:", ethers.utils.formatUnits(deployerLinkBalance, decimals));
    // Option A: if LinkToken has no mint, you must redeploy a LinkToken that mints to deployer or change logic.
    // For now, we'll try to transfer whatever we have (fail early if zero)
	const grantRoleTx = await link.grantMintRole(deployer.address);
	await grantRoleTx.wait();
	const minters = await link.getMinters();
	console.log("Current minters:", minters);
	const mintTx = await link.mint(deployer.address, ethers.utils.parseUnits("100", 18));
	await mintTx.wait();
	deployerLinkBalance = await link.balanceOf(deployer.address);
  }
  // Transfer X LINK to node (use needed or less if deployer has less)
  const amountToSend = deployerLinkBalance.gt(needed) ? needed : deployerLinkBalance;
  if (amountToSend.isZero()) {
    throw new Error("Deployer has 0 LINK — cannot fund node. Check LinkToken implementation.");
  }
  const txLink = await link.transfer(nodeWalletAddress, amountToSend);
  await txLink.wait();
  console.log("Node wallet funded with", ethers.utils.formatUnits(amountToSend, decimals), "LINK");

  // Show balances
  const nodeLinkBalance = await link.balanceOf(nodeWalletAddress);
  const nodeEthBalance = await ethers.provider.getBalance(nodeWalletAddress);
  console.log(`Node wallet ETH balance: ${ethers.utils.formatEther(nodeEthBalance)} ETH`);
  console.log(`Node wallet LINK balance: ${ethers.utils.formatUnits(nodeLinkBalance, decimals)} LINK`);

  const out = {
    LINK_ADDRESS: link.address,
    OPERATOR_ADDRESS: operator.address,
  };
  fs.writeFileSync(path.join(process.cwd(), "deploy-output.json"), JSON.stringify(out, null, 2));
  console.log("Wrote deploy-output.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
