// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Pool likvidity dvou tokenů
/// @notice Směnný kurz určuje konstantní součin zásob. Žádný správce, žádné klíče: mince drží kontrakt a vybrat si je může
/// jen poskytovatel likvidity podle svého podílu. Poplatek 0,3 % zůstává v poolu a zvyšuje hodnotu podílů.
contract SwapPair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Trvale uzamčená likvidita. Zabrání první vkladatelce zdražit podíl tak, že by menší vklady dostaly nulu.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 private constant FEE_DENOMINATOR = 1000;
    uint256 private constant FEE_NUMERATOR = 3;
    address private constant LOCKED = address(0xdead);

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint256 private reserve0;
    uint256 private reserve1;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to);
    event Sync(uint256 reserve0, uint256 reserve1);

    error InsufficientLiquidity();
    error InsufficientInput();
    error InsufficientOutput();
    error InvalidTo();
    error InvariantBroken();

    constructor(address token0_, address token1_) ERC20("Quinvium Swap LP", "QSLP") {
        factory = msg.sender;
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() public view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    function _balances() private view returns (uint256, uint256) {
        return (IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _update(uint256 balance0, uint256 balance1) private {
        reserve0 = balance0;
        reserve1 = balance1;
        emit Sync(balance0, balance1);
    }

    /// @notice Vydá podíly za tokeny, které volající právě poslal do poolu.
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint256 r0, uint256 r1) = getReserves();
        (uint256 balance0, uint256 balance1) = _balances();
        uint256 amount0 = balance0 - r0;
        uint256 amount1 = balance1 - r1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = _sqrt(amount0 * amount1);
            if (liquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            liquidity -= MINIMUM_LIQUIDITY;
            _mint(LOCKED, MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min((amount0 * supply) / r0, (amount1 * supply) / r1);
        }
        if (liquidity == 0) revert InsufficientLiquidity();
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Spálí podíly poslané do poolu a vyplatí odpovídající díl obou tokenů.
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        (uint256 balance0, uint256 balance1) = _balances();
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();
        amount0 = (liquidity * balance0) / supply;
        amount1 = (liquidity * balance1) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();
        _burn(address(this), liquidity);
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);
        (balance0, balance1) = _balances();
        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Vyplatí výstup. Vstup už musí být v poolu, jinak kontrola součinu transakci vrátí.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutput();
        (uint256 r0, uint256 r1) = getReserves();
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientLiquidity();
        if (to == token0 || to == token1) revert InvalidTo();
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);
        (uint256 balance0, uint256 balance1) = _balances();
        uint256 amount0In = balance0 > r0 - amount0Out ? balance0 - (r0 - amount0Out) : 0;
        uint256 amount1In = balance1 > r1 - amount1Out ? balance1 - (r1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInput();
        uint256 adjusted0 = balance0 * FEE_DENOMINATOR - amount0In * FEE_NUMERATOR;
        uint256 adjusted1 = balance1 * FEE_DENOMINATOR - amount1In * FEE_NUMERATOR;
        if (adjusted0 * adjusted1 < r0 * r1 * FEE_DENOMINATOR * FEE_DENOMINATOR) revert InvariantBroken();
        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Srovná zásoby se skutečným zůstatkem, když někdo poslal tokeny přímo do poolu.
    function sync() external nonReentrant {
        (uint256 balance0, uint256 balance1) = _balances();
        _update(balance0, balance1);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
