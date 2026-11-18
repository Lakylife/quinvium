// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Published source code of contracts
/// @notice Anyone can publish the Solidity source and compiler settings of a deployed contract. Nothing is checked here:
/// every Explorer visitor compiles the published source in the browser and compares it with the code on chain, so a wrong
/// or fake publication is simply shown as not matching. There is no owner, no fee and no upgrade.
/// The data (gzip compressed Standard JSON input with the compiler version) lives in the event. The contract only keeps
/// the blocks of publications, so they can be found without scanning the whole chain: the latest one of each publisher
/// (spam by others cannot push out the publication of the contract's creator) and the most recent ones of anybody.
contract SourceRegistry {
    /// How many of the most recent publications of a contract are kept for lookup; older ones stay in the events.
    uint256 public constant RECENT = 16;

    /// Block of the latest publication of `target` by `publisher`, 0 when none.
    mapping(address target => mapping(address publisher => uint256)) public lastBlock;

    mapping(address => uint256[]) private _recent;
    mapping(address => uint256) private _published;

    event Published(address indexed target, address indexed publisher, bytes data);

    error NotAContract();
    error EmptyData();

    /// Publishes the source of `target`, a contract that already exists.
    function publish(address target, bytes calldata data) external {
        if (target.code.length == 0) revert NotAContract();
        if (data.length == 0) revert EmptyData();
        lastBlock[target][msg.sender] = block.number;
        uint256[] storage list = _recent[target];
        uint256 n = _published[target]++;
        if (list.length < RECENT) list.push(block.number);
        else list[n % RECENT] = block.number;
        emit Published(target, msg.sender, data);
    }

    /// Blocks of the most recent publications of `target` (at most RECENT, in no particular order).
    function recent(address target) external view returns (uint256[] memory) {
        return _recent[target];
    }

    /// Number of all publications of `target`.
    function published(address target) external view returns (uint256) {
        return _published[target];
    }
}
