// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SwapFactory} from "./SwapFactory.sol";
import {SwapPair} from "./SwapPair.sol";

interface IWrapped {
    function deposit() external payable;
    function withdraw(uint256 value) external;
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title Směrovač směn a likvidity
/// @notice Nedrží žádné mince mezi transakcemi. Hlídá skluz a platnost, aby uživatel nedostal méně, než potvrdil.
/// Hlavní mince AET se uvnitř mění na WAET, uživatel s ní pracuje přímo.
contract SwapRouter {
    using SafeERC20 for IERC20;

    /// @notice Co chce poskytovatel vložit a nejméně kolik musí pool přijmout.
    struct LiquidityOrder {
        address tokenA;
        address tokenB;
        uint256 desiredA;
        uint256 desiredB;
        uint256 minA;
        uint256 minB;
    }

    uint256 private constant FEE_DENOMINATOR = 1000;
    uint256 private constant AMOUNT_AFTER_FEE = 997;

    SwapFactory public immutable factory;
    address public immutable wrapped;

    error Expired();
    error InvalidPath();
    error NoPair();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error InsufficientAmount();
    error NativeFailed();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(SwapFactory factory_, address wrapped_) {
        factory = factory_;
        wrapped = wrapped_;
    }

    receive() external payable {
        if (msg.sender != wrapped) revert NativeFailed();
    }

    // ---- ceny ------------------------------------------------------------------------

    function _pair(address a, address b) private view returns (address pair) {
        pair = factory.getPair(a, b);
        if (pair == address(0)) revert NoPair();
    }

    function _reserves(address input, address output) private view returns (uint256 reserveIn, uint256 reserveOut, address pair) {
        pair = _pair(input, output);
        (uint256 r0, uint256 r1) = SwapPair(pair).getReserves();
        (reserveIn, reserveOut) = input == SwapPair(pair).token0() ? (r0, r1) : (r1, r0);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        if (amountIn == 0) revert InsufficientAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 withFee = amountIn * AMOUNT_AFTER_FEE;
        return (withFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + withFee);
    }

    /// @notice Co dostanete za `amountIn` po cestě `path`, včetně poplatků všech poolů.
    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; ++i) {
            (uint256 reserveIn, uint256 reserveOut,) = _reserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    // ---- směna -----------------------------------------------------------------------

    /// @dev Vstup už je v prvním poolu. Každý pool pošle výstup rovnou do dalšího.
    function _swap(uint256[] memory amounts, address[] memory path, address to) private {
        for (uint256 i; i < path.length - 1; ++i) {
            (address input, address output) = (path[i], path[i + 1]);
            address pair = _pair(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 out0, uint256 out1) = input == SwapPair(pair).token0() ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address next = i < path.length - 2 ? _pair(output, path[i + 2]) : to;
            SwapPair(pair).swap(out0, out1, next);
        }
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert SlippageExceeded();
        IERC20(path[0]).safeTransferFrom(msg.sender, _pair(path[0], path[1]), amountIn);
        _swap(amounts, path, to);
    }

    function swapExactNativeForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path[0] != wrapped) revert InvalidPath();
        amounts = getAmountsOut(msg.value, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert SlippageExceeded();
        IWrapped(wrapped).deposit{value: msg.value}();
        IERC20(wrapped).safeTransfer(_pair(path[0], path[1]), msg.value);
        _swap(amounts, path, to);
    }

    function swapExactTokensForNative(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path[path.length - 1] != wrapped) revert InvalidPath();
        amounts = getAmountsOut(amountIn, path);
        uint256 out = amounts[amounts.length - 1];
        if (out < amountOutMin) revert SlippageExceeded();
        IERC20(path[0]).safeTransferFrom(msg.sender, _pair(path[0], path[1]), amountIn);
        _swap(amounts, path, address(this));
        IWrapped(wrapped).withdraw(out);
        _sendNative(to, out);
    }

    // ---- likvidita -------------------------------------------------------------------

    function _quote(address tokenA, address tokenB, uint256 desiredA, uint256 desiredB, uint256 minA, uint256 minB) private returns (uint256 amountA, uint256 amountB, address pair) {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) pair = factory.createPair(tokenA, tokenB);
        (uint256 r0, uint256 r1) = SwapPair(pair).getReserves();
        (uint256 reserveA, uint256 reserveB) = tokenA == SwapPair(pair).token0() ? (r0, r1) : (r1, r0);
        if (reserveA == 0 && reserveB == 0) return (desiredA, desiredB, pair);
        uint256 optimalB = (desiredA * reserveB) / reserveA;
        if (optimalB <= desiredB) {
            if (optimalB < minB) revert SlippageExceeded();
            return (desiredA, optimalB, pair);
        }
        uint256 optimalA = (desiredB * reserveA) / reserveB;
        if (optimalA < minA) revert SlippageExceeded();
        return (optimalA, desiredB, pair);
    }

    /// @notice Vklad do poolu. Pool, který ještě neexistuje, se založí a poměr vkladu určí jeho první kurz.
    function addLiquidity(LiquidityOrder calldata o, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address pair;
        (amountA, amountB, pair) = _quote(o.tokenA, o.tokenB, o.desiredA, o.desiredB, o.minA, o.minB);
        IERC20(o.tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(o.tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = SwapPair(pair).mint(to);
    }

    function addLiquidityNative(address token, uint256 desiredToken, uint256 minToken, uint256 minNative, address to, uint256 deadline)
        external
        payable
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative, uint256 liquidity)
    {
        address pair;
        (amountToken, amountNative, pair) = _quote(token, wrapped, desiredToken, msg.value, minToken, minNative);
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        IWrapped(wrapped).deposit{value: amountNative}();
        IERC20(wrapped).safeTransfer(pair, amountNative);
        liquidity = SwapPair(pair).mint(to);
        if (msg.value > amountNative) _sendNative(msg.sender, msg.value - amountNative);
    }

    function _withdraw(address tokenA, address tokenB, uint256 liquidity, address to) private returns (uint256 amountA, uint256 amountB) {
        address pair = _pair(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = SwapPair(pair).burn(to);
        (amountA, amountB) = tokenA == SwapPair(pair).token0() ? (amount0, amount1) : (amount1, amount0);
    }

    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 minA, uint256 minB, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB)
    {
        (amountA, amountB) = _withdraw(tokenA, tokenB, liquidity, to);
        if (amountA < minA || amountB < minB) revert SlippageExceeded();
    }

    function removeLiquidityNative(address token, uint256 liquidity, uint256 minToken, uint256 minNative, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative)
    {
        (amountToken, amountNative) = _withdraw(token, wrapped, liquidity, address(this));
        if (amountToken < minToken || amountNative < minNative) revert SlippageExceeded();
        IERC20(token).safeTransfer(to, amountToken);
        IWrapped(wrapped).withdraw(amountNative);
        _sendNative(to, amountNative);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeFailed();
    }
}
