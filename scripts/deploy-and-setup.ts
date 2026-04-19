import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const nodeWalletAddress = process.env.NODE_ADDRESS || process.env.NODE_WALLET;
  const CHAINLINK_NODE_URL = process.env.CHAINLINK_NODE_URL || "http://localhost:6688";

  const credentialsPath = path.join(__dirname, "../chainlink-config/apicredentials");
  const API_EMAIL = fs.readFileSync(credentialsPath, "utf-8").split("\n")[0];
  const API_PASSWORD = fs.readFileSync(credentialsPath, "utf-8").split("\n")[1];

  if (!API_EMAIL || !API_PASSWORD) {
    throw new Error("Az apicredentials fájl üres vagy hibás formátumú!");
  }
  
  if (!nodeWalletAddress) {
    throw new Error("NODE_ADDRESS env variable is missing!");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Deploy LinkToken
  const link = await ethers.deployContract("LinkToken");
  await link.waitForDeployment();
  const linkAddress = await link.getAddress();
  console.log("LinkToken deployed at: ", linkAddress);

  // Deploy Operator
  const operator = await ethers.deployContract("Operator", [linkAddress, deployer.address]);
  await operator.waitForDeployment();
  const operatorAddress = await operator.getAddress();
  console.log("Operator deployed at: ", operatorAddress);

  // Authorize the node wallet address
  const txAuth = await operator.setAuthorizedSenders([nodeWalletAddress]);
  await txAuth.wait();
  console.log("Authorized sender set:", nodeWalletAddress);

  console.log("Creating Chainlink Job...");
  try {
	console.log(`Sign in to the Chainlink API with the ${API_EMAIL} account...`);
    const loginResponse = await fetch(`${CHAINLINK_NODE_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: API_EMAIL, password: API_PASSWORD }),
    });

    if (!loginResponse.ok) {
        throw new Error(`Failed to login to Chainlink API: ${loginResponse.statusText}`);
    }

    const cookie = loginResponse.headers.get("set-cookie");

    const jobSpecToml = `
type = "directrequest"
schemaVersion = 1
name = "Get > Uint256"
externalJobID = "1d320673-e762-45aa-b12a-c929a794d2b2"
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
	encode_tx    [type="ethabiencode"
				abi="fulfillOracleRequest2(bytes32 requestId, uint256 payment, address callbackAddress, bytes4 callbackFunctionId, uint256 expiration, bytes calldata data)"
				data="{\\\\"requestId\\\\": $(decode_log.requestId), \\\\"payment\\\\":   $(decode_log.payment), \\\\"callbackAddress\\\\": $(decode_log.callbackAddr), \\\\"callbackFunctionId\\\\": $(decode_log.callbackFunctionId), \\\\"expiration\\\\": $(decode_log.cancelExpiration), \\\\"data\\\\": $(encode_data)}"
				]
	submit_tx    [type="ethtx" to="${operatorAddress}" data="$(encode_tx)"]

	decode_log -> decode_cbor -> fetch -> parse -> multiply -> encode_data -> encode_tx -> submit_tx
"""
    `;

	console.log("Submitting job to Chainlink Node...");
    const jobResponse = await fetch(`${CHAINLINK_NODE_URL}/v2/jobs`, {
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
    console.log(`Job ID (UUID): ${jobData.data.id}`);
    console.log(`External Job ID: ${jobData.data.attributes.externalJobID}`);

  } catch (error) {
    console.error("Error creating Chainlink Job:", error);
  }


  // Deploy ConsumerContract
  const consumer = await ethers.deployContract("ConsumerContract", [linkAddress, operatorAddress]);
  await consumer.waitForDeployment();
  const consumerAddress = await consumer.getAddress();
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
    to: nodeWalletAddress,
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
