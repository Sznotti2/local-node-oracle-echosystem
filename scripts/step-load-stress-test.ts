import { ethers } from "hardhat";
import * as fs from "fs";
import { getEnvVariables, getRandomCity, RequestData, BatchResult, avg } from "../utils/helper";

const { CONSUMER_ADDRESS, JOB_ID, NUMBER_OF_NODES } = getEnvVariables();
const TEST_SCENARIOS = [
	{ batchSize: 1,    timeoutSecs: 5  },
	{ batchSize: 5,    timeoutSecs: 5  },
	{ batchSize: 10,   timeoutSecs: 10 },
	{ batchSize: 15,   timeoutSecs: 10 },
	{ batchSize: 20,   timeoutSecs: 12 },
	{ batchSize: 25,   timeoutSecs: 12 },
	{ batchSize: 50,   timeoutSecs: 15 },
	{ batchSize: 75,   timeoutSecs: 20 },
	{ batchSize: 100,  timeoutSecs: 25 },
	{ batchSize: 150,  timeoutSecs: 25 },
	{ batchSize: 200,  timeoutSecs: 30 },
	{ batchSize: 250,  timeoutSecs: 30 },
	{ batchSize: 500,  timeoutSecs: 30 },
	{ batchSize: 750,  timeoutSecs: 35 }, // Watch out! Beyond this point, RAM is nothing but a distant memory
	{ batchSize: 1000, timeoutSecs: 40 },
	{ batchSize: 1500, timeoutSecs: 50 },
	{ batchSize: 2000, timeoutSecs: 50 },
	{ batchSize: 2500, timeoutSecs: 60 },
	{ batchSize: 3000, timeoutSecs: 60 },
];
const COOLDOWN_SECONDS = 5;
const CHECK_INTERVAL_MS = 100;

async function runBatch(
	provider: any,
	signerAddress: any,
	consumer: any,
	scenario: { batchSize: number; timeoutSecs: number }
): Promise<BatchResult> {
	const { batchSize, timeoutSecs } = scenario;

	let startBlock = await provider.getBlockNumber();
	const burstStartTime = Date.now();

	let currentNonce = await provider.getTransactionCount(signerAddress, "latest");
	const txSendTimes = new Map<string, number>();
	const txPromises: Promise<void>[] = [];
	let sendErrors = 0;

	for (let i = 0; i < batchSize; i++) {
		const nonce = currentNonce++;
		const txPromise = consumer
			.requestTemperature(getRandomCity(), JOB_ID, {
				nonce, // bc all requests are sent in a tight loop, we need to manually manage nonces to avoid nonce conflicts
				gasPrice: ethers.parseUnits("1", "gwei"), // fixed gas price prevents estimation RPC calls
			})
			.then((tx: any) => txSendTimes.set(tx.hash, Date.now()))
			.catch(() => {
				sendErrors++;
			});
		txPromises.push(txPromise);
	}
	await Promise.all(txPromises);

	const sentCount = batchSize - sendErrors;
	console.log(`\nSent ${sentCount}/${batchSize} requests. Waiting for fulfillment...`);

	// POLLING & MEASUREMENT PHASE
	let elapsedTime = 0;
	const requestMap = new Map<string, RequestData>(); // requestId -> RequestData
	const createdTxHashes = new Set<string>();
	const pendingFulfillments = new Map<string, number>(); // requestId -> fulfilledAt timestamp, buffer for fulfillments seen before their creation event
	const fulfilledTxHashes = new Set<string>();
	const createdFilter = consumer.filters.RequestCreated();
	const fulfilledFilter = consumer.filters.RequestFulfilled();

	while (fulfilledTxHashes.size < sentCount && elapsedTime < timeoutSecs * 1000) {
		try {
			const currentBlock = await provider.getBlockNumber();

			if (currentBlock > startBlock) {
				const [createdEvents, fulfilledEvents] = await Promise.all([
					consumer.queryFilter(createdFilter, startBlock, currentBlock),
					consumer.queryFilter(fulfilledFilter, startBlock, currentBlock),
				]);

				// RequestCreated events
				for (const event of createdEvents) {
					const requestId = event.args.requestId;
					if (!requestMap.has(requestId)) {
						const sentTxAt = txSendTimes.get(event.transactionHash) ?? burstStartTime;
						const createdDetectedAt = Date.now();
						requestMap.set(requestId, { sentTxAt, createdDetectedAt });
						createdTxHashes.add(event.transactionHash);

						if (pendingFulfillments.has(requestId)) {
							requestMap.get(requestId)!.fulfilledAt = pendingFulfillments.get(requestId);
							pendingFulfillments.delete(requestId);
						}
					}
				}

				// RequestFulfilled events
				for (const event of fulfilledEvents) {
					const requestId = event.args.requestId;
					const data = requestMap.get(requestId);

					if (data && !data.fulfilledAt) {
						data.fulfilledAt = Date.now();
						fulfilledTxHashes.add(event.transactionHash);
					} else if (!data && !pendingFulfillments.has(requestId)) {
						pendingFulfillments.set(requestId, Date.now());
						fulfilledTxHashes.add(event.transactionHash);
					}
				}

				startBlock = currentBlock + 1; // queryFilter is end-inclusive
			}
		} catch (e: any) {
			console.warn(`Warning: Error during event polling - ${e}`);
		}

		await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
		elapsedTime = Date.now() - burstStartTime;
		process.stdout.write(
			`\rProcessing... (${fulfilledTxHashes.size}/${sentCount}), Elapsed: ${(elapsedTime / 1000).toFixed(1)}s`
		);
	}

	// Gas cost collection
	let totalRequestCost = 0n;
	let totalFulfillmentCost = 0n;
	const [requestReceipts, fulfillmentReceipts] = await Promise.all([
		Promise.all([...createdTxHashes].map((hash) => provider.getTransactionReceipt(hash))),
		Promise.all([...fulfilledTxHashes].map((hash) => provider.getTransactionReceipt(hash))),
	]);
	for (const r of requestReceipts) totalRequestCost += (r.gasUsed as bigint) * r.gasPrice;
	for (const r of fulfillmentReceipts) totalFulfillmentCost += (r.gasUsed as bigint) * r.gasPrice;

	// Statistics
	const endToEndLatencies: number[] = [];
	const oracleLatencies: number[] = [];
	let latestFulfillment = 0;

	requestMap.forEach((data) => {
		if (data.createdDetectedAt && data.fulfilledAt) {
			oracleLatencies.push(data.fulfilledAt - data.createdDetectedAt);
			endToEndLatencies.push(data.fulfilledAt - data.sentTxAt);
			if (data.fulfilledAt > latestFulfillment) latestFulfillment = data.fulfilledAt;
		}
	});

	const duration = latestFulfillment > burstStartTime
			? latestFulfillment - burstStartTime
			: elapsedTime;

	const successRate = sentCount > 0 ? (fulfilledTxHashes.size / sentCount) * 100 : 0;

	return {
		count: batchSize,
		successRate,
		avgNodeLatency: avg(oracleLatencies),
		avgLatency: avg(endToEndLatencies),
		duration,
		tps: duration > 0 ? fulfilledTxHashes.size / (duration / 1000) : 0,
		totalRequestCostETH: ethers.formatEther(totalRequestCost),
		totalFulfillmentCostETH: ethers.formatEther(totalFulfillmentCost),
	};
}

async function main() {
	console.log("==================================================");
	console.log("       AUTOMATED BREAKING POINT STRESS TEST       ");
	console.log("==================================================");

	const provider = ethers.provider;
	const signers = await ethers.getSigners();
	const signerAddress = signers[0].address;
	const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS as string);

	const allResults: BatchResult[] = [];
	for (let i = 0; i < TEST_SCENARIOS.length; i++) {
		const result = await runBatch(provider, signerAddress, consumer, TEST_SCENARIOS[i]);
		allResults.push(result);

		if (i < TEST_SCENARIOS.length - 1) {
			console.log(`\nCooldown period for ${COOLDOWN_SECONDS}s...`);
			await new Promise((r) => setTimeout(r, COOLDOWN_SECONDS * 1000));
		}
	}

	console.log("\n\n=== TEST RESULTS ===");
	console.log(
		"Requests".padStart(8), "| Success (%) |", "Duration (ms) |",
		"Avg E2E Latency (ms) |", "Avg Node Latency (ms) |", "  TPS |",
		"Request Cost (ETH)    |", "Node Cost (ETH)"
	);
	console.log("-".repeat(140));

	allResults.forEach((r) => {
		console.log(
			`${r.count.toString().padStart(8)} |` +
			`${r.successRate.toFixed(0).padStart(12)} |` +
			`${r.duration.toFixed(0).padStart(14)} |` +
			`${r.avgLatency.toFixed(0).padStart(21)} |` +
			`${r.avgNodeLatency.toFixed(0).padStart(22)} |` +
			`${r.tps.toFixed(0).padStart(6)} |` +
			` ${r.totalRequestCostETH.padEnd(22)}|` +
			` ${r.totalFulfillmentCostETH}`
		);
	});

	// Save results to CSV
	const csvHeader =
		"Config,Nodes,Requests,Success Rate (%),Duration (ms)," +
		"Avg E2E Latency (ms),Avg Node Latency (ms),TPS,Request Cost (ETH),Node Cost (ETH)\n";
	// !change Config per test run e.g. 'Base'
	const csvContent = allResults.map((r) =>
		`Complete,${NUMBER_OF_NODES},${r.count},${r.successRate.toFixed(0)},` +
		`${r.duration.toFixed(0)},${r.avgLatency.toFixed(0)},${r.avgNodeLatency.toFixed(0)},` +
		`${r.tps.toFixed(0)},${Number(r.totalRequestCostETH).toFixed(6)},` +
		`${Number(r.totalFulfillmentCostETH).toFixed(6)}`
	).join("\n") + "\n";

	fs.appendFileSync("stress_test_results.csv", csvHeader + csvContent);
	console.log("Results appended to stress_test_results.csv");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});