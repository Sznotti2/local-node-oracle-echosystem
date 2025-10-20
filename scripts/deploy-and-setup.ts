// scripts/bootstrap.ts
import fs from "fs";
import path from "path";
import hre from "hardhat";
const { ethers } = hre as any;

async function main() {
  const nodeWalletAddress = process.env.NODE_WALLET
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Deploy LinkToken
  const LinkToken = await ethers.getContractFactory("LinkToken");
  const link = await LinkToken.deploy();
  await link.deployed();
  console.log("LinkToken deployed at: ", link.address);

  // Deploy Operator
  const Operator = await ethers.getContractFactory("Operator");
  const operator = await Operator.deploy(link.address, deployer.address);
  await operator.deployed();
  console.log("Operator deployed at: ", operator.address);

  // Authorize the node wallet address
  const txAuth = await operator.setAuthorizedSenders([nodeWalletAddress]);
  await txAuth.wait();
  console.log("Authorized sender set:", nodeWalletAddress);

  // Deploy ConsumerContract
  const ConsumerContract = await ethers.getContractFactory("ConsumerContract");
  const consumer = await ConsumerContract.deploy(link.address, operator.address);
  await consumer.deployed();
  console.log("ConsumerContract deployed at:", consumer.address);

  // Mint test LINK to deployer so we can fund the consumer and the node
  const grantRoleTx = await link.grantMintRole(deployer.address);
	await grantRoleTx.wait();
  const mintAmount = ethers.utils.parseUnits("100", 18);
  const txMint = await link.mint(deployer.address, mintAmount);
  await txMint.wait();
  console.log(`Minted ${ethers.utils.formatUnits(mintAmount, 18)} LINK to deployer`);
  
  // Fund ConsumerContract with LINK so it can make requests
  const fundAmount = ethers.utils.parseUnits("5", 18);
  let tx = await link.transfer(consumer.address, fundAmount);
  await tx.wait();
  console.log(`Funded ConsumerContract with 5 LINK`);

  // Fund node with ETH
  // this is needed to pay for gas when fulfilling requests (writing to the blockchain)
  const txEth = await deployer.sendTransaction({
    to: nodeWalletAddress,
    value: ethers.utils.parseEther("5"),
  });
  await txEth.wait();
  console.log("Node wallet funded with 5 ETH");

  // Write addresses to deploy-output.json
  const out = {
    LINK_ADDRESS: link.address,
    OPERATOR_ADDRESS: operator.address,
    CONSUMER_ADDRESS: consumer.address,
  };
  fs.writeFileSync(path.join(process.cwd(), "deploy-output.json"), JSON.stringify(out, null, 2));
  console.log("Wrote deploy-output.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
