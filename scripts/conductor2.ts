// npx hardhat run scripts/conductor.ts --network localhost
import { ethers } from "hardhat";

async function main() {
	const [deployer] = await ethers.getSigners();
	console.log("Deployer:", deployer.address);

	// 1) Deploy LinkToken
	const LinkToken = await ethers.getContractFactory("LinkToken");
	const link = await LinkToken.deploy();
	await link.deployed();
	console.log("LinkToken:", link.address);

	// 2) Deploy Operator (Chainlink's Operator contract)
	const Operator = await ethers.getContractFactory("Operator");
	const operator = await Operator.deploy(link.address, deployer.address);
	await operator.deployed();
	console.log("Operator:", operator.address);

	// 3) Prepare jobId (change as needed to match a job on your local Chainlink node)
	const jobId = ethers.utils.formatBytes32String(process.env.JOB_ID || "weather-api");


	// 4) Deploy ConsumerContract
	const ConsumerContract = await ethers.getContractFactory("ConsumerContract");
	const consumer = await ConsumerContract.deploy(link.address, operator.address, jobId);
	await consumer.deployed();
	console.log("ConsumerContract:", consumer.address);


	// 5) Fund the consumer with LINK so it can make requests
	const fundAmount = ethers.utils.parseUnits("1", 18);
	let tx = await link.transfer(consumer.address, fundAmount);
	await tx.wait();
	console.log(`Funded consumer with ${fundAmount.toString()} LINK`);


	// 6) Optionally fund the Chainlink node operator address (if you have it)
	// Provide NODE_ADDRESS env var if you want the deployer to transfer LINK to the node's address
	const nodeAddress = process.env.NODE_ADDRESS;
	if (nodeAddress) {
		tx = await link.transfer(nodeAddress, fundAmount);
		await tx.wait();
		console.log(`Funded Chainlink node address ${nodeAddress} with LINK`);
	}


	// 7) Make a request to the oracle
	console.log("Submitting request for city: New York");
	const txRequest = await consumer.requestTemperature("New York");
	const receipt = await txRequest.wait();
	console.log("Request transaction mined, txHash:", receipt.transactionHash);


	// Try to parse the RequestCreated event we emit in contract to get the requestId
	const iface = consumer.interface;
	for (const log of receipt.logs) {
		try {
			const parsed = iface.parseLog(log);
			if (parsed && parsed.name === "RequestCreated") {
				console.log("RequestCreated event -> requestId:", parsed.args.requestId);
			}
		} catch (e) {
			// not our log
		}
	}


	console.log("Deployment & request flow complete. Now wait for your Chainlink node to pick up the event and fulfill the request.");
}


main().catch((err) => {
	console.error(err);
	process.exit(1);
});