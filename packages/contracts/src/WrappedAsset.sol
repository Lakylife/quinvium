// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title Bridged asset
/// @notice Each token is backed 1:1 by the original locked in the gateway on the original chain.
/// Only the gateway may mint and burn; nobody else has a key for it.
contract WrappedAsset is ERC20, ERC20Permit {
    address public immutable gateway;
    uint8 private immutable _decimals;
    /// @notice Chain and address of the original, zero for Bitcoin.
    uint64 public immutable originChain;
    bytes32 public immutable originToken;

    error OnlyGateway();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint64 originChain_, bytes32 originToken_) ERC20(name_, symbol_) ERC20Permit(name_) {
        gateway = msg.sender;
        _decimals = decimals_;
        originChain = originChain_;
        originToken = originToken_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function bridgeMint(address to, uint256 amount) external {
        if (msg.sender != gateway) revert OnlyGateway();
        _mint(to, amount);
    }

    function bridgeBurn(address from, uint256 amount) external {
        if (msg.sender != gateway) revert OnlyGateway();
        _burn(from, amount);
    }
}
