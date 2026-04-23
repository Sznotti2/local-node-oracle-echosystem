import { ethers } from "hardhat";
import { updateEnvVariable, getEnvVariablesDon, getNodeCredentials } from "../utils/helper";

async function main() {
	const env = getEnvVariablesDon();
    const { email, password } = getNodeCredentials();

    const [deployer] = await ethers.getSigners();
    console.log("Deployer's address:", deployer.address);

	// Deploy LinkToken
    const link = await ethers.deployContract("LinkToken");
    await link.waitForDeployment();
    const linkAddress = await link.getAddress();
    updateEnvVariable("LINKTOKEN_ADDRESS", linkAddress);
    console.log("LinkToken deployed at:", linkAddress);

	// Deploy Operator
    const operator = await ethers.deployContract("Operator", [linkAddress, deployer.address]);
    await operator.waitForDeployment();
    const operatorAddress = await operator.getAddress();
    updateEnvVariable("OPERATOR_ADDRESS", operatorAddress);
    console.log("Operator deployed at:", operatorAddress);

	// Authorize the node wallet address
    const txAuth = await operator.setAuthorizedSenders(env.NODE_ADDRESSES);
    await txAuth.wait();
    console.log("Authorized senders (Nodes) set: [\n" + env.NODE_ADDRESSES.join(",\n") + "\n]");

    // Funding and creating a Job for each node
    console.log("\nFunding and creating a Job for each node...");
    for (let i = 1; i <= env.NUMBER_OF_NODES; i++) {
		const index = i - 1;

		const txEth = await deployer.sendTransaction({
            to: env.NODE_ADDRESSES[index],
            value: ethers.parseEther("1"),
        });
        await txEth.wait();
        console.log(`[Node ${i}]`);
        console.log(`\tWallet (${env.NODE_ADDRESSES[index]}) funded with 1 ETH-val`);


		const url = env.CHAINLINK_URLS[index];
        console.log(`\tSigning in to the Chainlink API: ${url}...`);

        try {
            const loginResponse = await fetch(`${url}/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            if (!loginResponse.ok) {
                throw new Error(`[Error] Failed to login: ${loginResponse.statusText}`);
            }

            const cookie = loginResponse.headers.get("set-cookie");

			// 4 backslash are nevessary to escape "
            const jobSpecToml = `
type = "directrequest"
schemaVersion = 1
name = "Get > Uint256"
maxTaskDuration = "0s"
contractAddress = "${operatorAddress}"
evmChainID = "31337"
minIncomingConfirmations = 0
observationSource = """
	decode_log   [type="ethabidecodelog"
				abi="OracleRequest(bytes32 indexed specId, address requester, bytes32 requestId, uint256 payment, address callbackAddr, bytes4 callbackFunctionId, uint256 cancelExpiration, uint256 dataVersion, bytes data)"
				data="$(jobRun.logData)"
				topics="$(jobRun.logTopics)"]

	decode_cbor  [type="cborparse" data="$(decode_log.data)"]
	fetch        [type="http" method=GET url="$(decode_cbor.apiUrl)" allowUnrestrictedNetworkAccess="true"]
	parse        [type="jsonparse" path="$(decode_cbor.path)" data="$(fetch)"]

	multiply     [type="multiply" input="$(parse)" times="100"]

	encode_data  [type="ethabiencode" abi="(bytes32 requestId, uint256 value)" data="{ \\\\"requestId\\\\": $(decode_log.requestId), \\\\"value\\\\": $(multiply) }"]
	encode_tx    [type="ethabiencode" abi="fulfillOracleRequest2(bytes32 requestId, uint256 payment, address callbackAddress, bytes4 callbackFunctionId, uint256 expiration, bytes calldata data)"
				data="{\\\\"requestId\\\\": $(decode_log.requestId), \\\\"payment\\\\":   $(decode_log.payment), \\\\"callbackAddress\\\\": $(decode_log.callbackAddr), \\\\"callbackFunctionId\\\\": $(decode_log.callbackFunctionId), \\\\"expiration\\\\": $(decode_log.cancelExpiration), \\\\"data\\\\": $(encode_data)}"
				]
	submit_tx    [type="ethtx" to="${operatorAddress}" data="$(encode_tx)"]

	decode_log -> decode_cbor -> fetch -> parse -> multiply -> encode_data -> encode_tx -> submit_tx
"""
            `;

            const jobResponse = await fetch(`${url}/v2/jobs`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Cookie": cookie || "",
                },
                body: JSON.stringify({ toml: jobSpecToml }),
            });

            if (!jobResponse.ok) {
                const errorData = await jobResponse.json();
                throw new Error(`[Error] Failed to create job: ${JSON.stringify(errorData)}`);
            }

            const jobData = await jobResponse.json();
            const externalJobID = jobData.data.attributes.externalJobID.replace(/-/g, "");
            console.log(`\tJob successfully created! ID: ${externalJobID}`);
            updateEnvVariable(`JOB_ID_${i}`, externalJobID);

        } catch (error) {
            console.error(`\tError creating job:`, error);
        }
    }

	// Deploy ConsumerContract
    const consumer = await ethers.deployContract("ConsumerContract", [linkAddress, operatorAddress]);
    await consumer.waitForDeployment();
    const consumerAddress = await consumer.getAddress();
    updateEnvVariable("CONSUMER_ADDRESS", consumerAddress);
	console.log("ConsumerContract deployed at:", consumerAddress);

	// Mint test LINK to deployer so we can fund the consumer and the node
    const grantRoleTx = await link.grantMintRole(deployer.address);
    await grantRoleTx.wait();
	// for 5 node setup, 5000 LINK should be enough for testing
    const mintAmount = ethers.parseUnits("5000", 18); 
    const txMint = await link.mint(deployer.address, mintAmount);
    await txMint.wait();
	console.log(`Minted ${ethers.formatUnits(mintAmount, 18)} LINK to deployer`);
	
	// Fund ConsumerContract with LINK so it can make requests
    let tx = await link.transfer(consumerAddress, mintAmount);
    await tx.wait();
	console.log(`Funded ConsumerContract with 5000 LINK`);

	console.log("Setup complete!");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});