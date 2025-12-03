import { ethers } from "hardhat";


// --- KONFIGURÁCIÓ ---
const CONSUMER_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
const JOB_ID = "1d320673e76245aab12ac929a794d2b2";

// Itt állítsd be a lépcsőket. A script ezen fog végigmenni sorban.
const TEST_SCENARIOS = [
    10,
    15,
    20, // kiegészült a transaction résszel
    25,  /*
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

const COOLDOWN_SECONDS = 10; // Két tesztkör közötti pihenő idő
const BASE_TIMEOUT = 60;     // Alap timeout másodpercben

// --- SEGÉD ADATOK ---
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
    console.log(`🚀 STARTING BATCH: ${requestCount} requests`);
    console.log(`---------------------------------------------------------`);

    // Dinamikus timeout: minél több a kérés, annál több időt adunk
    // pl. 100 kérésnél 60s + 10s = 70s, 1000 kérésnél 60s + 100s = 160s
    const dynamicTimeout = BASE_TIMEOUT + (requestCount * 0.1); 
    
    const startBlock = await provider.getBlockNumber();
    const requestMap = new Map<string, RequestData>();
    const burstStartTime = Date.now();
    
    // --- 1. KÜLDÉS (SENDING PHASE) ---
    const txPromises = [];
    let sendErrors = 0;

    for (let i = 0; i < requestCount; i++) {
        const sendTime = Date.now();
        
        const p = consumer.requestTemperature(getRandomCity(), JOB_ID)
            .then(async (tx: any) => {
                const receipt = await tx.wait(1);
                const minedTime = Date.now();
                const event = receipt.events?.find((e: any) => e.event === 'RequestCreated');

                if (event && event.args) {
                    const requestId = event.args.requestId;
                    
                    // Race condition kezelés (ha a poller gyorsabb volt)
                    let data = requestMap.get(requestId);
                    if (!data) {
                        data = { sendTime, createdTime: minedTime, isComplete: false };
                        requestMap.set(requestId, data);
                    } else {
                        data.sendTime = sendTime;
                        data.createdTime = minedTime;
                    }
                    process.stdout.write(`\rSending... (${i + 1}/${requestCount})`);
                }
            })
            .catch((e: any) => {
                // Itt kapjuk el a "Transaction throttling" vagy hálózati hibákat
                sendErrors++;
                process.stdout.write("X");
                // Nem írjuk ki a full errort, hogy ne szemetelje tele a konzolt, de számoljuk
            });
            
        txPromises.push(p);
    }

    // Megvárjuk a küldést
    await Promise.all(txPromises);
    
    if (sendErrors > 0) {
        console.log(`\n⚠️  Warning: ${sendErrors} requests failed during sending (Network/Node limit reached?)`);
    } else {
        console.log(`\n✅ All ${requestCount} requests sent. Polling for responses...`);
    }

    // --- 2. VÁRAKOZÁS (POLLING PHASE) ---
    let receivedCount = 0;
    let elapsedTime = 0;
    const checkInterval = 1000;
    const filter = consumer.filters.RequestFulfilled();

    // Várakozunk, amíg meg nem jön minden, vagy le nem telik az idő
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
                        data.fulfilledTime = Date.now(); // Becsült idő
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
    console.log(`\n🏁 Batch finished in ${totalDuration.toFixed(2)}s`);

    // --- STATISZTIKA ÖSSZEÁLLÍTÁSA ---
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
    
    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);
    const provider = ethers.provider;
    
    const allResults: BatchResult[] = [];

    // Fő ciklus: végigmegyünk a teszt eseteken
    for (const count of TEST_SCENARIOS) {
        // Futtatjuk a batch-et
        const result = await runBatch(count, consumer, provider);
        allResults.push(result);

        // Kiírjuk az aktuális eredményt
        console.log(`   -> Success: ${result.successRate.toFixed(1)}% | Node Latency: ${result.avgNodeLatency.toFixed(0)}ms | TPS: ${result.tps.toFixed(2)}`);

        // BREAKING POINT ELLENŐRZÉS
        // Ha a sikeresség 100% alá esik, megállunk (vagy ha túl sok a hiba)
        if (result.successRate < 100) {
            console.log(`\n🛑 BREAKING POINT REACHED at ${count} requests!`);
            console.log(`   Reason: Only ${result.successCount}/${count} succeeded.`);
            break;
        }

        // Pihenő a következő kör előtt (hogy a node/db kitisztuljon)
        console.log(`\n💤 Cooling down for ${COOLDOWN_SECONDS}s...`);
        await new Promise(r => setTimeout(r, COOLDOWN_SECONDS * 1000));
    }

    // --- VÉGSŐ JELENTÉS ---
    console.log("\n\n========================================================================================");
    console.log("                               FINAL SUMMARY REPORT                                     ");
    console.log("========================================================================================");
    // console.log("Reqs\t| Success\t| Rate\t| TPS\t| Node Latency\t| Status");
    console.log("Status\t| Reqs\t\t| Rate\t| Total Duration\t| TPS\t| Node Latency");
    console.log("----------------------------------------------------------------------------------------");
    
    allResults.forEach(r => {
        const status = r.successRate === 100 ? "✅ PASS" : `❌ FAIL`;
        // console.log(`${r.count}\t| ${r.successCount}\t\t| ${r.successRate.toFixed(0)}%\t| ${r.tps.toFixed(1)}\t| ${r.avgNodeLatency.toFixed(0)} ms\t| ${status}`);
        console.log(`${status}\t| ${r.count}\t\t| ${r.successRate.toFixed(0)}%\t| ${r.totalTime} s\t\t| ${r.tps.toFixed(1)}\t| ${r.avgNodeLatency.toFixed(0)} ms`);
        console.log(`Error: ${r.error || "Low rate"}`);
    });
    console.log("========================================================================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
