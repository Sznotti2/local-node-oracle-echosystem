import fs from "fs";
import path from "path";
import hre from "hardhat";
import { get } from "http";
const { ethers } = hre as any;

const CITIES = [
    "London",
    "Paris",
    "NewYork",
    "Tokyo",
    "Sydney",
    "Moscow",
    "Dubai",
    "Berlin",
    "Rome",
    "Madrid",
    "Szeged",
];

function getRandomCity(): string {
	const index = Math.floor(Math.random() * CITIES.length);
	return CITIES[index];
}

interface TestMetrics {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    timedOutRequests: number;
    averageResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    totalGasUsed: bigint;
    averageGasPerRequest: bigint;
}

async function stressTestOracleRequests(
    consumer: any,
    jobId: string,
    numRequests: number,
    concurrent: boolean = false
): Promise<TestMetrics> {
    console.log(`\n=== Starting Oracle Stress Test ===`);
    console.log(`Requests: ${numRequests}`);
    console.log(`Mode: ${concurrent ? "Concurrent" : "Sequential"}\n`);

    const metrics: TestMetrics = {
        totalRequests: numRequests,
        successfulRequests: 0,
        failedRequests: 0,
        timedOutRequests: 0,
        averageResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        totalGasUsed: 0n,
        averageGasPerRequest: 0n,
    };

    const responseTimes: number[] = [];

    const makeRequest = async (requestNum: number) => {
        const startTime = Date.now();
        
        try {
            console.log(`[${requestNum}/${numRequests}] Sending request...`);
            
			// Create a promise to catch the fulfillment event
			let fulfillmentPromise: Promise<boolean>;
			let requestId: string = "";
			
			// Listen for ANY RequestFulfilled event and filter later
			const allFulfillmentsPromise = new Promise<string>((resolve) => {
				const timeout = setTimeout(() => {
					resolve("");
				}, 30000); // 30s timeout

				// Listen to all fulfillments, we'll match by requestId later
				const filter = consumer.filters.RequestFulfilled();
				
				const handler = (id: string, value: any) => {
					// We'll check if this is our request after we know the requestId
					resolve(id);
				};
				
				consumer.once(filter, handler);
			});

            const tx = await consumer.requestTemperature(getRandomCity(), jobId);
            const receipt = await tx.wait();

			const gasUsed = BigInt(receipt.gasUsed.toString());
			const gasPrice = BigInt(receipt.effectiveGasPrice.toString());
			metrics.totalGasUsed += gasUsed * gasPrice;

            // Extract request ID
            for (const log of receipt.logs) {
                try {
                    const parsed = consumer.interface.parseLog(log);
                    if (parsed && parsed.name === "RequestCreated") {
                        requestId = parsed.args.requestId;
                        break;
                    }
                } catch {}
            }

            if (!requestId) {
                console.log(`[${requestNum}] ❌ Failed to extract request ID`);
                metrics.failedRequests++;
                return;
            }

			// Mine a block to ensure transaction is processed
            // await ethers.provider.send("hardhat_mine", ["0x1"]);
            // await ethers.provider.send("hardhat_mine", ["0x1"]);

            // // Wait for fulfillment
            // const fulfilled = await new Promise<boolean>((resolve) => {
            //     const filter = consumer.filters.RequestFulfilled(requestId);
            //     const timeout = setTimeout(() => {
            //         consumer.removeAllListeners(filter);
            //         resolve(false);
            //     }, 30000); // 30s timeout

			// 	// Mine blocks periodically to help node process
            //     // const miningInterval = setInterval(async () => {
            //     //     await ethers.provider.send("hardhat_mine", ["0x1"]);
            //     // }, 2000); // Mine every 2 seconds

            //     consumer.once(filter, () => {
            //         clearTimeout(timeout);
			// 		// clearInterval(miningInterval);
            //         resolve(true);
            //     });
            // });

			// Poll for fulfillment instead of listening to events
			const pollInterval = 500; // Check every 0.5 seconds
			const maxPolls = 20; // Max 10 seconds
			let fulfilled = false;
			let polls = 0;
			let previousTemp = await consumer.temperature();

			while (polls < maxPolls && !fulfilled) {
				await new Promise(resolve => setTimeout(resolve, pollInterval));
				polls++;
				
				const currentTemp = await consumer.temperature();
				
				// Check if temperature changed (indicates fulfillment)
				if (!currentTemp.eq(previousTemp)) {
					fulfilled = true;
					break;
				}
				
				if (polls % 10 === 0) {
					console.log(`[${requestNum}] Still waiting... (${polls}s)`);
				}
			}

            const responseTime = Date.now() - startTime;
            responseTimes.push(responseTime);

            if (fulfilled) {
                metrics.successfulRequests++;
                metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
                metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
                console.log(`[${requestNum}] ✅ Fulfilled in ${responseTime}ms`);
            } else {
				// Check if it was actually fulfilled but we missed the event
				try {
					const currentTemp = await consumer.temperature();
					console.log(`[${requestNum}] 🔍 Current temperature: ${currentTemp.toString()}`);
					if (currentTemp.gt(0)) {
						console.log(`[${requestNum}] ℹ️  Data exists but event was missed`);
					}
				} catch (e) {}
				
                metrics.timedOutRequests++;
                console.log(`[${requestNum}] ⏱️  Timeout after ${responseTime / 1000}s`);
            }
        } catch (error: any) {
            metrics.failedRequests++;
            console.log(`[${requestNum}] ❌ Error:`, error.message);
        }
    };

    const startTestTime = Date.now();

    if (concurrent) {
        // Run all requests concurrently
        await Promise.all(
            Array.from({ length: numRequests }, (_, i) => makeRequest(i + 1))
        );
    } else {
        // Run requests sequentially with delay
        for (let i = 1; i <= numRequests; i++) {
            await makeRequest(i);
            if (i < numRequests) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
            }
        }
    }

    const totalTestTime = Date.now() - startTestTime;

    // Calculate averages
    if (responseTimes.length > 0) {
        metrics.averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    }
    if (metrics.totalRequests > 0) {
        metrics.averageGasPerRequest = metrics.totalGasUsed / BigInt(metrics.totalRequests);
    }

    console.log(`\n=== Test Results ===`);
    console.log(`Total Test Time: ${(totalTestTime / 1000).toFixed(2)}s`);
    console.log(`Successful: ${metrics.successfulRequests}/${metrics.totalRequests}`);
    console.log(`Timed Out: ${metrics.timedOutRequests}`);
    console.log(`Success Rate: ${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(2)}%`);
    console.log(`\nResponse Times:`);
    console.log(`  Average: ${metrics.averageResponseTime.toFixed(2)}ms`);
    console.log(`  Min: ${metrics.minResponseTime}ms`);
    console.log(`  Max: ${metrics.maxResponseTime}ms`);
    console.log(`\nGas Usage:`);
    console.log(`  Total: ${ethers.utils.formatEther(metrics.totalGasUsed.toString())} ETH`);
    console.log(`  Average per request: ${ethers.utils.formatEther(metrics.averageGasPerRequest.toString())} ETH`);

    return metrics;
}

async function main() {
    const file = path.join(process.cwd(), "deploy-output.json");
    if (!fs.existsSync(file)) throw new Error("deploy-output.json missing");
    const { CONSUMER_ADDRESS } = JSON.parse(fs.readFileSync(file, "utf8"));

    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);
    const jobId = process.env.JOB_ID;
    if (!jobId) throw new Error("JOB_ID not set in .env");

    const signers = await ethers.getSigners();

    // Test 1: Sequential Oracle Requests
    // await stressTestOracleRequests(consumer, jobId, 10, false);

    // Test 2: Concurrent Oracle Requests (stress test)
    await stressTestOracleRequests(consumer, jobId, 10, true);

    console.log(`\n=== All Stress Tests Complete ===`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});