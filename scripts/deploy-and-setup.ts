import { ethers } from "hardhat";
import { updateEnvVariable, getEnvVariables, getNodeCredentials } from "../utils/helper";

async function main() {
	const { NODE_ADDRESS, CHAINLINK_URL } = getEnvVariables();
	const { email, password } = getNodeCredentials();

	const [deployer] = await ethers.getSigners();
	console.log("Deployer:", deployer.address);

	// Deploy LinkToken
	const link = await ethers.deployContract("LinkToken");
	await link.waitForDeployment();
	const linkAddress = await link.getAddress();
	updateEnvVariable("LINKTOKEN_ADDRESS", linkAddress);
	console.log("LinkToken deployed at: ", linkAddress);

	// Deploy Operator
	const operator = await ethers.deployContract("Operator", [linkAddress, deployer.address]);
	await operator.waitForDeployment();
	const operatorAddress = await operator.getAddress();
	updateEnvVariable("OPERATOR_ADDRESS", operatorAddress);
	console.log("Operator deployed at: ", operatorAddress);

	// Authorize the node wallet address
	const txAuth = await operator.setAuthorizedSenders([NODE_ADDRESS]);
	await txAuth.wait();
	console.log("Authorized sender set:", NODE_ADDRESS);

	console.log("Creating Chainlink Job...");
	try {
		console.log(`Sign in to the Chainlink API with the ${email} account...`);
		const loginResponse = await fetch(`${CHAINLINK_URL}/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});

		if (!loginResponse.ok) {
			throw new Error(`Failed to login to Chainlink API: ${loginResponse.statusText}`);
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

		console.log("Submitting job to Chainlink Node...");
		const jobResponse = await fetch(`${CHAINLINK_URL}/v2/jobs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Cookie": cookie || "",
			},
			body: JSON.stringify({ toml: jobSpecToml }),
		});

		if (!jobResponse.ok) {
			const errorData = await jobResponse.json();
			throw new Error(`Failed to create job: ${JSON.stringify(errorData)}`);
		}

		const jobData = await jobResponse.json();
		console.log(`Job successfully created!`);
		console.log(`External Job ID: ${jobData.data.attributes.externalJobID}`);
		updateEnvVariable("JOB_ID", jobData.data.attributes.externalJobID.replace(/-/g, ""));

	} catch (error) {
		console.error("Error creating Chainlink Job:", error);
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
	const mintAmount = ethers.parseUnits("1000", 18);
	const txMint = await link.mint(deployer.address, mintAmount);
	await txMint.wait();
	console.log(`Minted ${ethers.formatUnits(mintAmount, 18)} LINK to deployer`);

	// Fund ConsumerContract with LINK so it can make requests
	let tx = await link.transfer(consumerAddress, mintAmount);
	await tx.wait();
	console.log(`Funded ConsumerContract with 1000 LINK`);

	// Fund node with ETH
	// this is needed to pay for gas when fulfilling requests (writing to the blockchain)
	const txEth = await deployer.sendTransaction({
		to: NODE_ADDRESS,
		value: ethers.parseEther("1"),
	});
	await txEth.wait();
	console.log("Node wallet funded with 1 ETH");

	console.log("Setup complete!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
