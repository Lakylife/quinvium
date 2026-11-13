// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SwapPair} from "./SwapPair.sol";

/// @title Továrna poolů likvidity
/// @notice Pool může založit kdokoli. Pro každou dvojici tokenů existuje jen jeden.
contract SwapFactory {
    mapping(address tokenA => mapping(address tokenB => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 count);

    error IdenticalTokens();
    error ZeroAddress();
    error PairExists();

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @return out seznam poolů od zadané pozice, stránka pro Explorer
    function list(uint256 start, uint256 count) external view returns (address[] memory out) {
        uint256 total = allPairs.length;
        if (start >= total) return new address[](0);
        uint256 size = total - start < count ? total - start : count;
        out = new address[](size);
        for (uint256 i; i < size; ++i) out[i] = allPairs[start + i];
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalTokens();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();
        pair = address(new SwapPair{salt: keccak256(abi.encodePacked(token0, token1))}(token0, token1));
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }
}
