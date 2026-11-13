// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Token vytvořený továrnou: věrnostní body, firemní a komunitní tokeny, poukázky.
contract AetherToken is ERC20, ERC20Burnable, Ownable {
    uint8 private immutable _customDecimals;
    bool public immutable mintable;

    error MintingDisabled();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 supply, bool mintable_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _customDecimals = decimals_;
        mintable = mintable_;
        _mint(owner_, supply);
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (!mintable) revert MintingDisabled();
        _mint(to, amount);
    }
}

/// @title Továrna na tokeny: vlastní token bez psaní kódu
contract TokenFactory {
    address[] public tokens;
    mapping(address => address[]) private byCreator;

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply, bool mintable);

    function create(string calldata name, string calldata symbol, uint8 decimals, uint256 supply, bool mintable) external returns (address token) {
        token = address(new AetherToken(name, symbol, decimals, supply, mintable, msg.sender));
        tokens.push(token);
        byCreator[msg.sender].push(token);
        emit TokenCreated(token, msg.sender, name, symbol, supply, mintable);
    }

    function count() external view returns (uint256) {
        return tokens.length;
    }

    function tokensOf(address creator) external view returns (address[] memory) {
        return byCreator[creator];
    }
}
