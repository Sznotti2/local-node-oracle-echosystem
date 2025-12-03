import { ethers } from "hardhat";


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

function calculateStats(times: number[]) {
	if (times.length === 0) return { min: 0, max: 0, avg: 0 };
	const min = Math.min(...times);
	const max = Math.max(...times);
	const avg = times.reduce((a, b) => a + b, 0) / times.length;
	return { min, max, avg };
}

async function main() {
	//const REQUEST_COUNT = 10;		// num of requests to send
	//const REQUEST_COUNT = 15;
	const REQUEST_COUNT = 20;
	//const REQUEST_COUNT = 25;
	//const REQUEST_COUNT = 50;
	//const REQUEST_COUNT = 75;
	//const REQUEST_COUNT = 100;
	//const REQUEST_COUNT = 150;
	//const REQUEST_COUNT = 200;
	//const REQUEST_COUNT = 250;
	// const REQUEST_COUNT = 500;
	//const REQUEST_COUNT = 750;
	//const REQUEST_COUNT = 1000;
	//const REQUEST_COUNT = 1500;
	//const REQUEST_COUNT = 2000;
	//const REQUEST_COUNT = 2500;
	// const REQUEST_COUNT = 3000;
	const TIMEOUT_SECONDS = 30;		// time to wait for all responses in seconds
	const CONSUMER_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
	const JOB_ID = "1d320673e76245aab12ac929a794d2b2";

	console.log(`=== CHAINLINK ROBUST POLL-BASED TEST: ${REQUEST_COUNT} requests ===`);

	const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS);
	const provider = ethers.provider;

	// Elmentjük a teszt kezdetekor aktuális blokkszámot, 
	// hogy csak az ezután történő eseményeket figyeljük.
	const startBlock = await provider.getBlockNumber();
	console.log(`Current Block Number: ${startBlock}`);

	const requestMap = new Map<string, RequestData>();

	// --- 1. KÉRÉSEK KÜLDÉSE (BURST) ---
	const burstStartTime = Date.now();
	console.log(`Sending ${REQUEST_COUNT} requests...`);

	const txPromises = [];

	for (let i = 0; i < REQUEST_COUNT; i++) {
		const sendTime = Date.now();

		const transaction = consumer.requestTemperature(getRandomCity(), JOB_ID)
			.then(async (tx: any) => {
				const receipt = await tx.wait(1);
				const minedTime = Date.now();

				const event = receipt.events?.find((e: any) => e.event === 'RequestCreated');

				if (event && event.args) {
					const requestId = event.args.requestId;

					let data = requestMap.get(requestId);
					if (!data) {
						// szupergyors blokkidő esetén az ethers.js nem biztos h megtalálja az eseményt
						data = { sendTime: sendTime, createdTime: minedTime, isComplete: false };
						requestMap.set(requestId, data);
					} else {
						// Ha a poller előbb megtalálta volna (kicsi az esély, de lehetséges)
						data.sendTime = sendTime;
						data.createdTime = minedTime;
					}
					// process.stdout.write(".");
					process.stdout.write(`\rSending... (${i}/${REQUEST_COUNT})`);
				}
			})
			.catch((e: any) => {
				process.stdout.write("X");
				console.error(e);
			});

		txPromises.push(transaction);
	}

	await Promise.all(txPromises);
	console.log(`\nAll requests sent. Starting Active Polling for responses...`);

	// POLLING LOOP, works even if events are missed
	// Ahelyett, hogy consumer.on-ra várnánk, mi kérdezzük le az eseményeket
	let receivedCount = 0;
	let elapsedTime = 0;
	const checkInterval = 1000; // 1 másodpercenként

	const filter = consumer.filters.RequestFulfilled();
	// amíg nem jöttek meg az összes válaszok, vagy le nem járt az idő
	while (receivedCount < REQUEST_COUNT && elapsedTime < TIMEOUT_SECONDS * 1000) {
		// lekérdezzük az összes eseményt a kezdő blokktól a mostaniig
		const currentBlock = await provider.getBlockNumber();
		const events = await consumer.queryFilter(filter, startBlock, currentBlock);

		// 2. Feldolgozzuk a talált eseményeket
		for (const event of events) {
			const args = (event as any).args;
			const requestId = args.requestId;

			let data = requestMap.get(requestId);

			// Ha ez egy olyan kérés, amit mi küldtünk (benne van a Map-ben)
			if (data) {
				// Ha még nincs jelölve teljesítettnek
				if (!data.fulfilledTime) {
					data.fulfilledTime = Date.now();

					// Ellenőrizzük, hogy kész-e
					if (data.createdTime && !data.isComplete) {
						data.isComplete = true;
						receivedCount++;
						// process.stdout.write("+");
					}
				}
			}
		}

		// Várunk egy kicsit a következő lekérdezésig
		await new Promise(p => setTimeout(p, checkInterval));
		elapsedTime += checkInterval;

		// Opcionális: Progress bar frissítése, hogy lásd, él a script
		process.stdout.write(`\rWaiting... (${receivedCount}/${REQUEST_COUNT})`);
	}

	// STATISZTIKÁK FELDOLGOZÁSA
	const writeLatencies: number[] = [];
	const nodeLatencies: number[] = [];

	requestMap.forEach((data, id) => {
		if (data.createdTime && data.fulfilledTime && data.sendTime > 0) {
			writeLatencies.push(data.createdTime - data.sendTime);
			nodeLatencies.push(data.fulfilledTime - data.createdTime);
		}
	});

	const writeStats = calculateStats(writeLatencies);
	const nodeStats = calculateStats(nodeLatencies);
	const totalDuration = (Date.now() - burstStartTime) / 1000;

	console.log("\n\n================================================");
	console.log(`              TEST REPORT                       `);
	console.log("================================================");
	console.log(`Requests Sent:      	${REQUEST_COUNT}`);
	console.log(`Responses Received: 	${receivedCount}`);
	console.log(`Success Rate:       	${((receivedCount / REQUEST_COUNT) * 100).toFixed(1)}%`);
	console.log(`Total Test Time:    	${totalDuration.toFixed(2)} sec`);
	console.log(`Effective TPS:		${(receivedCount / totalDuration).toFixed(2)}`);

	console.log("\n--- PHASE 1: BLOCKCHAIN WRITE (Hardhat Network) ---");
	console.log(`(Time from tx.send() to RequestCreated)`);
	console.log(`Min: ${writeStats.min} ms`);
	console.log(`Max: ${writeStats.max} ms`);
	console.log(`Avg: ${writeStats.avg.toFixed(2)} ms`);

	console.log("\n--- PHASE 2: ORACLE NODE PROCESSING (Chainlink) ---");
	console.log(`(Time from RequestCreated to RequestFulfilled)`);
	console.log(`Min: ${nodeStats.min} ms`);
	console.log(`Max: ${nodeStats.max} ms`);
	console.log(`Avg: ${nodeStats.avg.toFixed(2)} ms`);
	console.log("================================================");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});