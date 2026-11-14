// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Polls: municipalities, associations, cooperatives, shareholders, owners' associations
/// @notice The list of eligible voters is a Merkle tree: only the root is on chain, not the whole list.
contract Polls {
    struct Poll {
        address creator;
        uint64 endsAt;
        uint32 optionCount;
        bytes32 voters;
        string title;
    }

    uint256 public pollCount;
    mapping(uint256 => Poll) private polls;
    mapping(uint256 => mapping(uint256 => string)) private options;
    mapping(uint256 => mapping(uint256 => uint256)) private tallies;
    mapping(uint256 => mapping(address => bool)) public voted;

    event PollCreated(uint256 indexed id, address indexed creator, string title, uint64 endsAt);
    event Voted(uint256 indexed id, address indexed voter, uint256 option);

    error InvalidPoll();
    error PollEnded();
    error PollNotEnded();
    error AlreadyVoted();
    error NotEligible();
    error InvalidOption();

    /// @param voters root of the tree of eligible addresses, zero means a poll open to everyone
    function create(string calldata title, string[] calldata choices, bytes32 voters, uint64 endsAt) external returns (uint256 id) {
        if (choices.length < 2 || choices.length > 64 || endsAt <= block.timestamp) revert InvalidPoll();
        id = ++pollCount;
        polls[id] = Poll(msg.sender, endsAt, uint32(choices.length), voters, title);
        for (uint256 i; i < choices.length; i++) options[id][i] = choices[i];
        emit PollCreated(id, msg.sender, title, endsAt);
    }

    function vote(uint256 id, uint256 option, bytes32[] calldata proof) external {
        Poll storage p = polls[id];
        if (p.endsAt == 0) revert InvalidPoll();
        if (block.timestamp >= p.endsAt) revert PollEnded();
        if (option >= p.optionCount) revert InvalidOption();
        if (voted[id][msg.sender]) revert AlreadyVoted();
        if (p.voters != bytes32(0)) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
            if (!MerkleProof.verifyCalldata(proof, p.voters, leaf)) revert NotEligible();
        }
        voted[id][msg.sender] = true;
        tallies[id][option] += 1;
        emit Voted(id, msg.sender, option);
    }

    function get(uint256 id) external view returns (Poll memory poll, string[] memory choices, uint256[] memory results) {
        poll = polls[id];
        choices = new string[](poll.optionCount);
        results = new uint256[](poll.optionCount);
        for (uint256 i; i < poll.optionCount; i++) {
            choices[i] = options[id][i];
            results[i] = tallies[id][i];
        }
    }
}
