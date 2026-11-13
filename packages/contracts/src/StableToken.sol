// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Stablecoin vydavatele na síti Aether
/// @notice Výbava, kterou vydavatelé regulovaných stablecoinů požadují: limity pro razení po jednotlivých
/// rolích, zastavení převodů, blokace adres a podpisy bez gasu (EIP-2612). Krytí a odpovědnost nese vydavatel, síť ho nezaručuje.
contract StableToken is ERC20, ERC20Permit, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ADMIN_ROLE = keccak256("MINTER_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    uint8 private immutable _decimals;
    mapping(address minter => uint256) public minterAllowance;
    mapping(address account => bool) public blocked;

    event MinterConfigured(address indexed minter, uint256 allowance);
    event Blocked(address indexed account, bool blocked);

    error AccountBlocked(address account);
    error MintAllowanceExceeded(uint256 allowance, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address admin) ERC20(name_, symbol_) ERC20Permit(name_) {
        _decimals = decimals_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Kolik smí daný minter ještě vyrazit. Bez nastavení je to nula.
    function configureMinter(address minter, uint256 allowance) external onlyRole(MINTER_ADMIN_ROLE) {
        minterAllowance[minter] = allowance;
        emit MinterConfigured(minter, allowance);
    }

    function mint(address to, uint256 amount) external {
        uint256 allowance = minterAllowance[msg.sender];
        if (amount > allowance) revert MintAllowanceExceeded(allowance, amount);
        minterAllowance[msg.sender] = allowance - amount;
        _mint(to, amount);
    }

    /// @notice Vydavatel pálí jen z vlastních zásob, například při výplatě klientovi.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setBlocked(address account, bool value) external onlyRole(COMPLIANCE_ROLE) {
        blocked[account] = value;
        emit Blocked(account, value);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        if (blocked[from]) revert AccountBlocked(from);
        if (blocked[to]) revert AccountBlocked(to);
        if (blocked[msg.sender]) revert AccountBlocked(msg.sender);
        super._update(from, to, value);
    }
}
