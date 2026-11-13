// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Seznam ověřených tokenů
/// @notice Peněženka a Explorer podle něj rozliší skutečný stablecoin od napodobeniny se stejným názvem.
/// Název a zkratku tokenu si může zvolit kdokoli, adresa na tomto seznamu ne. Vlastníkem má být vícepodpisový kontrakt.
contract TokenRegistry is Ownable {
    enum Kind {
        Issued,     // vydal ho přímo vydavatel na této síti
        Bridged,    // krytý originálem uzamčeným v bráně
        Community   // ověřený projekt bez krytí
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
