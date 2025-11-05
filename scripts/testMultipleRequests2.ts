import fs from "fs";
import path from "path";
import hre from "hardhat";
const { ethers } = hre as any;

async function main() {
    // Switch to interval mining for this test
    console.log("Switching to interval mining...");
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_setIntervalMining", [3000]);
    
    // Mine some initial blocks
    await ethers.provider.send("hardhat_mine", ["0x5"]);
    
    const file = path.join(process.cwd(), "deploy-output.json");
    const { CONSUMER_ADDRESS } = JSON.parse(fs.readFileSync(file, "utf8"));

    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);
    const jobId = process.env.JOB_ID;

    console.log("=== Testing Multiple Requests ===\n");

    for (let i = 1; i <= 5; i++) {
        console.log(`--- Request ${i}/5 ---`);
        
        try {
            const tx = await consumer.requestTemperature("Szeged", jobId);
            
            // Mine a block to include the transaction
            await ethers.provider.send("hardhat_mine", ["0x1"]);
            
            const receipt = await tx.wait();
            console.log(`✅ Request sent, txHash: ${receipt.transactionHash}`);
            
            // Wait for fulfillment with timeout
            const fulfilled = await new Promise<boolean>((resolve) => {
                const requestId = consumer.interface.parseLog(
                    receipt.logs.find((log: any) => {
                        try {
                            return consumer.interface.parseLog(log).name === "RequestCreated";
                        } catch { return false; }
                    })
                ).args.requestId;

                const filter = consumer.filters.RequestFulfilled(requestId);
                const timeout = setTimeout(() => {
                    consumer.removeAllListeners(filter);
                    resolve(false);
                }, 30000);

                consumer.once(filter, async () => {
                    clearTimeout(timeout);
                    // Mine a block to confirm fulfillment
                    await ethers.provider.send("hardhat_mine", ["0x1"]);
                    resolve(true);
                });
            });

            if (fulfilled) {
                const temp = await consumer.temperature();
                console.log(`✅ Request fulfilled! Temperature: ${temp / 100}°C`);
            } else {
                console.log(`⚠️  Request timeout - check node logs`);
            }
        } catch (error: any) {
            console.error(`❌ Request failed:`, error.message);
        }

        // Wait between requests
        if (i < 5) {
            console.log("Waiting 5 seconds...\n");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
	// await ethers.provider.send("hardhat_mine", ["0x1"]);

    // Switch back to automining
    console.log("\nSwitching back to automining...");
    await ethers.provider.send("evm_setAutomine", [true]);
    await ethers.provider.send("evm_setIntervalMining", [0]);
}

main().catch(console.error);