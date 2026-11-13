// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {WrappedAsset} from "./WrappedAsset.sol";

/// @title Brána mezi řetězci
/// @notice Stejný kontrakt běží na Aetheru i na druhém řetězci. Odeslání na jedné straně zamkne originál nebo spálí
/// přemostěný token, doručení na druhé uvolní originál nebo vyrazí přemostěný token. Doručení potvrzuje `threshold`
/// z validátorů. Most je tak bezpečný přesně tak, jak nezávislí jsou validátoři: nad jejich shodou stojí jen limity,
/// zpoždění velkých převodů a nouzové zastavení, které omezí škodu, ale nezabrání jí úplně.
contract BridgeGateway is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Přenos mezi řetězci. U Bitcoinu je `srcChain` nebo `dstChain` rovno BITCOIN.
    struct Message {
        uint64 srcChain;
        uint64 dstChain;
        uint64 nonce;
        bytes32 srcToken;
        address recipient;
        uint256 amount;
    }

    /// @notice Kam přijatý převod patří a kolik smí projít bez zpoždění.
    struct Route {
        address local;          // místní token, nula znamená hlavní minci sítě
        bool wrapped;           // vyrazit přemostěný token místo uvolnění originálu
        bool enabled;
        uint256 dailyLimit;     // nad limit jde převod do fronty se zpožděním
        uint256 largeAmount;    // jednotlivý převod nad touto částkou jde do fronty vždy
        uint256 usedToday;
        uint64 day;
    }

    /// @notice Co smí odejít kam.
    struct Outbound {
        bool enabled;
        bool burn;
        uint256 minAmount;
    }

    struct Queued {
        uint64 readyAt;
        bool done;
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
    /// @notice Číslo příštího odeslání. Horní polovina je odvozená z adresy brány, dolní počítá od jedné. Nová brána na
    /// stejném řetězci tak nikdy nevydá číslo, které už vydala stará, a jejich zprávy se v cílové bráně nesrazí.
    uint64 public nextNonce;
    address[] private validatorList;
    mapping(address validator => bool) public isValidator;
    mapping(bytes32 routeKey => Route) public routes;
    mapping(address token => mapping(uint64 chain => Outbound)) public outbound;
    mapping(bytes32 id => bool) public delivered;
    mapping(bytes32 id => Queued) public queued;
    /// @notice Kolik originálu je uzamčeno, tedy kolik smí být uvolněno zpět.
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

    // ---- odeslání --------------------------------------------------------------------

    /// @param token místní token, nula pro hlavní minci
    /// @param recipient adresa na cílovém řetězci: 20 bajtů u EVM, text adresy u Bitcoinu
    function send(address token, uint256 amount, uint64 dstChain, bytes calldata recipient) external payable whenRunning nonReentrant returns (bytes32 id) {
        Outbound memory rule = outbound[token][dstChain];
        if (!rule.enabled) revert RouteClosed();
        if (amount == 0 || amount < rule.minAmount) revert BelowMinimum();
        // Na řetězcích EVM je příjemce vždy adresa, jinak by mince uvízly bez možnosti doručení.
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
                // Token s poplatkem z převodu by jinak zůstal krytý méně, než co brána potvrdí.
                if (asset.balanceOf(address(this)) - before != amount) revert BadValue();
                locked[token] += amount;
            }
        }
        uint64 nonce = nextNonce++;
        id = keccak256(abi.encode(DOMAIN, address(this), uint64(block.chainid), dstChain, nonce));
        emit Sent(id, dstChain, token, msg.sender, recipient, amount, nonce);
    }

    // ---- doručení --------------------------------------------------------------------

    /// @notice Podepisuje se pro konkrétní cílovou bránu, podpis jinde neplatí.
    function messageId(Message calldata m) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, address(this), m.srcChain, m.dstChain, m.nonce, m.srcToken, m.recipient, m.amount));
    }

    /// @notice Validátor zveřejní svůj podpis. Doručení pak může odeslat kdokoli, kdo jich sebere dost.
    /// Podepisuje se zpráva s předponou EIP-191, ne holý hash: klíč validátora tak nikdy nepodepíše nic, co by šlo
    /// vydávat za transakci nebo za podpis pro jiný účel.
    function attest(bytes32 id, bytes calldata signature) external {
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(id), signature);
        if (!isValidator[signer]) revert BadSignature();
        emit Attested(id, signer, signature);
    }

    /// @notice Schránka validátorů pro platby v Bitcoinu: návrh transakce a podpisy jsou veřejné a nikdo jimi nehýbe s mincemi.
    function post(bytes32 id, bytes calldata data) external {
        if (!isValidator[msg.sender]) revert BadSignature();
        emit Posted(id, msg.sender, data);
    }

    /// @notice Řekne validátorům, ať sledují vkladovou adresu příjemce. Sama o sobě nic nepřipisuje.
    function requestBitcoinDeposit(address recipient) external {
        emit BitcoinDepositRequested(recipient);
    }

    /// @param signatures podpisy `messageId` seřazené podle adresy validátora vzestupně, každý nejvýš jednou
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
            queued[id] = Queued(readyAt, false);
            emit DeliveryQueued(id, readyAt);
            return;
        }
        route.usedToday += m.amount;
        delivered[id] = true;
        _pay(id, route, m);
    }

    /// @notice Dokončí zpožděný převod, pokud ho strážce mezitím nezrušil.
    function executeQueued(Message calldata m) external whenRunning nonReentrant {
        bytes32 id = messageId(m);
        Queued storage q = queued[id];
        if (q.readyAt == 0 || q.done) revert NotQueued();
        if (block.timestamp < q.readyAt) revert NotReady();
        Route storage route = routes[keccak256(abi.encode(m.srcChain, m.srcToken))];
        if (!route.enabled) revert RouteClosed();
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

    // ---- správa ----------------------------------------------------------------------

    /// @notice Strážce umí jen zastavit a zrušit čekající převod, nikdy nic neuvolní.
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

    /// @notice Natrvalo zruší převod, který nejde nebo nemá být doručen, třeba když příjemce mince nepřijme.
    /// Zrušený převod už nikdy neprojde, a validátoři proto smějí vrátit mince odesílateli na zdrojové síti
    /// stejnou cestou jako převod opačným směrem. Zrušit smí strážce, správce nebo sám příjemce.
    function cancelDelivery(Message calldata m) external {
        if (msg.sender != guardian && msg.sender != admin && msg.sender != m.recipient) revert NotGuardian();
        if (m.dstChain != block.chainid) revert WrongChain();
        bytes32 id = messageId(m);
        if (delivered[id] || queued[id].done) revert AlreadyDelivered();
        // Nenulové readyAt zablokuje doručení, done zablokuje dokončení z fronty.
        queued[id] = Queued(uint64(block.timestamp), true);
        emit QueueCancelled(id);
    }

    /// @notice Zrušený převod: nikdy nebyl doručen a už nebude. Jen u takového smí přijít vrácení.
    function cancelled(bytes32 id) external view returns (bool) {
        return queued[id].done && !delivered[id];
    }

    /// @notice Vytvoří přemostěný token pro aktivum z jiného řetězce a otevře trasu.
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

    /// @notice Změna validátorů platí až po prodlevě, aby si ji uživatelé stihli všimnout.
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
        // Většina a aspoň dva: jeden ukradený klíč nesmí stačit.
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
