// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Hromadné čtení z kontraktů pro aplikace a peněženky
contract Multicall {
    struct Call {
        address target;
        bytes data;
    }

    struct Result {
        bool success;
        bytes data;
    }

    function aggregate(Call[] calldata calls) external view returns (uint256 blockNumber, Result[] memory results) {
        blockNumber = block.number;
        results = new Result[](calls.length);
        for (uint256 i; i < calls.length; i++) {
            (bool ok, bytes memory data) = calls[i].target.staticcall(calls[i].data);
            results[i] = Result(ok, data);
        }
    }

    function balances(address[] calldata accounts) external view returns (uint256[] memory out) {
        out = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; i++) out[i] = accounts[i].balance;
    }
}
