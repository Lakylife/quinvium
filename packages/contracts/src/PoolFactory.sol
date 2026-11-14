// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AetherPool} from "./AetherPool.sol";

/// @title Pool creation for anyone
/// @notice Pools from the factory have verified code, so miners do not have to trust them. The app offers only these pools.
contract PoolFactory {
    address[] public pools;
    mapping(address pool => bool) public isPool;

    event PoolCreated(address indexed pool, address indexed operator, string name, uint256 feeBps, uint256 roundBlocks, uint256 windowRounds);

    /// @param name pool name
    /// @param url address of the pool server for miners
    /// @param feeBps operator fee in hundredths of a percent, at most 500 and cannot be changed
    /// @param roundBlocks round length in blocks
    /// @param windowRounds how many recent rounds share the reward
    function createPool(string calldata name, string calldata url, uint256 feeBps, uint256 roundBlocks, uint256 windowRounds)
        external
        returns (address pool)
    {
        pool = address(new AetherPool(msg.sender, name, url, feeBps, roundBlocks, windowRounds));
        isPool[pool] = true;
        pools.push(pool);
        emit PoolCreated(pool, msg.sender, name, feeBps, roundBlocks, windowRounds);
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    /// @notice A page of the pool list, oldest first.
    function list(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 count = pools.length;
        if (offset >= count) return new address[](0);
        uint256 size = count - offset < limit ? count - offset : limit;
        out = new address[](size);
        for (uint256 i; i < size; ++i) out[i] = pools[offset + i];
    }
}
