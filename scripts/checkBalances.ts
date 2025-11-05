import fs from "fs";
import path from "path";
import hre from "hardhat";
const { ethers } = hre as any;

async function main() {
    const file = path.join(process.cwd(), "deploy-output.json");
    const { LINK_ADDRESS, OPERATOR_ADDRESS, CONSUMER_ADDRESS } = JSON.parse(fs.readFileSync(file, "utf8"));

    const link = await ethers.getContractAt("LinkToken", LINK_ADDRESS);
    const operator = await ethers.getContractAt("Operator", OPERATOR_ADDRESS);
    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);

    // Check LINK balances
    const consumerLink = await link.balanceOf(CONSUMER_ADDRESS);
    const operatorLink = await link.balanceOf(OPERATOR_ADDRESS);
    
    // Check ETH balances
    const operatorEth = await ethers.provider.getBalance(OPERATOR_ADDRESS);
    const nodeAddress = await operator.owner(); // Get node operator address
    const nodeEth = await ethers.provider.getBalance(nodeAddress);

    console.log("=== Balances ===");
    console.log("Consumer LINK:", ethers.utils.formatEther(consumerLink), "LINK");
    console.log("Operator LINK:", ethers.utils.formatEther(operatorLink), "LINK");
    console.log("Operator ETH:", ethers.utils.formatEther(operatorEth), "ETH");
    console.log("Node Operator Address:", nodeAddress);
    console.log("Node ETH:", ethers.utils.formatEther(nodeEth), "ETH");
    
    // Check if consumer has approved operator
    const allowance = await link.allowance(CONSUMER_ADDRESS, OPERATOR_ADDRESS);
    console.log("Consumer LINK allowance for Operator:", ethers.utils.formatEther(allowance), "LINK");
}

main().catch(console.error);