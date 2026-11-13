// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Dodavatelský řetězec: původ a cesta zboží (potraviny, léky, logistika, luxusní zboží)
contract SupplyChain {
    struct Item {
        address creator;
        address custodian;
        address pendingCustodian;
        uint64 createdAt;
        uint32 stepCount;
        bool closed;
        string sku;
    }

    struct Step {
        address actor;
        uint64 time;
        string location;
        string status;
        bytes32 evidence;
    }

    uint256 public itemCount;
    mapping(uint256 => Item) private items;
    mapping(uint256 => mapping(uint256 => Step)) private steps;

    event ItemCreated(uint256 indexed id, address indexed creator, string sku);
    event StepAdded(uint256 indexed id, uint256 indexed index, address indexed actor, string location, string status, bytes32 evidence);
    event TransferOffered(uint256 indexed id, address indexed from, address indexed to);
    event TransferAccepted(uint256 indexed id, address indexed custodian);
    event ItemClosed(uint256 indexed id);

    error NotCustodian();
    error NotPending();
    error Closed();
    error UnknownItem();
    error ZeroAddress();

    function create(string calldata sku) external returns (uint256 id) {
        id = ++itemCount;
        Item storage it = items[id];
        it.creator = msg.sender;
        it.custodian = msg.sender;
        it.createdAt = uint64(block.timestamp);
        it.sku = sku;
        emit ItemCreated(id, msg.sender, sku);
    }

    function addStep(uint256 id, string calldata location, string calldata status, bytes32 evidence) external {
        Item storage it = _open(id);
        if (it.custodian != msg.sender) revert NotCustodian();
        uint256 index = it.stepCount++;
        steps[id][index] = Step(msg.sender, uint64(block.timestamp), location, status, evidence);
        emit StepAdded(id, index, msg.sender, location, status, evidence);
    }

    /// Předání má dva kroky, zboží se tak nedá nikomu vnutit ani omylem poslat do prázdna.
    function offerTransfer(uint256 id, address to) external {
        Item storage it = _open(id);
        if (it.custodian != msg.sender) revert NotCustodian();
        if (to == address(0)) revert ZeroAddress();
        it.pendingCustodian = to;
        emit TransferOffered(id, msg.sender, to);
    }

    function acceptTransfer(uint256 id) external {
        Item storage it = _open(id);
        if (it.pendingCustodian != msg.sender) revert NotPending();
        it.custodian = msg.sender;
        it.pendingCustodian = address(0);
        emit TransferAccepted(id, msg.sender);
    }

    function close(uint256 id) external {
        Item storage it = _open(id);
        if (it.custodian != msg.sender) revert NotCustodian();
        it.closed = true;
        emit ItemClosed(id);
    }

    function getItem(uint256 id) external view returns (Item memory) {
        if (items[id].createdAt == 0) revert UnknownItem();
        return items[id];
    }

    function getStep(uint256 id, uint256 index) external view returns (Step memory) {
        return steps[id][index];
    }

    function _open(uint256 id) private view returns (Item storage it) {
        it = items[id];
        if (it.createdAt == 0) revert UnknownItem();
        if (it.closed) revert Closed();
    }
}
