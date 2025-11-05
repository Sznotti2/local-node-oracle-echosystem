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

    console.log("=== Contract Addresses ===");
    console.log("LINK:", LINK_ADDRESS);
    console.log("Operator:", OPERATOR_ADDRESS);
    console.log("Consumer:", CONSUMER_ADDRESS);

    const nodeAddress = await operator.owner();
    console.log("\n=== Node Configuration ===");
    console.log("Node Operator Address:", nodeAddress);

    // Check if node is authorized
    const isAuthorized = await operator.isAuthorizedSender(nodeAddress);
    console.log("Node is authorized sender:", isAuthorized);

    // Check balances
    console.log("\n=== Balances ===");
    console.log("Consumer LINK:", ethers.utils.formatEther(await link.balanceOf(CONSUMER_ADDRESS)), "LINK");
    console.log("Operator LINK:", ethers.utils.formatEther(await link.balanceOf(OPERATOR_ADDRESS)), "LINK");
    console.log("Node ETH:", ethers.utils.formatEther(await ethers.provider.getBalance(nodeAddress)), "ETH");

    // Check recent requests
    console.log("\n=== Last Request Info ===");
    const lastRequestId = await consumer.lastRequestId();
    console.log("Last Request ID:", lastRequestId);
    
    const temperature = await consumer.temperature();
    console.log("Current Temperature:", temperature.toString(), `(${temperature / 100}°C)`);

    // Get fee info
    const fee = await consumer.fee();
    console.log("\n=== Fee Configuration ===");
    console.log("Request Fee:", ethers.utils.formatEther(fee), "LINK");
    
    const consumerBalance = await link.balanceOf(CONSUMER_ADDRESS);
    const remainingRequests = consumerBalance.div(fee);
    console.log("Remaining possible requests:", remainingRequests.toString());
}

main().catch(console.error);