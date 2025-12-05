import { ethers } from "hardhat";

async function main() {
  const nodeWalletAddress = process.env.CHAINLINK_NODE_ADDRESS || process.env.NODE_WALLET;
  
  if (!nodeWalletAddress) {
    throw new Error("CHAINLINK_NODE_ADDRESS or NODE_WALLET env variable is missing!");
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
