// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {WrappedAsset} from "./WrappedAsset.sol";

/// @title Gateway between chains
/// @notice The same contract runs on Quinvium and on the other chain. A send on one side locks the original or burns
/// bridged token; delivery on the other side releases the original or mints the bridged token. Delivery is confirmed by `threshold`
/// of the validators. The bridge is thus exactly as secure as the validators are independent: above their agreement there are only limits,
/// delays for large transfers and an emergency stop, which limit the damage but do not prevent it entirely.
contract BridgeGateway is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Transfer between chains. For Bitcoin `srcChain` or `dstChain` equals BITCOIN.
    struct Message {
        uint64 srcChain;
        uint64 dstChain;
        uint64 nonce;
        bytes32 srcToken;
        address recipient;
        uint256 amount;
    }

    /// @notice Where an accepted transfer belongs and how much may pass without delay.
    struct Route {
        address local;          // local token, zero means the network's main coin
        bool wrapped;           // mint a bridged token instead of releasing the original
        bool enabled;
        uint256 dailyLimit;     // above the limit the transfer goes to the queue with a delay
        uint256 largeAmount;    // a single transfer above this amount always goes to the queue
        uint256 usedToday;
        uint64 day;
    }

    /// @notice What may leave and where to.
    struct Outbound {
        bool enabled;
        bool burn;
        uint256 minAmount;
    }

    struct Queued {
        uint64 readyAt;
        bool done;
        /// @dev The route's token when the transfer was queued. A route remapped meanwhile must not pay in another token.
        address local;
        bool wrapped;
    }

    uint64 public constant BITCOIN = 0xB17C01;
    uint256 public constant QUEUE_DELAY = 24 hours;
    uint256 public constant VALIDATOR_DELAY = 2 days;
    uint256 public constant MAX_VALIDATORS = 32;
    bytes32 private constant DOMAIN = keccak256("AetherBridge.v1");

    address public admin;
    address public guardian;
    bool public paused;
    uint256 public threshold;
    /// @notice Number of the next send. The upper half is derived from the gateway address, the lower half counts from one. A new gateway on
    /// the same chain thus never issues a number the old one already issued, and their messages do not collide in the target gateway.
    uint64 public nextNonce;
    address[] private validatorList;
    mapping(address validator => bool) public isValidator;
    mapping(bytes32 routeKey => Route) public routes;
    mapping(address token => mapping(uint64 chain => Outbound)) public outbound;
    mapping(bytes32 id => bool) public delivered;
    mapping(bytes32 id => Queued) public queued;
    /// @notice How much of the original is locked, i.e. how much may be released back.
    mapping(address token => uint256) public locked;

    address[] private pendingValidators;
    uint256 private pendingThreshold;
    uint64 public pendingValidatorsAt;

    event Sent(bytes32 indexed id, uint64 indexed dstChain, address indexed token, address sender, bytes recipient, uint256 amount, uint64 nonce);
    event Delivered(bytes32 indexed id, address indexed token, address indexed recipient, uint256 amount);
    event DeliveryQueued(bytes32 indexed id, uint64 readyAt);
    event QueueCancelled(bytes32 indexed id);
    event Attested(bytes32 indexed id, address indexed validator, bytes signature);
    event Posted(bytes32 indexed id, address indexed validator, bytes data);
    event BitcoinDepositRequested(address indexed recipient);
    event WrappedCreated(address indexed token, uint64 originChain, bytes32 originToken);
    event RouteChanged(bytes32 indexed key, address local, bool wrapped, bool enabled);
    event PausedChanged(bool paused);
    event ValidatorsProposed(uint64 at);
    event ValidatorsChanged(uint256 threshold, uint256 count);

    error NotAdmin();
    error RouteChangedWhileQueued();
    error NotGuardian();
    error IsPaused();
    error BadSettings();
    error RouteClosed();
    error WrongChain();
    error AlreadyDelivered();
    error NotEnoughSignatures();
    error BadSignature();
    error BelowMinimum();
    error BadValue();
    error NotReady();
    error NotQueued();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier whenRunning() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address admin_, address guardian_, address[] memory validators_, uint256 threshold_) {
        admin = admin_;
        guardian = guardian_;
        nextNonce = (uint64(uint160(address(this))) << 32) | 1;
        _setValidators(validators_, threshold_);
    }

    // ---- sending --------------------------------------------------------------------

    /// @param token local token, zero for the main coin
    /// @param recipient address on the target chain: 20 bytes for EVM, the address text for Bitcoin
    function send(address token, uint256 amount, uint64 dstChain, bytes calldata recipient) external payable whenRunning nonReentrant returns (bytes32 id) {
        Outbound memory rule = outbound[token][dstChain];
        if (!rule.enabled) revert RouteClosed();
        if (amount == 0 || amount < rule.minAmount) revert BelowMinimum();
        // On EVM chains the recipient is always an address, otherwise coins would get stuck with no way to deliver them.
        if (recipient.length == 0 || recipient.length > 128 || (dstChain != BITCOIN && recipient.length != 20)) revert BadSettings();
        if (token == address(0)) {
            if (msg.value != amount) revert BadValue();
            locked[token] += amount;
        } else {
            if (msg.value != 0) revert BadValue();
            if (rule.burn) {
                WrappedAsset(token).bridgeBurn(msg.sender, amount);
            } else {
                IERC20 asset = IERC20(token);
                uint256 before = asset.balanceOf(address(this));
                asset.safeTransferFrom(msg.sender, address(this), amount);
                // A token with a transfer fee would otherwise stay backed by less than the gateway confirms.
                if (asset.balanceOf(address(this)) - before != amount) revert BadValue();
                locked[token] += amount;
            }
        }
        uint64 nonce = nextNonce++;
        id = keccak256(abi.encode(DOMAIN, address(this), uint64(block.chainid), dstChain, nonce));
        emit Sent(id, dstChain, token, msg.sender, recipient, amount, nonce);
    }

    // ---- delivery --------------------------------------------------------------------

    /// @notice Signed for a specific target gateway; the signature is not valid elsewhere.
    function messageId(Message calldata m) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, address(this), m.srcChain, m.dstChain, m.nonce, m.srcToken, m.recipient, m.amount));
    }

    /// @notice A validator publishes its signature. Anyone who collects enough of them can then submit the delivery.
    /// A message with the EIP-191 prefix is signed, not a bare hash: the validator key thus never signs anything that could
    /// pass for a transaction or for a signature for another purpose.
    function attest(bytes32 id, bytes calldata signature) external {
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(id), signature);
        if (!isValidator[signer]) revert BadSignature();
        emit Attested(id, signer, signature);
    }

    /// @notice The validators' mailbox for Bitcoin payments: the proposed transaction and the signatures are public and nobody moves coins with them.
    function post(bytes32 id, bytes calldata data) external {
        if (!isValidator[msg.sender]) revert BadSignature();
        emit Posted(id, msg.sender, data);
    }

    /// @notice Tells validators to watch the recipient's deposit address. By itself it credits nothing.
    function requestBitcoinDeposit(address recipient) external {
        emit BitcoinDepositRequested(recipient);
    }

    /// @param signatures `messageId` signatures sorted by validator address ascending, each at most once
    function deliver(Message calldata m, bytes[] calldata signatures) external whenRunning nonReentrant {
        if (m.dstChain != block.chainid) revert WrongChain();
        bytes32 id = messageId(m);
        if (delivered[id] || queued[id].readyAt != 0) revert AlreadyDelivered();
        _checkSignatures(id, signatures);

        Route storage route = routes[keccak256(abi.encode(m.srcChain, m.srcToken))];
        if (!route.enabled) revert RouteClosed();
        uint64 today = uint64(block.timestamp / 1 days);
        if (route.day != today) {
            route.day = today;
            route.usedToday = 0;
        }
        if (m.amount > route.largeAmount || route.usedToday + m.amount > route.dailyLimit) {
            uint64 readyAt = uint64(block.timestamp + QUEUE_DELAY);
            queued[id] = Queued(readyAt, false, route.local, route.wrapped);
            emit DeliveryQueued(id, readyAt);
            return;
        }
        route.usedToday += m.amount;
        delivered[id] = true;
        _pay(id, route, m);
    }

    /// @notice Completes a delayed transfer unless the guardian cancelled it in the meantime.
    function executeQueued(Message calldata m) external whenRunning nonReentrant {
        bytes32 id = messageId(m);
        Queued storage q = queued[id];
        if (q.readyAt == 0 || q.done) revert NotQueued();
        if (block.timestamp < q.readyAt) revert NotReady();
        Route storage route = routes[keccak256(abi.encode(m.srcChain, m.srcToken))];
        if (!route.enabled) revert RouteClosed();
        // The admin remapped the route while the transfer waited: it is not paid in a different token. The guardian
        // cancels it and it is refunded to the sender instead.
        if (route.local != q.local || route.wrapped != q.wrapped) revert RouteChangedWhileQueued();
        q.done = true;
        delivered[id] = true;
        _pay(id, route, m);
    }

    function _pay(bytes32 id, Route storage route, Message calldata m) private {
        address token = route.local;
        if (route.wrapped) {
            WrappedAsset(token).bridgeMint(m.recipient, m.amount);
        } else {
            locked[token] -= m.amount;
            if (token == address(0)) {
                (bool ok,) = m.recipient.call{value: m.amount}("");
                if (!ok) revert BadValue();
            } else {
                IERC20(token).safeTransfer(m.recipient, m.amount);
            }
        }
        emit Delivered(id, token, m.recipient, m.amount);
    }

    function _checkSignatures(bytes32 id, bytes[] calldata signatures) private view {
        if (signatures.length < threshold) revert NotEnoughSignatures();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(id);
        address last;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (signer <= last || !isValidator[signer]) revert BadSignature();
            last = signer;
        }
    }

    // ---- administration ----------------------------------------------------------------------

    /// @notice The guardian can only pause and cancel a pending transfer, never release anything.
    function pause() external {
        if (msg.sender != guardian && msg.sender != admin) revert NotGuardian();
        paused = true;
        emit PausedChanged(true);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit PausedChanged(false);
    }

    function cancelQueued(bytes32 id) external {
        if (msg.sender != guardian && msg.sender != admin) revert NotGuardian();
        if (queued[id].readyAt == 0 || queued[id].done) revert NotQueued();
        queued[id].done = true;
        emit QueueCancelled(id);
    }

    /// @notice Permanently cancels a transfer that cannot or should not be delivered, for example when the recipient does not accept coins.
    /// A cancelled transfer will never go through, so validators may return the coins to the sender on the source network
    /// the same way as a transfer in the opposite direction. The guardian, the administrator or the recipient itself may cancel.
    function cancelDelivery(Message calldata m) external {
        if (msg.sender != guardian && msg.sender != admin && msg.sender != m.recipient) revert NotGuardian();
        if (m.dstChain != block.chainid) revert WrongChain();
        bytes32 id = messageId(m);
        if (delivered[id] || queued[id].done) revert AlreadyDelivered();
        // A non-zero readyAt blocks delivery, done blocks completion from the queue.
        queued[id] = Queued(uint64(block.timestamp), true, address(0), false);
        emit QueueCancelled(id);
    }

    /// @notice A cancelled transfer: it was never delivered and never will be. Only such a transfer may be refunded.
    function cancelled(bytes32 id) external view returns (bool) {
        return queued[id].done && !delivered[id];
    }

    /// @notice Creates a bridged token for an asset from another chain and opens the route.
    function createWrapped(string calldata name, string calldata symbol, uint8 decimals, uint64 originChain, bytes32 originToken, uint256 dailyLimit, uint256 largeAmount)
        external
        onlyAdmin
        returns (address token)
    {
        token = address(new WrappedAsset(name, symbol, decimals, originChain, originToken));
        emit WrappedCreated(token, originChain, originToken);
        _setRoute(originChain, originToken, token, true, true, dailyLimit, largeAmount);
    }

    function setRoute(uint64 srcChain, bytes32 srcToken, address local, bool wrapped, bool enabled, uint256 dailyLimit, uint256 largeAmount) external onlyAdmin {
        _setRoute(srcChain, srcToken, local, wrapped, enabled, dailyLimit, largeAmount);
    }

    function _setRoute(uint64 srcChain, bytes32 srcToken, address local, bool wrapped, bool enabled, uint256 dailyLimit, uint256 largeAmount) private {
        bytes32 key = keccak256(abi.encode(srcChain, srcToken));
        Route storage r = routes[key];
        (r.local, r.wrapped, r.enabled, r.dailyLimit, r.largeAmount) = (local, wrapped, enabled, dailyLimit, largeAmount);
        emit RouteChanged(key, local, wrapped, enabled);
    }

    function setOutbound(address token, uint64 chain, bool enabled, bool burn, uint256 minAmount) external onlyAdmin {
        outbound[token][chain] = Outbound(enabled, burn, minAmount);
    }

    function setAdmin(address admin_) external onlyAdmin {
        if (admin_ == address(0)) revert BadSettings();
        admin = admin_;
    }

    function setGuardian(address guardian_) external onlyAdmin {
        guardian = guardian_;
    }

    /// @notice A validator change takes effect only after a delay, so users have time to notice it.
    function proposeValidators(address[] calldata validators_, uint256 threshold_) external onlyAdmin {
        _check(validators_, threshold_);
        pendingValidators = validators_;
        pendingThreshold = threshold_;
        pendingValidatorsAt = uint64(block.timestamp + VALIDATOR_DELAY);
        emit ValidatorsProposed(pendingValidatorsAt);
    }

    function applyValidators() external onlyAdmin {
        if (pendingValidatorsAt == 0 || block.timestamp < pendingValidatorsAt) revert NotReady();
        pendingValidatorsAt = 0;
        for (uint256 i; i < validatorList.length; ++i) isValidator[validatorList[i]] = false;
        _setValidators(pendingValidators, pendingThreshold);
    }

    function validators() external view returns (address[] memory) {
        return validatorList;
    }

    function _check(address[] memory list, uint256 threshold_) private pure {
        // A majority and at least two: one stolen key must not be enough.
        if (list.length > MAX_VALIDATORS || threshold_ < 2 || threshold_ > list.length || threshold_ * 2 <= list.length) revert BadSettings();
    }

    function _setValidators(address[] memory list, uint256 threshold_) private {
        _check(list, threshold_);
        validatorList = list;
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == address(0) || isValidator[list[i]]) revert BadSettings();
            isValidator[list[i]] = true;
        }
        threshold = threshold_;
        emit ValidatorsChanged(threshold_, list.length);
    }
}
