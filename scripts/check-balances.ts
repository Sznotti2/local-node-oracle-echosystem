import fs from "fs";
import path from "path";
import hre from "hardhat";
const { ethers } = hre as any;


async function main() {
	// Read deployed contract addresses
	const file = path.join(process.cwd(), "deploy-output.json");
	if (!fs.existsSync(file)) throw new Error("deploy-output.json missing. Run deploy.ts first.");
	const { LINK_ADDRESS, OPERATOR_ADDRESS, CONSUMER_ADDRESS } = JSON.parse(fs.readFileSync(file, "utf8"));
	const link = await ethers.getContractAt("LinkToken", LINK_ADDRESS);
	const operator = await ethers.getContractAt("Operator", OPERATOR_ADDRESS);
	const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);
	const nodeWalletAddress = process.env.NODE_WALLET;

	// Show balances
  // Oracle Node wallet balances
  const nodeEthBalance = await ethers.provider.getBalance(nodeWalletAddress);
  const nodeLinkBalance = await link.balanceOf(nodeWalletAddress);
  console.log(`Node wallet ETH balance: ${ethers.utils.formatEther(nodeEthBalance)} ETH`);
  console.log(`Node wallet LINK balance: ${ethers.utils.formatUnits(nodeLinkBalance, 18)} LINK`);
  // ConsumerContract balances
  const consumerEthBalance = await ethers.provider.getBalance(consumer.address);
  const consumerLinkBalance = await link.balanceOf(consumer.address);
  console.log(`ConsumerContract ETH balance: ${ethers.utils.formatEther(consumerEthBalance)} ETH`);
  console.log(`ConsumerContract LINK balance: ${ethers.utils.formatUnits(consumerLinkBalance, 18)} LINK`);
  }
	
main().catch((err) => {
	console.error(err);
	process.exit(1);
});