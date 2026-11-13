// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AetherPool} from "./AetherPool.sol";

/// @title Založení poolu pro kohokoli
/// @notice Pooly z továrny mají ověřený kód, takže jim těžaři nemusí věřit. Aplikace nabízí jen tyto pooly.
contract PoolFactory {
    address[] public pools;
    mapping(address pool => bool) public isPool;

    event PoolCreated(address indexed pool, address indexed operator, string name, uint256 feeBps, uint256 roundBlocks, uint256 windowRounds);

    /// @param name název poolu
    /// @param url adresa serveru poolu pro těžaře
    /// @param feeBps poplatek provozovatele v setinách procenta, nejvýše 500 a nejde změnit
    /// @param roundBlocks délka kola v blocích
    /// @param windowRounds kolik posledních kol se dělí o odměnu
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

    /// @notice Stránka seznamu poolů, od nejstaršího.
    function list(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 count = pools.length;
        if (offset >= count) return new address[](0);
        uint256 size = count - offset < limit ? count - offset : limit;
        out = new address[](size);
        for (uint256 i; i < size; ++i) out[i] = pools[offset + i];
    }
}
