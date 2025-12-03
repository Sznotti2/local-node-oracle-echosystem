import fs from "fs";
import hre from "hardhat";
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

async function main() {
  const DURATION_HOURS = 4;
  const REQUESTS_PER_SECOND = 1; // Ha túl gyors, a Hardhat nem bírja majd
  const TOTAL_SECONDS = DURATION_HOURS * 3600;
  
  // Consumer contract címe (már deployolva kell lennie)
  const CONSUMER_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; 
  const JOB_ID = "1d320673e76245aab12ac929a794d2b2";
  
  console.log(`=== SOAK TEST STARTING ===`);
  console.log(`Duration: ${DURATION_HOURS} hours`);
  console.log(`Target Rate: ${REQUESTS_PER_SECOND} req/sec`);

  const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS); // PL: "APIConsumer"

  // CSV fájlba logoljuk az eredményeket a későbbi grafikonhoz
  const logStream = fs.createWriteStream('soak_test_results.csv', { flags: 'a' });
  logStream.write('timestamp,tx_hash,status,latency_ms\n');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < TOTAL_SECONDS; i++) {
    const start = Date.now();
    
    try {
      // Elküldjük a tranzakciót
      const tx = await consumer.requestTemperature(getRandomCity(), JOB_ID);
      
      // Megvárjuk a blokkot (ez lassíthatja, ha a hardhat lassan bányász)
      await tx.wait(1);
      
      const latency = Date.now() - start;
      
      console.log(`[${new Date().toISOString()}] Req #${i+1}: OK (${latency}ms)`);
      logStream.write(`${Date.now()},${tx.hash},OK,${latency}\n`);
      successCount++;
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Req #${i+1}: FAILED`);
      logStream.write(`${Date.now()},null,ERROR,0\n`);
      errorCount++;
    }

    // Kiszámoljuk, mennyit kell várni, hogy tartsuk az 1 másodperces ütemet
    const elapsed = Date.now() - start;
    const waitTime = Math.max(0, 1000 - elapsed);
    
    // Várakozás
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  console.log("=== SOAK TEST FINISHED ===");
  console.log(`Success: ${successCount}, Error: ${errorCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });