import { ethers } from "hardhat";
import fs from "fs";
import { getEnvVariables, getEnvVariablesDon, getRandomCity, RequestData, BatchResult, avg } from "../utils/helper";

const { CONSUMER_ADDRESS, JOB_ID, NUMBER_OF_NODES, WS_URL } = getEnvVariables();
const { JOB_IDS } = getEnvVariablesDon();
const TEST_SCENARIOS = [
	1,
	5,
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
	750, // Watch out! Beyond this point, RAM is nothing but a distant memory
	1000,
	1500,
	2000,
	2500,
	3000,
];

// How long to wait for a new event before assuming the oracle is stuck/dead
const IDLE_TIMEOUT_SECONDS = 30;
const ABSOLUTE_MAX_TIMEOUT_SECONDS = 600;
const COOLDOWN_SECONDS = 5;

let createdEvent: string;
let fulfilledEvent: string;
if (NUMBER_OF_NODES == 1) {
    createdEvent = "RequestCreated";
    fulfilledEvent = "RequestFulfilled";
} else {
    createdEvent = "RequestCreated2";
    fulfilledEvent = "RequestFulfilled2";
}

async function runBatch(
    requestCount: number,
    consumer: any,
    wsConsumer: any,
    provider: any,
    userAddress: string
): Promise<BatchResult> {
    return new Promise(async (resolve) => {
        const requestMap = new Map<string, RequestData>();
        const txSendTimes = new Map<string, number>();
        const requestTxHashes = new Set<string>();
        const fulfillmentTxHashes = new Set<string>();

        let receivedCount = 0;
        let sendErrors = 0;
        let lastActivityTime = Date.now();
        let isBatchFinished = false;

        const absoluteMaxTime = Date.now() + (ABSOLUTE_MAX_TIMEOUT_SECONDS * 1000);

        // ==========================================
        // FINALIZATION & GAS CALCULATION
        // ==========================================
        const finishBatch = async (errorMsg?: string) => {
            if (isBatchFinished) return;
            isBatchFinished = true;

            // Clean up event listeners and intervals to prevent memory leaks
            wsConsumer.removeAllListeners(createdEvent);
            wsConsumer.removeAllListeners(fulfilledEvent);
            clearInterval(monitorInterval);

            const now = Date.now();
            const idleSecondsLeft = Math.max(0, Math.ceil((IDLE_TIMEOUT_SECONDS * 1000 - (now - lastActivityTime)) / 1000));
            process.stdout.write(`\rListening... (${receivedCount}/${requestCount} fulfilled) | Idle Timeout in: ${idleSecondsLeft}s   \n`);

            console.log(`Batch finished. Calculating gas costs and latencies...`);

            let totalRequestCost = 0n;
            let totalFulfillmentCost = 0n;
            let sumRequestGasPrice = 0n;
            let sumFulfillmentGasPrice = 0n;

            // Fetch receipts asynchronously after the fast-paced listening phase is done
            for (const hash of requestTxHashes) {
                try {
                    const receipt = await provider.getTransactionReceipt(hash);
                    if (receipt) {
                        const gasUsed = receipt.gasUsed as bigint;
                        const gasPrice = receipt.gasPrice as bigint;

                        totalRequestCost += (gasUsed * gasPrice);
                        sumRequestGasPrice += gasPrice;
                    }
                } catch (e) { }
            }

            for (const hash of fulfillmentTxHashes) {
                try {
                    const receipt = await provider.getTransactionReceipt(hash);
                    if (receipt) {
                        const gasUsed = receipt.gasUsed as bigint;
                        const gasPrice = receipt.gasPrice as bigint;

                        totalFulfillmentCost += (gasUsed * gasPrice);
                        sumFulfillmentGasPrice += gasPrice;
                    }
                } catch (e) { }
            }

            // Calculate Metrics
            const endToEndLatencies: number[] = [];
            const oracleLatencies: number[] = [];
            const writeLatencies: number[] = [];

            let minStartTime = Infinity;
            let maxEndTime = 0;
            requestMap.forEach((data) => {
                if (data.createdDetectedAt && data.fulfilledAt) {
                    writeLatencies.push(data.createdDetectedAt - data.sentTxAt);
                    oracleLatencies.push(data.fulfilledAt - data.createdDetectedAt);
                    endToEndLatencies.push(data.fulfilledAt - data.sentTxAt);

                    if (data.sentTxAt < minStartTime) minStartTime = data.sentTxAt;
                    if (data.fulfilledAt > maxEndTime) maxEndTime = data.fulfilledAt;
                }
            });

            let totalDuration = 0;
            if (maxEndTime > minStartTime && minStartTime !== Infinity) {
                totalDuration = (maxEndTime - minStartTime) / 1000;
            }

            const avgReqGasPrice = requestTxHashes.size > 0 ? sumRequestGasPrice / BigInt(requestTxHashes.size) : 0n;
            const avgFulfillGasPrice = fulfillmentTxHashes.size > 0 ? sumFulfillmentGasPrice / BigInt(fulfillmentTxHashes.size) : 0n;

            resolve({
                count: requestCount,
                successCount: receivedCount,
                successRate: (receivedCount / requestCount) * 100,
                avgWriteLatency: avg(writeLatencies) / 1000,
                avgNodeLatency: avg(oracleLatencies) / 1000,
                avgTotalLatency: avg(endToEndLatencies) / 1000,
                totalDuration: totalDuration,
                tps: totalDuration > 0 ? receivedCount / totalDuration : 0,
                totalRequestCostETH: ethers.formatEther(totalRequestCost),
                totalFulfillmentCostETH: ethers.formatEther(totalFulfillmentCost),
                avgRequestGasPriceGwei: ethers.formatUnits(avgReqGasPrice, "gwei"),
                avgFulfillmentGasPriceGwei: ethers.formatUnits(avgFulfillGasPrice, "gwei"),
                error: sendErrors > 0 ? `${sendErrors} send errors` : errorMsg
            });
        };

        // ==========================================
        // WEBSOCKET LISTENERS (PUSH MODEL)
        // ==========================================
        wsConsumer.on(createdEvent, (requestId: string, ...args: any[]) => {
            const exactDetectionTime = Date.now();
            const event = args[args.length - 1]; // Ethers v6 event payload is always the last argument
            const txHash = event.log ? event.log.transactionHash : event.transactionHash;

            if (!requestMap.has(requestId)) {
                // Fallback to detection time if sendTime somehow wasn't recorded yet
                const exactSendTime = txSendTimes.get(txHash) || exactDetectionTime;

                requestMap.set(requestId, {
                    sentTxAt: exactSendTime,
                    createdDetectedAt: exactDetectionTime,
                    isComplete: false
                });

                requestTxHashes.add(txHash);
            }
        });

        wsConsumer.on(fulfilledEvent, (requestId: string, ...args: any[]) => {
            const exactDetectionTime = Date.now();
            const event = args[args.length - 1];
            const txHash = event.log ? event.log.transactionHash : event.transactionHash;
            let data = requestMap.get(requestId);

            if (data && !data.fulfilledAt) {
                data.fulfilledAt = exactDetectionTime;

                if (data.createdDetectedAt && !data.isComplete) {
                    data.isComplete = true;
                    receivedCount++;
                    lastActivityTime = Date.now(); // Reset idle timeout
                }

                fulfillmentTxHashes.add(txHash);
            }

            // If we've successfully processed all non-errored requests, finish immediately
            if (receivedCount >= requestCount - sendErrors) {
                finishBatch();
            }
        });

        // ==========================================
        // SENDING PHASE (BURST)
        // ==========================================
        const txPromises = [];
        let currentNonce = await provider.getTransactionCount(userAddress);

        for (let i = 0; i < requestCount; i++) {
            const city   = getRandomCity();
            const sendTime = Date.now();

            let txPromise;
            if (NUMBER_OF_NODES == 1) {
                txPromise = consumer.requestTemperature(city, JOB_ID).then((tx: any) => {
                    txSendTimes.set(tx.hash, sendTime);
                    return tx;
                }).catch((e: any) => {
                    sendErrors++;
                    console.error(`\n[Send Error] Nonce: ${currentNonce - 1} | Message: ${e.shortMessage || e.message}`);
                });
            } else {
                txPromise = consumer.requestTemperature2(city, JOB_IDS).then((tx: any) => {
                    txSendTimes.set(tx.hash, sendTime);
                    return tx;
                }).catch((e: any) => {
                    sendErrors++;
                    console.error(`\n[Send Error] Nonce: ${currentNonce - 1} | Message: ${e.shortMessage || e.message}`);
                });
            }

            txPromises.push(txPromise);
        }

        await Promise.all(txPromises);
        console.log(`All ${requestCount} requests sent. Listening for events via WebSockets...`);
        lastActivityTime = Date.now(); // Reset timer right after burst finishes

        // ==========================================
        // TIMEOUT & PROGRESS MONITORING
        // ==========================================
        const monitorInterval = setInterval(() => {
            if (isBatchFinished) return;

            const now = Date.now();
            const idleSecondsLeft = Math.ceil((IDLE_TIMEOUT_SECONDS * 1000 - (now - lastActivityTime)) / 1000);

            process.stdout.write(`\rListening... (${receivedCount}/${requestCount} fulfilled) | Idle Timeout in: ${Math.max(0, idleSecondsLeft)}s   `);

            if (now - lastActivityTime > (IDLE_TIMEOUT_SECONDS * 1000)) {
                console.log(`\n⚠️ Idle timeout reached: No activity from Oracle for ${IDLE_TIMEOUT_SECONDS} seconds.`);
                finishBatch("Timeout");
            } else if (now > absoluteMaxTime) {
                console.log(`\n⚠️ Absolute timeout reached.`);
                finishBatch("Timeout");
            }
        }, 500); // UI update rate (doesn't block event processing)

    });
}

async function waitForMempoolToDrain(provider: any, address: string, timeoutMs = 120_000) {
    const start = Date.now();
    console.log(`Waiting for mempool to drain...`);
    while (Date.now() - start < timeoutMs) {
        const pending = await provider.getTransactionCount(address, "pending");
        const confirmed = await provider.getTransactionCount(address, "latest");
        if (pending === confirmed) {
            console.log(`Mempool clear. (${pending} confirmed txs)`);
            return;
        }
        console.log(`Pending: ${pending - confirmed} unconfirmed txs remaining...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    console.warn(`Mempool drain timeout reached — proceeding anyway.`);
}

async function main() {
    console.log("=".repeat(160));
    console.log(`AUTOMATED BREAKING POINT STRESS TEST OF ${NUMBER_OF_NODES} NODE`.padStart(105));
    console.log("=".repeat(160));

    console.log(`START TIME: ${new Date().toISOString()}`);

    // HTTP Provider for sending transactions
    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS as string);
    // Dedicated WebSocket Provider strictly for listening to events
    const provider = ethers.provider;
    const wsProvider = new ethers.WebSocketProvider(WS_URL);
    const wsConsumer = new ethers.Contract(CONSUMER_ADDRESS as string, consumer.interface, wsProvider);

    const signers = await ethers.getSigners();
    const testUser = signers[0].address;

    const allResults: BatchResult[] = [];
    for (let i = 0; i < TEST_SCENARIOS.length; i++) {
        const result = await runBatch(TEST_SCENARIOS[i], consumer, wsConsumer, provider, testUser);
        allResults.push(result);

        if (result.successRate <= 0) {
            console.log(`BREAKING POINT REACHED at ${TEST_SCENARIOS[i]} requests!`);
            console.log(`\tReason: Only ${result.successCount}/${TEST_SCENARIOS[i]} succeeded.`);
            break;
        }

        if (i < TEST_SCENARIOS.length - 1) {
            // console.log(`Cooldown period for ${COOLDOWN_SECONDS}s...\n`);
            // await new Promise(r => setTimeout(r, COOLDOWN_SECONDS * 1000));

            await waitForMempoolToDrain(provider, testUser);
        }
    }

    console.log();
    console.log("=".repeat(160));
    console.log("FINAL SUMMARY REPORT".padStart(90));
    console.log("=".repeat(160));
	console.log(
		"Requests".padStart(8), "| Success (%) |", "Duration (s) |",
		"Avg Write Latency (s) |", "Avg Node Latency (s) |", "  TPS |",
		" Req Cost(ETH) | Req Gas(Gwei) | Node Cost(ETH) | Node Gas(Gwei)"
	);
    console.log("=".repeat(160));

    allResults.forEach((r) => {
		console.log(
			`${r.count.toString().padStart(8)} |` +
			`${r.successRate.toFixed(0).padStart(12)} |` +
			`${r.totalDuration.toFixed(2).padStart(13)} |` +
			`${r.avgWriteLatency.toFixed(3).padStart(22)} |` +
			`${r.avgNodeLatency.toFixed(3).padStart(21)} |` +
			`${r.tps.toFixed(0).padStart(6)} |` +
            `${Number(r.totalRequestCostETH).toFixed(5).padStart(15)} |` +
            `${Number(r.avgRequestGasPriceGwei).toFixed(2).padStart(14)} |` +
            `${Number(r.totalFulfillmentCostETH).toFixed(5).padStart(15)} |` +
            ` ${Number(r.avgFulfillmentGasPriceGwei).toFixed(2).padStart(14)}` 
		);
    });
    console.log("=".repeat(160));

    const csvHeader = 
		"Config,Nodes,Requests,Success Rate (%)," +
		"Average Write Latency (s),Average Node Latency (s),Average Total Latency (s),Batch Completion Time (s)," +
		"TPS,Request Cost (ETH),Node Cost (ETH)," +
		"Avg Request Gas Price (Gwei),Avg Node Gas Price (Gwei)\n";
    let csvContent = "";

    allResults.forEach(r => {
        csvContent += `Base,${NUMBER_OF_NODES},${r.count},${r.successRate.toFixed(0)},` +
		`${r.avgWriteLatency.toFixed(3)},${r.avgNodeLatency.toFixed(3)},${r.avgTotalLatency.toFixed(3)},${r.totalDuration.toFixed(3)},` +
		`${r.tps.toFixed(1)},${Number(r.totalRequestCostETH).toFixed(6)},${Number(r.totalFulfillmentCostETH).toFixed(6)},` +
		`${Number(r.avgRequestGasPriceGwei).toFixed(2)},${Number(r.avgFulfillmentGasPriceGwei).toFixed(2)}\n`;
    });

    fs.appendFileSync('stress_test_results.csv', csvHeader + csvContent);
    console.log("📁 Results appended to stress_test_results.csv");
    console.log(`END TIME: ${new Date().toISOString()}`);

    // Cleanly close the WebSocket connection before exiting
    await wsProvider.destroy();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
