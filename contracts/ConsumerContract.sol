// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/operatorforwarder/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

contract ConsumerContract is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    uint256 public temperature;
    // bytes32 public jobId;
    uint256 public fee;
    bytes32 public lastRequestId;
	address private operator;

    event RequestCreated(bytes32 indexed requestId, string location);
    event RequestFulfilled(bytes32 indexed requestId, uint256 temperature);

    constructor(address _link, address _oracle) ConfirmedOwner(msg.sender) {
        _setChainlinkToken(_link);
        _setChainlinkOracle(_oracle);		// used by ChainlinkClient for sendChainlinkRequest
		operator = _oracle;
        fee =  (1 * LINK_DIVISIBILITY) / 10; // 0,1 * 10**18 (Varies by network and job);
    }

    // Sends a Chainlink request to the Operator contract.
    // The exact request keys (e.g., "get", "path", or a custom adapter key like "location")
    // depend on the job spec configured on your Chainlink node. This example uses a generic
    // `location` string parameter that a node-side external adapter can interpret.
    function requestTemperature(string memory location, string memory jobId) public onlyOwner {
        Chainlink.Request memory req = _buildChainlinkRequest(
            stringToBytes32(jobId),
            address(this),
            this.fulfillTemperature.selector
        );

		// string memory weatherApiKey = "5698e318fa3a4cc7843175723250710"; 
        // The job spec on the node will accept a "get" param and "path".
        // The exact params names depend on your job spec; this is the usual pattern.
        // string memory url = string(abi.encodePacked(
		// 	"http://api.weatherapi.com/v1/current.json?key=", weatherApiKey, "&q=", location
        // ));

        req._add("get", "http://127.0.0.1:5000/random");	//! Update the URL to your local endpoint
        // req._add("path", "current,temp_c");     // JSON path to temperature
        req._add("path", "number");     //! test endpoint returns {"number": 42}
        req._add("times", "100");

        bytes32 requestId = _sendChainlinkRequestTo(operator, req, fee);
        lastRequestId = requestId;
        emit RequestCreated(requestId, location);
    }

    // Fulfillment function called by the operator via node.
    // `recordChainlinkFulfillment` verifies the caller and that the request was valid.
    function fulfillTemperature(
        bytes32 _requestId,
        uint256 _temp
    ) public recordChainlinkFulfillment(_requestId) {
        temperature = _temp;
        emit RequestFulfilled(_requestId, _temp);
    }

	function getTemperature() public view returns (uint256) {
		return temperature;
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
