// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Wrapped QU as ERC-20, for decentralised exchanges and contracts working with tokens
contract WAET {
    string public constant name = "Wrapped QU";
    string public constant symbol = "WQU";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed account, uint256 value);
    event Withdrawal(address indexed account, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 value) external {
        if (balanceOf[msg.sender] < value) revert InsufficientBalance();
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
        emit Withdrawal(msg.sender, value);
        emit Transfer(msg.sender, address(0), value);
        (bool ok, ) = msg.sender.call{value: value}("");
        require(ok, "platba selhala");
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return transferFrom(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        if (balanceOf[from] < value) revert InsufficientBalance();
        if (from != msg.sender) {
            uint256 allowed = allowance[from][msg.sender];
            if (allowed != type(uint256).max) {
                if (allowed < value) revert InsufficientAllowance();
                allowance[from][msg.sender] = allowed - value;
            }
        }
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}
