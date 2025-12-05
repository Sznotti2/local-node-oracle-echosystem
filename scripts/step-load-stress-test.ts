import { ethers } from "hardhat";


const CONSUMER_ADDRESS = process.env.CONSUMER_ADDRESS;
const JOB_ID = process.env.JOB_ID;

if (!CONSUMER_ADDRESS || !JOB_ID) {
	console.error("❌ Error: Missing environment variables in the .env file!");
	console.log("Required variables:");
    console.log(` - CONSUMER_ADDRESS: ${CONSUMER_ADDRESS || "MISSING"}`);
    console.log(` - JOB_ID: ${JOB_ID || "MISSING"}`);
    process.exit(1);
}

const TEST_SCENARIOS = [
    10,
    15,/*
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
    3000,*/
];

const COOLDOWN_SECONDS = 10;
const BASE_TIMEOUT = 30;     // Base timeout in seconds

const CITIES = [
    "London", "Paris", "NewYork", "Tokyo", "Sydney",
    "Moscow", "Dubai", "Berlin", "Rome", "Madrid", "Szeged",
];

function getRandomCity(): string {
    const index = Math.floor(Math.random() * CITIES.length);
    return CITIES[index];
}

interface RequestData {
    sendTime: number;
    createdTime?: number;
    fulfilledTime?: number;
    isComplete: boolean;
}

interface BatchResult {
    count: number;
    successCount: number;
    successRate: number;
    avgWriteLatency: number;
    avgNodeLatency: number;
    totalTime: number;
    tps: number;
    error?: string;
}

function calculateStats(times: number[]) {
    if (times.length === 0) return { min: 0, max: 0, avg: 0 };
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { min, max, avg };
}

async function runBatch(requestCount: number, consumer: any, provider: any): Promise<BatchResult> {
    console.log(`\n---------------------------------------------------------`);
    console.log(`\tSTARTING BATCH: ${requestCount} requests`);
    console.log(`---------------------------------------------------------`);

    // Dynamic timeout: the more requests, the more time we allow
    // e.g. for 100 requests 30s + 10s = 40s, for 1000 requests 30s + 100s = 130s
    const dynamicTimeout = BASE_TIMEOUT + (requestCount * 0.1); 
    
    const startBlock = await provider.getBlockNumber();
    const requestMap = new Map<string, RequestData>();
    const burstStartTime = Date.now();
    
    // SENDING PHASE
    const txPromises = [];
    let sendErrors = 0;

    for (let i = 0; i < requestCount; i++) {
        const sendTime = Date.now();
        
        const transaction = consumer.requestTemperature(getRandomCity(), JOB_ID)
            .then(async (tx: any) => {
                const receipt = await tx.wait(1);
                const minedTime = Date.now();

				let requestId: string = "";
				for (const log of receipt.logs) {
					try {
						const parsedLog = consumer.interface.parseLog(log);
						if (parsedLog.name === 'RequestCreated') {
							requestId = parsedLog.args.requestId;
							break;
						}
					} catch (e) {
					}
				}

				if (requestId) {
                    // Race condition handling
                    let data = requestMap.get(requestId);
                    if (!data) {
                        data = { sendTime, createdTime: minedTime, isComplete: false };
                        requestMap.set(requestId, data);
                    } else {
                        data.sendTime = sendTime;
                        data.createdTime = minedTime;
                    }
                    process.stdout.write(`\rSending... (${i + 1}/${requestCount})`);
                } else {
                    console.error("\n❌ Error: Could not extract RequestID from logs!");
                    sendErrors++;
                }
            })
            .catch((e: any) => {
                sendErrors++;
            });
            
        txPromises.push(transaction);
    }

    // wait for all the transactions to be sent
    await Promise.all(txPromises);
    
    if (sendErrors > 0) {
        console.log(`\nWarning: ${sendErrors} requests failed during sending (Network/Node limit reached?)`);
    } else {
        console.log(`\nAll ${requestCount} requests sent. Polling for responses...`);
    }

    // POLLING PHASE
    // we use polling because this is the most reliable way to look for events
    // if automining is turned off and interval set to lower than 1s ethers cannot reliably perceive events
    let receivedCount = 0;
    let elapsedTime = 0;
    const checkInterval = 1000;
    const filter = consumer.filters.RequestFulfilled();

    // wait till everithing comes back or time is up
    while (receivedCount < (requestCount - sendErrors) && elapsedTime < dynamicTimeout * 1000) {
        try {
            const currentBlock = await provider.getBlockNumber();
            const events = await consumer.queryFilter(filter, startBlock, currentBlock);

            for (const event of events) {
                const args = (event as any).args;
                const requestId = args.requestId;
                let data = requestMap.get(requestId);

                if (data) {
                    if (!data.fulfilledTime) {
                        data.fulfilledTime = Date.now();
                        if (data.createdTime && !data.isComplete) {
                            data.isComplete = true;
                            receivedCount++;
                        }
                    }
                }
            }
        } catch (e: any) {
            console.log("Polling error (ignoring):", e.message);
        }

        await new Promise(r => setTimeout(r, checkInterval));
        elapsedTime += checkInterval;
        process.stdout.write(`\rWaiting... (${receivedCount}/${requestCount}) - Time: ${(elapsedTime/1000).toFixed(0)}s`);
    }

    const totalDuration = (Date.now() - burstStartTime) / 1000;
    console.log(`\nBatch finished in ${totalDuration.toFixed(2)}s`);

    // STATISTICAL COMPILATION
    const writeLatencies: number[] = [];
    const nodeLatencies: number[] = [];

    requestMap.forEach((data) => {
        if (data.createdTime && data.fulfilledTime && data.sendTime > 0) {
            writeLatencies.push(data.createdTime - data.sendTime);
            nodeLatencies.push(data.fulfilledTime - data.createdTime);
        }
    });

    const writeStats = calculateStats(writeLatencies);
    const nodeStats = calculateStats(nodeLatencies);
    const successRate = (receivedCount / requestCount) * 100;

    return {
        count: requestCount,
        successCount: receivedCount,
        successRate: successRate,
        avgWriteLatency: writeStats.avg,
        avgNodeLatency: nodeStats.avg,
        totalTime: totalDuration,
        tps: receivedCount / totalDuration,
        error: sendErrors > 0 ? `${sendErrors} send errors` : (receivedCount < requestCount ? "Timeout" : undefined)
    };
}

async function main() {
    console.log("==================================================");
    console.log("       AUTOMATED BREAKING POINT STRESS TEST       ");
    console.log("==================================================");
    
    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS as string);
    const provider = ethers.provider;
    
    const allResults: BatchResult[] = [];

    for (const count of TEST_SCENARIOS) {
        const result = await runBatch(count, consumer, provider);
        allResults.push(result);

        console.log(`\t-> Success: ${result.successRate.toFixed(1)}% | Node Latency: ${result.avgNodeLatency.toFixed(0)}ms | TPS: ${result.tps.toFixed(2)}`);

        // BREAKING POINT CHECK
        // stop if success rate drops below 100%
        if (result.successRate < 100) {
            console.log(`\nBREAKING POINT REACHED at ${count} requests!`);
            console.log(`\tReason: Only ${result.successCount}/${count} succeeded.`);
            break;
        }

        // rest time before next round (node and db can clear itself)
        console.log(`\n💤 Cooling down for ${COOLDOWN_SECONDS}s...`);
        await new Promise(r => setTimeout(r, COOLDOWN_SECONDS * 1000));
    }

    console.log("\n\n=======================================================================================================================");
    console.log("                               FINAL SUMMARY REPORT                                     ");
    console.log("=======================================================================================================================");
    console.log("Status\t\t| Reqs\t\t| Rate\t| Total Duration\t| TPS\t| Node Latency\t| Errors");
    console.log("-----------------------------------------------------------------------------------------------------------------------");
    
    allResults.forEach(r => {
        const status = r.successRate === 100 ? "✅ PASSED" : `❌ FAILED`;
        console.log(`${status}\t| ${r.count}\t\t| ${r.successRate.toFixed(0)}%\t| ${r.totalTime} s\t\t| ${r.tps.toFixed(1)}\t| ${r.avgNodeLatency.toFixed(0)} ms\t| ${r.error || "-"}`);
    });
    console.log("=======================================================================================================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
