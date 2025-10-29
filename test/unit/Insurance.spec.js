const { ethers } = require("hardhat")
const { assert, expect } = require("chai")
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")

describe("Consumer contract", function() {
	async function deployConsumerContractFixture() {
		const [owner, Bob, Philip, Charlie, Dave, Vilma, Alice] = await ethers.getSigners()

		const LinkToken = await ethers.getContractFactory("LinkToken")
		const linkToken = await LinkToken.deploy()

		const ConsumerContract = await ethers.getContractFactory("ConsumerContract")
		const consumerContract = await ConsumerContract.deploy(linkToken.address, owner.address) // owner is also the oracle and LinkToken for testing

		return { consumerContract, linkToken, owner, Bob, Philip, Charlie, Dave, Vilma, Alice }
	}

	async function buyPolicy(consumerContract, purchaser, beneficiary, overrides = {}) {
		// Default parameters
		const {
			location = "Szeged",
			duration = 1 * 24 * 60 * 60, // 1 day
			threshold = 30,
			premium = ethers.utils.parseEther("1"),
		} = overrides
		const tx = await consumerContract
			.connect(purchaser)
			.buyPolicy(location, duration, threshold, beneficiary.address, { value: premium })
		const receipt = await tx.wait()
		const purchaseEvent = receipt.events.find((event) => event.event === "PolicyPurchased")
		const policyId = purchaseEvent.args.policyId
		return { policyId }
	}

	describe("Deployment", function() {
		it("sets the owner correctly", async function() {
			const { consumerContract, owner } = await loadFixture(deployConsumerContractFixture)
			const contractOwner = await consumerContract.owner()
			assert.equal(contractOwner, owner.address)
		})
		it("has zero ETH and Link initially", async function() {
			const { consumerContract } = await loadFixture(deployConsumerContractFixture)
			const ethBalance = await consumerContract.getContractBalance()
			assert.equal(ethBalance.toString(), "0")

			const linkBalance = await consumerContract.getLinkBalance()
			assert.equal(linkBalance.toString(), "0")
		})
		it("can receive ETH", async function() {
			const { consumerContract, owner } = await loadFixture(deployConsumerContractFixture)
			const tx = {
				to: consumerContract.address,
				value: ethers.utils.parseEther("1.0"),
			}
			await owner.sendTransaction(tx)
			const balance = await ethers.provider.getBalance(consumerContract.address)
			assert.equal(balance.toString(), ethers.utils.parseEther("1.0").toString())
		})
		it("can only withdraw ETH by owner", async function() {
			const { consumerContract, owner, Bob } = await loadFixture(deployConsumerContractFixture)
			const amount = ethers.utils.parseEther("1.0")

			// send 1 ETH to the contract
			const txSend = {
				to: consumerContract.address,
				value: amount,
			}
			await owner.sendTransaction(txSend)

			// attempt withdraw by non-owner should fail
			await expect(
				consumerContract.connect(Bob).withdrawETH(amount)
			).to.be.revertedWith("Only callable by owner")

			const ownerBalanceBefore = await ethers.provider.getBalance(owner.address)
			const withdrawTx = await consumerContract.connect(owner).withdrawETH(amount)
			const receipt = await withdrawTx.wait()
			const gasPaid = receipt.gasUsed.mul(receipt.effectiveGasPrice)
			const ownerBalanceAfter = await ethers.provider.getBalance(owner.address)
			expect(ownerBalanceAfter).to.equal(ownerBalanceBefore.add(amount).sub(gasPaid))

			// console.log("Owner balance before:", ethers.utils.formatEther(ownerBalanceBefore))
			// console.log("Owner balance after:", ethers.utils.formatEther(ownerBalanceAfter))
			// console.log("Amount withdrawn:", ethers.utils.formatEther(amount))
			// console.log("Gas paid for withdrawETH:", ethers.utils.formatEther(gasPaid))

			const contractBalance = await ethers.provider.getBalance(consumerContract.address)
			assert.equal(contractBalance.toString(), "0")
		})
		it("can receive Link", async function() {
			const { consumerContract, linkToken, owner } = await loadFixture(deployConsumerContractFixture)

			const grantRoleTx = await linkToken.grantMintRole(owner.address)
			await grantRoleTx.wait()
			const amount = ethers.utils.parseUnits("10", 18)
			const txMint = await linkToken.mint(owner.address, amount)
			await txMint.wait()

			// transfer 10 Link to the contract
			await linkToken.connect(owner).transfer(consumerContract.address, amount)

			const linkBalance = await consumerContract.getLinkBalance()
			assert.equal(linkBalance.toString(), amount.toString())
		})
		it("can only withdraw Link by owner", async function() {
			const { consumerContract, linkToken, owner, Bob } = await loadFixture(deployConsumerContractFixture)

			const grantRoleTx = await linkToken.grantMintRole(owner.address)
			await grantRoleTx.wait()
			const amount = ethers.utils.parseUnits("10", 18)
			const txMint = await linkToken.mint(owner.address, amount)
			await txMint.wait()

			// transfer 10 Link to the contract
			await linkToken.connect(owner).transfer(consumerContract.address, amount)

			// attempt withdraw by non-owner should fail
			await expect(
				consumerContract.connect(Bob).withdrawLink()
			).to.be.revertedWith("Only callable by owner")

			// withdraw by owner
			const withdrawTx = await consumerContract.connect(owner).withdrawLink()
			await withdrawTx.wait()

			const ownerBalance = await linkToken.balanceOf(owner.address)
			assert.equal(ownerBalance.toString(), amount.toString())

			const contractBalance = await consumerContract.getLinkBalance()
			assert.equal(contractBalance.toString(), "0")
		})
	})
	describe("buyPolicy", function() {
		it("allows buying a policy with default parameters", async function() {
			const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
			const premium = ethers.utils.parseEther("1")
			const { policyId } = await buyPolicy(
				consumerContract,
				Bob,
				Philip
			)

			const policy = await consumerContract.getPolicy(policyId)
			expect(policy.purchaser).to.equal(Bob.address)
			expect(policy.beneficiary).to.equal(Philip.address)
			expect(policy.location).to.equal(ethers.utils.formatBytes32String("Szeged"))
			expect(policy.duration).to.equal(24 * 60 * 60) // 1 day
			expect(policy.threshold).to.equal(30 * 100) // stored with 2 decimals
			expect(policy.premium).to.equal(premium)
			expect(policy.payout).to.equal(ethers.utils.parseEther("1").mul(2)) // payout is 2x premium
			expect(policy.active).to.equal(true)
			expect(policy.paid).to.equal(false)
		})
		it("rejects buying a policy with zero premium", async function() {
			const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
			await expect(
				buyPolicy(consumerContract, Bob, Philip, { premium: 0 })
			).to.be.revertedWith("premium required")
		})
		it("rejects buying a policy with less than minimum duration", async function() {
			const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
			await expect(
				buyPolicy(consumerContract, Bob, Philip, { duration: 12 * 60 * 60 }) // 12 hours
			).to.be.revertedWith("duration can't be lower than a day")
		})
		it("contract receives the premium upon policy purchase", async function() {
			const { consumerContract, owner, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
			const premium = ethers.utils.parseEther("1")

			const contractBalanceBefore = await ethers.provider.getBalance(consumerContract.address)
			expect(contractBalanceBefore.toString()).to.equal("0")

			await buyPolicy(consumerContract, Bob, Philip, { premium })

			const contractBalanceAfter = await ethers.provider.getBalance(consumerContract.address)
			expect(contractBalanceAfter.toString()).to.equal(premium.toString())
		})
	})
})