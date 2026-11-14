// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title List of verified tokens
/// @notice The wallet and the Explorer use it to tell a real stablecoin from an imitation with the same name.
/// Anyone can choose a token name and symbol; an address on this list, no. The owner should be a multisig contract.
contract TokenRegistry is Ownable {
    enum Kind {
        Issued,     // issued directly by the issuer on this network
        Bridged,    // backed by the original locked in the gateway
        Community   // verified project without backing
    }

    struct Entry {
        address token;
        Kind kind;
        string issuer;
        string logoUri;
    }

    address[] private tokens;
    mapping(address token => Entry) public entries;
    mapping(address token => bool) public listed;

    event Listed(address indexed token, Kind kind, string issuer);
    event Delisted(address indexed token);

    error AlreadyListed();
    error NotListed();

    constructor(address owner_) Ownable(owner_) {}

    function add(address token, Kind kind, string calldata issuer, string calldata logoUri) external onlyOwner {
        if (listed[token]) revert AlreadyListed();
        listed[token] = true;
        tokens.push(token);
        entries[token] = Entry(token, kind, issuer, logoUri);
        emit Listed(token, kind, issuer);
    }

    function remove(address token) external onlyOwner {
        if (!listed[token]) revert NotListed();
        listed[token] = false;
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == token) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }
        emit Delisted(token);
    }

    function all() external view returns (Entry[] memory out) {
        out = new Entry[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) out[i] = entries[tokens[i]];
    }
}
