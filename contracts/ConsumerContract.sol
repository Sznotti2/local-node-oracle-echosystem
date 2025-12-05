// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/operatorforwarder/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

/**
 * @title Consumer Contract for Weather Insurance using Chainlink Oracle
 * @notice This contract allows users to purchase weather insurance policies
 *         that pay out based on temperature data provided by a Chainlink oracle.
 */
contract ConsumerContract is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    uint256 public temperature;
    // bytes32 public jobId;
    uint256 public fee;
    bytes32 public lastRequestId;
	address private operator;

    event RequestCreated(bytes32 indexed requestId, string location);
    event RequestFulfilled(bytes32 indexed requestId, uint256 temperature);

	uint256 public constant MIN_DURATION = 1 days;
	struct Policy {
        address purchaser;
        address payable beneficiary;
        bytes32 location; // stringToBytes32(location)
        uint256 threshold; // same units as 'temperature'
        uint256 payout; // wei to pay out on claim
        uint256 premium; // wei paid by purchaser
        uint256 start;
        uint256 duration;
        bool active;
        bool paid;
    }

    Policy[] public policies;
    mapping(bytes32 => bytes32) public requestLocation; // requestId => location (bytes32)
    mapping(bytes32 => uint256[]) public policiesByLocation; // location hash => policy ids

    event PolicyPurchased(uint256 indexed policyId, address purchaser, address beneficiary, bytes32 location, uint256 payout);
    event PolicyPayout(uint256 indexed policyId, address beneficiary, uint256 payout);
	event FailedPayout(uint256 indexed policyId, address beneficiary, uint256 payout);
    event PolicyExpired(uint256 indexed policyId);
	event NotEnoughBalance(uint256 contractBalance, address beneficiary, uint256 payout);

    constructor(address _link, address _oracle) ConfirmedOwner(msg.sender) {
        _setChainlinkToken(_link);
        _setChainlinkOracle(_oracle);		// used by ChainlinkClient for sendChainlinkRequest
		operator = _oracle;
        fee = (1 * LINK_DIVISIBILITY) / 10; // 0,1 * 10**18 (Varies by network and job);
    }

    // Sends a Chainlink request to the Operator contract.
    function requestTemperature(string memory city, string memory jobId) public onlyOwner {
        Chainlink.Request memory req = _buildChainlinkRequest(
            stringToBytes32(jobId),
            address(this),
            this.fulfillTemperature.selector
        );

		string memory apiUrl = string.concat(
			"http://local-api:5000/weather?city=",	// 'local-api' is the Docker service name
			city
		);
		req._add("apiUrl", apiUrl);
		req._add("path", "temperature"); // JSON path to extract

        bytes32 requestId = _sendChainlinkRequestTo(operator, req, fee);
        lastRequestId = requestId;
		// remember which city this request was for so fulfillment can evaluate policies
        requestLocation[requestId] = stringToBytes32(city);
        emit RequestCreated(requestId, city);
    }

    // Fulfillment function called by the operator via node.
    // `recordChainlinkFulfillment` verifies the caller and that the request was valid.
    function fulfillTemperature(
        bytes32 _requestId,
        uint256 _temp
    ) public recordChainlinkFulfillment(_requestId) {
        temperature = _temp;
        emit RequestFulfilled(_requestId, _temp);

		// evaluate and pay matching policies for this request/location
        bytes32 loc = requestLocation[_requestId];
        if (loc != bytes32(0)) {
            _evaluatePoliciesForLocation(loc, _temp);
        }
    }

    // Internal: evaluate policies for a location and pay those that meet the condition.
    function _evaluatePoliciesForLocation(bytes32 loc, uint256 recordedTemp) internal {
        uint256[] storage ids = policiesByLocation[loc];
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 pid = ids[i];
            Policy storage policy = policies[pid];
            if (!policy.active || policy.paid) continue;
            // check coverage window
            if (block.timestamp > policy.start + policy.duration) {
                policy.active = false;
                emit PolicyExpired(pid);
                continue;
            }
            // If recordedTemp is higher than threshold => pay
            if (recordedTemp > policy.threshold) {
                uint256 amount = policy.payout;
                // Pay beneficiary if contract has funds
                if (address(this).balance >= amount) {
                    (bool sent, ) = policy.beneficiary.call{value: amount}("");
                    if (sent) {
						policy.paid = true;
						policy.active = false;
                        emit PolicyPayout(pid, policy.beneficiary, amount);
                    } else {
                        // If send failed, mark not paid so owner can withdraw later or retry
                        policy.paid = false;
						emit FailedPayout(pid, policy.beneficiary, amount);
                    }
                } else {
                    // Not enough balance: mark inactive and leave paid=false
					emit NotEnoughBalance(address(this).balance, policy.beneficiary, amount);
                }
            }
        }
    }

	function evaluatePoliciesForTest(
		string memory location,
		uint256 recordedTemp
		) external onlyOwner {
		_evaluatePoliciesForLocation(stringToBytes32(location), recordedTemp);
	}

	// Purchase an insurance policy for a given location.
    // - location: human readable (will be converted by stringToBytes32)
    // - duration: seconds coverage
    // - threshold: if recorded temperature <= threshold then payout triggers
    // - payout: wei to be paid to beneficiary if claim triggers
    // Sender must send 'premium' as msg.value; premium is retained in contract to pay claims.
    function buyPolicy(
        string memory location,
        uint256 duration,
        uint256 threshold,
        address payable beneficiary
    ) external payable returns (uint256) {
        require(msg.value > 0, "premium required");
		require(duration >= MIN_DURATION, "duration can't be lower than a day");
        bytes32 locHash = stringToBytes32(location);
        Policy memory p = Policy({
            purchaser: msg.sender,
            beneficiary: beneficiary,
            location: locHash,
            threshold: threshold * 100, // match units of temperature
            payout: msg.value * 2, // example: payout is 2x premium
            premium: msg.value,
            start: block.timestamp,
            duration: duration,
            active: true,
            paid: false
        });
        policies.push(p);
        uint256 pid = policies.length - 1;
        policiesByLocation[locHash].push(pid);
        emit PolicyPurchased(pid, msg.sender, beneficiary, locHash, p.payout);
        return pid;
    }

	// Allow owner and purchaser to cancel an active, unpaid policy and get a refund of premium.
	function refundPolicy(uint256 policyId) external {
		require(policyId < policies.length, "invalid policyId");
		Policy storage policy = policies[policyId];
		require(msg.sender == policy.purchaser || msg.sender == owner(), "you are not allowed to cancel");
		require(policy.active, "policy not active");
		require(!policy.paid, "policy already paid");
		policy.active = false;
		// Refund premium to purchaser
		uint256 refund = policy.premium;
		policy.premium = 0;
		(bool sent, ) = policy.purchaser.call{value: refund}("");
		require(sent, "refund failed");
	}

	// Getter functions for testing
	function getPolicy(uint256 policyId) public view returns (Policy memory) {
		require(policyId < policies.length, "invalid policyId");
		return policies[policyId];
	}
	function getPoliciesCount() public view returns (uint256) {
		return policies.length;
	}
	function getPoliciesByLocation(string memory location) public view returns (uint256[] memory) {
		bytes32 locHash = stringToBytes32(location);
		return policiesByLocation[locHash];
	}
	function getContractBalance() public view returns (uint256) {
		return address(this).balance;
	}
	function getLinkBalance() public view returns (uint256) {
		LinkTokenInterface link = LinkTokenInterface(_chainlinkTokenAddress());
		return link.balanceOf(address(this));
	}
	// function getTemperature() public view returns (uint256) {
	// 	return temperature;
	// }
	// function getLastRequestId() public view returns (bytes32) {
	// 	return lastRequestId;
	// }

    // Allow the contract to receive ETH (premiums or owner funding for payouts)
    receive() external payable {}

    // Owner can withdraw leftover ETH (e.g. unused premiums)
    function withdrawETH(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "insufficient balance");
        (bool sent, ) = owner().call{value: amount}("");
        require(sent, "withdraw failed");
    }

    // Withdraw any LINK accidentally left in the contract
    function withdrawLink() external onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(_chainlinkTokenAddress());
        uint256 bal = link.balanceOf(address(this));
        require(bal > 0, "no LINK");
        require(link.transfer(owner(), bal), "transfer failed");
    }

	function stringToBytes32(
        string memory source
    ) private pure returns (bytes32 result) {
        bytes memory tempEmptyStringTest = bytes(source);
        if (tempEmptyStringTest.length == 0) {
            return 0x0;
        }

        assembly {
            // solhint-disable-line no-inline-assembly
            result := mload(add(source, 32))
        }
    }
}
