import fs from "fs";
import path from "path";
import hre from "hardhat";
const { ethers } = hre as any;


async function main() {
	// Read deployed contract addresses
	const file = path.join(process.cwd(), "deploy-output.json");
	if (!fs.existsSync(file)) throw new Error("deploy-output.json missing. Run deploy.ts first.");
	const { LINK_ADDRESS, OPERATOR_ADDRESS, CONSUMER_ADDRESS } = JSON.parse(fs.readFileSync(file, "utf8"));
	// console.log("Read from deploy-output.json:", { LINK_ADDRESS, OPERATOR_ADDRESS, CONSUMER_ADDRESS });

	// Request temperature from the oracle via the consumer contract
	const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);
	const tx = await consumer.requestTemperature("Szeged", process.env.JOB_ID);
	const receipt = await tx.wait();
	console.log("Request transaction mined, txHash:", receipt.transactionHash);

	
    // Check for OracleRequest event on Operator contract
    let requestId = "";
    for (const log of receipt.logs) {
        try {
            // Try parsing with Operator interface
            const operator = await ethers.getContractAt("OperatorContract", OPERATOR_ADDRESS);
            const parsed = operator.interface.parseLog(log);
            if (parsed && parsed.name === "OracleRequest") {
                console.log("✅ OracleRequest event found on Operator contract");
                console.log("   specId:", parsed.args.specId);
                console.log("   requestId:", parsed.args.requestId);
                requestId = parsed.args.requestId;
            }
        } catch (e) {}
        
        try {
            // Also check Consumer events
            const parsed = consumer.interface.parseLog(log);
            if (parsed && parsed.name === "RequestCreated") {
                requestId = parsed.args.requestId;
                console.log("RequestCreated event -> requestId:", requestId);
            }
        } catch (e) {}
    }

    if (!requestId) {
        console.error("❌ No request events found!");
        return;
    }

    console.log("Waiting for RequestFulfilled event...");
    await new Promise<void>(async (resolve, reject) => {
        const filter = consumer.filters.RequestFulfilled(requestId);
        const onFulfilled = (reqId: string, temperature: number) => {
            console.log(`RequestFulfilled event received for requestId ${reqId}\ntemperature=${temperature / 100}`);
            resolve();
        };

        consumer.on(filter, onFulfilled);

        const timeoutMs = 20 * 1000;
        const timer = setTimeout(() => {
            try { consumer.off(filter, onFulfilled); } catch (e) {}
            reject(new Error(`Timeout waiting for RequestFulfilled for ${requestId}`));
        }, timeoutMs);
    });

    const temperature = await consumer.temperature();
    console.log("Current temperature in contract:", temperature / 100);
}
	
main().catch((err) => {
	console.error(err);
	process.exit(1);
});