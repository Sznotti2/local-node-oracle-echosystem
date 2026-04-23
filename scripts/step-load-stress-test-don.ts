import { ethers } from "hardhat";
import * as fs from 'fs';
import { getEnvVariablesDon, getRandomCity, RequestData, BatchResult } from "../utils/helper";


const { CONSUMER_ADDRESS, JOB_IDS, NUMBER_OF_NODES } = getEnvVariablesDon();

const TEST_SCENARIOS = [
	10,
	15,
	20,
	25,
	50,
	75,
	100,
	150,
	200,
	250, 
	500,
	750, // careful with these!
	1000, 
	1500,
	2000, 
	3000,
];
const TIMEOUT_FOR_BATCH = [
	10,
	10,
	12,
	12,
	14,
	16,
	18,
	18,
	18,
	20,
	22,
	22,
	24, 
	24,
	28, 
	30,
];

const COOLDOWN_SECONDS = 5;
async function runBatch(requestCount: number, consumer: any, provider: any): Promise<BatchResult> {
	const startBlock = await provider.getBlockNumber();
	const requestMap = new Map<string, RequestData>();
	
	let totalRequestCost = 0n;
	let totalFulfillmentCost = 0n;
	const processedTxHashes = new Set<string>(); 
	
	// SENDING PHASE 
	const txPromises = [];
	let sendErrors = 0;
	const signers = await ethers.getSigners();
	let currentNonce = await provider.getTransactionCount(signers[0].address);
	const burstStartTime = Date.now();
	
	for (let i = 0; i < requestCount; i++) {
		const jobId = JOB_IDS![i % JOB_IDS!.length];

		const txPromise = consumer.requestTemperature(getRandomCity(), jobId, { 
			nonce: currentNonce++,
			gasLimit: 500000 
		}).catch((e: any) => {
			sendErrors++;
			console.error(`\n[Send Error] Nonce: ${currentNonce - 1} | Message: ${e.shortMessage || e.message}`);
		});
		txPromises.push(txPromise);
	}

	await Promise.all(txPromises);
	console.log(`\nAll ${requestCount} requests sent. Measuring execution...`);

	// POLLING & MEASUREMENT PHASE
	let receivedCount = 0;
	let elapsedTime = 0;
	let batchCounter = 0;
	const checkInterval = 20; //TODO: tweak this and see how the results change
	const dynamicTimeout = TIMEOUT_FOR_BATCH[batchCounter] * 1000; 
	
	const createdFilter = consumer.filters.RequestCreated();
	const fulfilledFilter = consumer.filters.RequestFulfilled();

	while (receivedCount < (requestCount - sendErrors) && elapsedTime < dynamicTimeout) {
		try {
			const currentBlock = await provider.getBlockNumber();
			const now = Date.now();
			
			// RequestCreated events
			const createdEvents = await consumer.queryFilter(createdFilter, startBlock, currentBlock);
			for (const event of createdEvents) {
				const args = (event as any).args;
				const requestId = args.requestId;
				
				if (!requestMap.has(requestId)) {
					requestMap.set(requestId, {
						sendTime: burstStartTime, 
						createdTime: now, // accurate to the nearest 20ms polling tick
						isComplete: false
					});

					if (!processedTxHashes.has(event.transactionHash)) {
						const receipt = await provider.getTransactionReceipt(event.transactionHash);
						totalRequestCost += (receipt.gasUsed as bigint) * (receipt.gasPrice as bigint);
						processedTxHashes.add(event.transactionHash);
					}
				}
			}

			// RequestFulfilled events
			const fulfilledEvents = await consumer.queryFilter(fulfilledFilter, startBlock, currentBlock);
			for (const event of fulfilledEvents) {
				const args = (event as any).args;
				const requestId = args.requestId;
				let data = requestMap.get(requestId);

				if (data && !data.fulfilledTime) {
					data.fulfilledTime = now; // Accurate to the nearest 20ms polling tick
					if (data.createdTime && !data.isComplete) {
						data.isComplete = true;
						receivedCount++;
					}

					if (!processedTxHashes.has(event.transactionHash)) {
						const receipt = await provider.getTransactionReceipt(event.transactionHash);
						totalFulfillmentCost += (receipt.gasUsed as bigint) * (receipt.gasPrice as bigint);
						processedTxHashes.add(event.transactionHash);
					}
				}
			}
		} catch (e: any) {
			console.warn(`Warning: Error during event polling - ${e.message}`);
		}

		await new Promise(r => setTimeout(r, checkInterval));
		batchCounter++;
		elapsedTime += checkInterval;
		process.stdout.write(`\rProcessing... (${receivedCount}/${requestCount} fulfilled)`);
	}

	// statistics
	const endToEndLatencies: number[] = [];
	const oracleLatencies: number[] = [];
	let maxEndTime = 0;

	requestMap.forEach((data) => {
		if (data.createdTime && data.fulfilledTime) {
			oracleLatencies.push(data.fulfilledTime - data.createdTime); // oracle processing time (from block mined till fulfillment)
			endToEndLatencies.push(data.fulfilledTime - data.sendTime); // complete end-to-end time (from script send to fulfillment)
			if (data.fulfilledTime > maxEndTime) {
				maxEndTime = data.fulfilledTime;
			}
		}
	});

	const avgOracleLatency = oracleLatencies.length > 0 
		? oracleLatencies.reduce((a, b) => a + b, 0) / oracleLatencies.length 
		: 0;

	const avgEndToEndLatency = endToEndLatencies.length > 0 
		? endToEndLatencies.reduce((a, b) => a + b, 0) / endToEndLatencies.length 
		: 0;
	
	// TPS using timestamps
	let effectiveDuration = 0; 
	if (maxEndTime > burstStartTime) {
		effectiveDuration = (maxEndTime - burstStartTime) / 1000;
	}

	return {
		count: requestCount,
		successCount: receivedCount,
		successRate: (receivedCount / requestCount) * 100,
		avgNodeLatency: avgOracleLatency / 1000, // only Chainlink speed
		avgTotalLatency: avgEndToEndLatency / 1000, // from send to fulfillment
		effectiveDuration: effectiveDuration,
		tps: receivedCount / effectiveDuration,
		totalRequestCostETH: ethers.formatEther(totalRequestCost),
		totalFulfillmentCostETH: ethers.formatEther(totalFulfillmentCost),
		error: sendErrors > 0 ? `${sendErrors} send errors` : (receivedCount < requestCount ? "Timeout" : undefined)
	};
}

async function main() {
	console.log("==================================================");
	console.log(`       AUTOMATED STRESS TEST FOR ${NUMBER_OF_NODES} NODES       `);
	console.log("==================================================");
	
	const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS as string);
	const provider = ethers.provider;
	
	const allResults: BatchResult[] = [];

	for (const count of TEST_SCENARIOS) {
		const result = await runBatch(count, consumer, provider);
		allResults.push(result);

		// stop if success rate drops below 100%
		if (result.successRate < 100) {
			console.log(`\nBREAKING POINT REACHED at ${count} requests!`);
			console.log(`\tReason: Only ${result.successCount}/${count} succeeded.`);
			break;
		}

		// rest time before next round (node and db can clear itself)
		console.log(`\nCooldown period for ${COOLDOWN_SECONDS}s...`);
		await new Promise(r => setTimeout(r, COOLDOWN_SECONDS * 1000));
	}

	console.log("\n\n=======================================================================================================================");
	console.log("                               FINAL SUMMARY REPORT                                     ");
	console.log("=======================================================================================================================");
	console.log("Requests | TPS\t| Node Latency\t| avgTotalLatency\t| Effective Duration \t| Request Cost (ETH)\t| Node Cost (ETH)\t| Errors");
	console.log("-----------------------------------------------------------------------------------------------------------------------");
	
	allResults.forEach(r => {
		console.log(`${r.count}\t| ${r.tps.toFixed(0)}\t| ${r.avgNodeLatency.toFixed(3)} ms \t| ${r.avgTotalLatency.toFixed(3)} ms  \t\t| ${r.effectiveDuration.toFixed(3)} ms \t\t| ${Number(r.totalRequestCostETH).toFixed(6)}\t\t| ${Number(r.totalFulfillmentCostETH).toFixed(6)}\t\t| ${r.error || "-"}`);
	});
	console.log("=======================================================================================================================");


	// save results to CSV
	const csvHeader = "Config,Nodes,Requests,Success Rate (%),Average Node Latency (ms),Average Total Latency (ms),Effective Duration (ms),TPS,Request Cost(ETH),Node Cost (ETH)\n";
	let csvContent = "";

	allResults.forEach(r => {
		//! change these based on the tests 'Base', '1'
		csvContent += `Complete,${NUMBER_OF_NODES},${r.count},${r.successRate.toFixed(0)},${r.avgNodeLatency.toFixed(3)},${r.avgTotalLatency.toFixed(3)},${r.effectiveDuration.toFixed(3)},${r.tps.toFixed(0)},${Number(r.totalRequestCostETH).toFixed(6)},${Number(r.totalFulfillmentCostETH).toFixed(6)}\n`;
	});

	fs.appendFileSync('stress_test_results.csv', csvHeader + csvContent);
	console.log("Results appended to stress_test_results.csv");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
