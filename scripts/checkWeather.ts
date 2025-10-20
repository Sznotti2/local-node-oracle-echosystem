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
	const tx = await consumer.requestTemperature("Szeged", process.env.JOB_ID || "replace-with-your-job-id");
	const receipt = await tx.wait();
	console.log("Request transaction mined, txHash:", receipt.transactionHash);

	// try to extract requestId from event we emitted
	let requestId = "";
	for (const log of receipt.logs) {
		try {
			const parsed = consumer.interface.parseLog(log);
			if (parsed && parsed.name === "RequestCreated") {
				requestId = parsed.args.requestId;
				console.log("RequestCreated event -> requestId:", requestId);
				break;
			}
		} catch (e) {}
	}

	// wait for the request to be fulfilled
	console.log("Waiting for RequestFulfilled event...");
	await new Promise<void>(async (resolve, reject) => {
		const filter = consumer.filters.RequestFulfilled(requestId);
		const onFulfilled = (reqId: string, temperature: number) => {
			console.log(`RequestFulfilled event received for requestId ${reqId}\ntemperature=${temperature / 100}`);
			resolve();
		};

		// listen
		consumer.on(filter, onFulfilled);

		// timeout guard
		// const timeoutMs = 1 * 60 * 1000; // 1 minute
		const timeoutMs = 5 * 1000; // 5 seconds
		const timer = setTimeout(() => {
			try { consumer.off(filter, onFulfilled); } catch (e) {}
			reject(new Error(`Timeout waiting for RequestFulfilled for ${requestId}`));
		}, timeoutMs);
	});

	// read the stored temperature from the contract
	const temperature = await consumer.getTemperature();
	console.log("Current temperature in contract:", temperature / 100);
}
	
main().catch((err) => {
	console.error(err);
	process.exit(1);
});