import { ethers } from "hardhat";

async function main() {
    console.log("=== CHAINLINK REQUEST TRACER ===");
    
    const CONSUMER_ADDRESS = process.env.CONSUMER_ADDRESS;
    const LINK_ADDRESS = process.env.LINKTOKEN_ADDRESS;
    const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS;
    const JOB_ID = process.env.JOB_ID;

    if (!CONSUMER_ADDRESS || !LINK_ADDRESS || !OPERATOR_ADDRESS) {
        throw new Error("Could not find required addresses in the .env file!");
    } else if (!JOB_ID) {
        throw new Error("JOB_ID not found");
    }

    const consumer = await ethers.getContractAt("ConsumerContract", CONSUMER_ADDRESS) as any;
    const linkToken = await ethers.getContractAt("LinkToken", LINK_ADDRESS) as any;
    const operator = await ethers.getContractAt("Operator", OPERATOR_ADDRESS) as any;

    console.log(`Consumer: ${CONSUMER_ADDRESS}`);
    console.log(`Operator: ${OPERATOR_ADDRESS}`);
    console.log(`Job ID:   ${JOB_ID}`);
    console.log("\n--- 📡 LISTENING FOR EVENTS... ---");

	consumer.on("RequestCreated", (requestId: string, city: string) => {
        console.log(`\n[0] 🏁 Consumer: RequestCreated event detected!`);
        console.log(`    ├─ Request ID:  ${requestId}`);
        console.log(`    └─ City: ${city}`);
    });

	linkToken.on("Transfer(address,address,uint256,bytes)", (from: string, to: string, value: bigint, data: any) => {
        if (to === OPERATOR_ADDRESS) {
            console.log(`\n[1] 🟢 LinkToken: Transfer (ERC677) event detected`);
            console.log(`    ├─ From:   ${from} (Consumer)`);
            console.log(`    ├─ To:     ${to} (Operator)`);
            console.log(`    ├─ Amount: ${ethers.formatEther(value)} LINK`);
            
            try {
                // a Chainlink Operator contract ezt a struktúrát várja a data mezőben:
                // (bytes32 specId, address callbackAddr, bytes4 callbackFunctionId, uint256 nonce, uint256 dataVersion, bytes cborData)
                const types = ["bytes32", "address", "bytes4", "uint256", "uint256", "bytes"];
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(types, data);
                
                let jobId = decoded[0];
                try { jobId = ethers.decodeBytes32String(decoded[0]); } catch {}

                console.log(`    └─ 📦 Decoded Data (Oracle Request):`);
                console.log(`       ├─ Job ID:       ${jobId}`);
                console.log(`       ├─ Callback:     ${decoded[1]}`);
                console.log(`       ├─ Function Sig: ${decoded[2]}`);
                console.log(`       └─ Nonce:        ${decoded[3]}`);
            } catch (e) {
                console.log(`    └─ ⚠️ Data (Raw):    ${data} (Could not decode)`);
            }
        }
    });

    operator.on("OracleRequest", (specId: string, requester: string, requestId: string, payment: bigint, callbackAddr: string, callbackFunc: string, expiration: any, dataVersion: any, data: any) => {
        let decodedSpecId = specId;
        try {
            decodedSpecId = ethers.decodeBytes32String(specId);
        } catch (e) {
        }
        
        console.log(`\n[2] 🔵 Operator: OracleRequest event detected`);
        console.log(`    ├─ Request ID: ${requestId}`);
        console.log(`    ├─ Spec ID:    ${decodedSpecId === JOB_ID ? "Matches JOB_ID ✅" : decodedSpecId}`);
        console.log(`    ├─ Requester:  ${requester}`);
        console.log(`    └─ Callback:   ${callbackFunc} @ ${callbackAddr}`);
        
        console.log("\n   ⏳ Waiting for Chainlink Node (Off-chain processing)...");
    });

    consumer.on("ChainlinkRequested", (id: string) => {
       console.log(`\n[Info] ℹ️  Consumer: ChainlinkRequested log (ID: ${id})`); 
    });

    operator.on("OracleResponse", (requestId: string) => {
        console.log(`\n[3] 🟣 Operator: OracleResponse event detected`);
        console.log(`    └─ Request ID: ${requestId}`);
    });

    consumer.on("RequestFulfilled", (requestId: string, temperature: bigint) => {
        console.log(`\n[4] 🏁 Consumer: RequestFulfilled event detected!`);
        console.log(`    ├─ Request ID:  ${requestId}`);
        console.log(`    └─ Temperature: ${temperature} °C`);
        
        console.log("\n✅ TRACE COMPLETE. Exiting...");
        process.exit(0);
    });

    console.log("\n--- 🚀 SENDING REQUEST ---");
    try {
        const tx = await consumer.requestTemperature("London", JOB_ID);
        console.log(`Transaction Sent: ${tx.hash}`);
        console.log("Waiting for block confirmation...");
        await tx.wait(1);
        console.log("Transaction Mined! Events should appear above shortly.");
    } catch (e) {
        console.error("Hiba a küldéskor:", e);
    }

    // Timeout
    setTimeout(() => {
        console.log("\n❌ TIMEOUT: No response from the Node within the expected time.");
        process.exit(1);
    }, 6000); // 6 seconds timeout should be enough
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});