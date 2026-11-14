// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Multisig wallet: companies, associations and shared accounts.
contract Multisig {
    struct Proposal {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    uint256 public constant MAX_OWNERS = 32;

    address[] private owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;
    Proposal[] private proposals;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    event Deposit(address indexed from, uint256 value);
    event Submitted(uint256 indexed id, address indexed by, address indexed to, uint256 value);
    event Confirmed(uint256 indexed id, address indexed by);
    event Revoked(uint256 indexed id, address indexed by);
    event Executed(uint256 indexed id);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 threshold);

    error InvalidConfig();
    error OnlyThroughProposal();
    error NotOwner();
    error UnknownProposal();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error CallFailed();

    constructor(address[] memory owners_, uint256 threshold_) {
        if (owners_.length == 0 || owners_.length > MAX_OWNERS || threshold_ == 0 || threshold_ > owners_.length) revert InvalidConfig();
        for (uint256 i; i < owners_.length; i++) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert InvalidConfig();
            isOwner[o] = true;
        }
        owners = owners_;
        threshold = threshold_;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    /// Owner changes are approved by the owners themselves: the proposal calls the wallet itself.
    /// Without it a member leaving or a lost key would mean frozen money.
    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlyThroughProposal();
        _;
    }

    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 id) {
        id = proposals.length;
        proposals.push(Proposal(to, value, data, false));
        emit Submitted(id, msg.sender, to, value);
        _confirm(id);
    }

    function confirm(uint256 id) external onlyOwner {
        _confirm(id);
    }

    function revoke(uint256 id) external onlyOwner {
        _open(id);
        if (!confirmed[id][msg.sender]) revert NotConfirmed();
        confirmed[id][msg.sender] = false;
        emit Revoked(id, msg.sender);
    }

    function execute(uint256 id) external onlyOwner {
        Proposal storage p = _open(id);
        if (confirmationCount(id) < threshold) revert NotEnoughConfirmations();
        p.executed = true;
        emit Executed(id);
        (bool ok, ) = p.to.call{value: p.value}(p.data);
        if (!ok) revert CallFailed();
    }

    function addOwner(address owner) external onlySelf {
        if (owner == address(0) || isOwner[owner] || owners.length >= MAX_OWNERS) revert InvalidConfig();
        isOwner[owner] = true;
        owners.push(owner);
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlySelf {
        if (!isOwner[owner] || owners.length - 1 < threshold) revert InvalidConfig();
        isOwner[owner] = false;
        for (uint256 i; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function setThreshold(uint256 threshold_) external onlySelf {
        if (threshold_ == 0 || threshold_ > owners.length) revert InvalidConfig();
        threshold = threshold_;
        emit ThresholdChanged(threshold_);
    }

    /// Counted only now: the approval of a member who is no longer an owner does not count.
    function confirmationCount(uint256 id) public view returns (uint256 count) {
        for (uint256 i; i < owners.length; i++) {
            if (confirmed[id][owners[i]]) count++;
        }
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    function _open(uint256 id) private view returns (Proposal storage p) {
        if (id >= proposals.length) revert UnknownProposal();
        p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
    }

    function _confirm(uint256 id) private {
        _open(id);
        if (confirmed[id][msg.sender]) revert AlreadyConfirmed();
        confirmed[id][msg.sender] = true;
        emit Confirmed(id, msg.sender);
    }
}

/// @title Factory for multisig wallets
contract MultisigFactory {
    mapping(address => address[]) private byOwner;

    event WalletCreated(address indexed wallet, address indexed creator, uint256 threshold);

    function create(address[] calldata owners, uint256 threshold) external returns (address wallet) {
        wallet = address(new Multisig(owners, threshold));
        for (uint256 i; i < owners.length; i++) byOwner[owners[i]].push(wallet);
        emit WalletCreated(wallet, msg.sender, threshold);
    }

    function walletsOf(address owner) external view returns (address[] memory) {
        return byOwner[owner];
    }
}
