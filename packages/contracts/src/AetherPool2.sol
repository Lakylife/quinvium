// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title A mining pool that cannot rob its miners, version 2: it pays the gas for shares out of the mined rewards
/// @notice The pool's blocks have this contract as the reward recipient, so coins never pass through the operator.
/// A share is a block header whose extraData contains the miner's address and the share difficulty. Both are covered by the proof of work,
/// the network verifies the work directly. The operator therefore cannot reassign a share to another miner, change the fee
/// nor withdraw more than its fee. Anyone can submit shares and trigger the payout too, even if the operator disappears.
/// Distribution is PPLNS: the reward goes to the last several rounds, so pool hopping brings nothing.
/// Version 2: the pool server (the relayer, chosen by the operator) gets back the gas of its share submissions and payouts
/// from coins not yet distributed. The price is capped at the base fee plus a small tip and all refunds together at
/// 1 % of everything the pool ever received, so neither the server nor the operator can drain the miners' rewards.
contract AetherPool2 {
    /// @dev A built-in function of the network, see packages/node/src/core/precompiles.js
    address private constant POW_VERIFY = 0x0000000000000000000000000000000000000100;
    uint256 private constant PROOF_BYTES = 224;
    uint256 private constant BPS = 10_000;
    uint256 private constant RATE_SHIFT = 128;
    uint256 private constant PAYOUT_GAS = 50_000;
    uint256 private constant SETTLE_PER_SHARE_CALL = 4;
    uint256 private constant CLAIM_STEPS = 128;
    /// @dev The refund: the measured gas, plus the base cost of a transaction, the calldata (an average per byte) and the
    /// refund itself, at most at the base fee plus MAX_TIP.
    uint256 private constant TX_GAS = 21_000;
    uint256 private constant CALLDATA_GAS = 10;
    uint256 private constant REFUND_GAS = 15_000;
    uint256 public constant MAX_TIP = 2 gwei;
    /// @notice All gas refunds together are at most this share of the pool's income (hundredths of a percent).
    uint256 public constant GAS_CAP_BPS = 100;

    uint256 public constant MAX_FEE_BPS = 500;
    uint256 public constant MIN_ROUND_BLOCKS = 16;
    uint256 public constant MAX_ROUND_BLOCKS = 5760;
    uint256 public constant MAX_WINDOW_ROUNDS = 256;
    /// @notice How many blocks older a share may be. A round closes only after that, so no share arrives late.
    uint256 public constant MAX_SHARE_AGE = 32;

    uint8 public constant OK = 0;
    uint8 public constant REJECT_PROOF = 1;
    uint8 public constant REJECT_POOL = 2;
    uint8 public constant REJECT_AGE = 3;
    uint8 public constant REJECT_CHAIN = 4;
    uint8 public constant REJECT_MINER = 5;
    uint8 public constant REJECT_WORK = 6;
    uint8 public constant REJECT_DUPLICATE = 7;

    /// @notice One step is a round in which someone mined. Empty rounds do not count.
    struct Step {
        uint256 round;
        uint256 work;
        uint256 totalWork;   // sum of work including this step
        uint256 totalRate;   // sum of payouts per unit of work, shifted by RATE_SHIFT bits
    }

    address public immutable operator;
    uint256 public immutable feeBps;
    uint256 public immutable roundBlocks;
    uint256 public immutable windowRounds;
    string public name;
    string public url;

    Step[] public steps;
    uint256 public settledSteps;
    /// @notice Coins that already belong to someone.
    uint256 public reserved;
    uint256 public operatorOwed;
    uint256 public totalPaid;
    /// @notice The account of the pool server whose gas the pool pays back. Only the operator changes it.
    address public relayer;
    uint256 public feesWithdrawn;
    uint256 public gasRefunded;
    /// @dev Coins set aside for the relayer's refund during its own call, so that closing a round does not hand them out first.
    uint256 private transient gasHold;

    mapping(uint256 round => uint256) private stepOfRound;   // index + 1
    mapping(uint256 step => mapping(address miner => uint256)) public workOf;
    mapping(address miner => uint256[]) private minerSteps;
    mapping(address miner => uint256) private cursor;
    mapping(address miner => mapping(uint256 step => uint256)) private paidRate;
    mapping(address miner => uint256) public owed;
    mapping(address miner => uint256) public paidTo;
    mapping(bytes32 share => bool) public seen;

    event ShareAccepted(address indexed miner, uint256 indexed step, uint256 number, uint256 credit);
    event StepSettled(uint256 indexed step, uint256 round, uint256 work, uint256 pot, uint256 fee);
    event Paid(address indexed miner, uint256 amount);
    event PaymentFailed(address indexed miner, uint256 amount);
    event FeePaid(uint256 amount);
    event UrlChanged(string url);
    event RelayerChanged(address relayer);
    event GasRefunded(address indexed relayer, uint256 amount);

    error InvalidSettings();
    error ShareRejected(uint8 reason);
    error NoValidShares();
    error NotOperator();
    error NothingToPay();

    constructor(
        address operator_,
        address relayer_,
        string memory name_,
        string memory url_,
        uint256 feeBps_,
        uint256 roundBlocks_,
        uint256 windowRounds_
    ) {
        if (
            operator_ == address(0) || feeBps_ > MAX_FEE_BPS || roundBlocks_ < MIN_ROUND_BLOCKS || roundBlocks_ > MAX_ROUND_BLOCKS
                || windowRounds_ == 0 || windowRounds_ > MAX_WINDOW_ROUNDS || bytes(name_).length == 0 || bytes(name_).length > 64
                || bytes(url_).length > 128
        ) revert InvalidSettings();
        operator = operator_;
        relayer = relayer_ == address(0) ? operator_ : relayer_;
        feeBps = feeBps_;
        roundBlocks = roundBlocks_;
        windowRounds = windowRounds_;
        name = name_;
        url = url_;
    }

    /// @notice Accepts block rewards and voluntary contributions to miners.
    receive() external payable {}

    /// @dev Pays the relayer back the gas of this call. Other callers pay their own gas, as in the first version.
    modifier refundsGas() {
        uint256 start = _hold();
        _;
        _refund(start, true);
    }

    function _price() private view returns (uint256 price) {
        price = tx.gasprice;
        uint256 cap = block.basefee + MAX_TIP;
        if (price > cap) price = cap;
    }

    /// @dev For the relayer: sets aside free coins for the most the call can cost (its whole gas), within the 1 % limit.
    function _hold() private returns (uint256 start) {
        start = gasleft();
        if (msg.sender != relayer) return start;
        uint256 most = (start + TX_GAS + msg.data.length * CALLDATA_GAS + REFUND_GAS) * _price();
        uint256 income = address(this).balance + totalPaid + feesWithdrawn + gasRefunded;
        uint256 limit = income * GAS_CAP_BPS / BPS;
        uint256 left = limit > gasRefunded ? limit - gasRefunded : 0;
        if (most > left) most = left;
        uint256 free = address(this).balance - reserved;
        if (most > free) most = free;
        gasHold = most;
    }

    /// @dev Pays the measured gas out of what was set aside; the rest goes back to the coins waiting for distribution.
    function _refund(uint256 start, bool useful) private {
        uint256 hold = gasHold;
        if (hold == 0) return;
        gasHold = 0;
        if (!useful) return;
        uint256 cost = (start - gasleft() + TX_GAS + msg.data.length * CALLDATA_GAS + REFUND_GAS) * _price();
        if (cost > hold) cost = hold;
        gasRefunded += cost;
        (bool ok,) = relayer.call{value: cost, gas: PAYOUT_GAS}("");
        if (ok) emit GasRefunded(relayer, cost);
        else gasRefunded -= cost;
    }

    // ---- Shares ----

    /// @param header RLP of the header including mixHash and nonce
    function submitShare(bytes calldata header) external refundsGas {
        uint8 result = _accept(header);
        if (result != OK) revert ShareRejected(result);
        _settle(SETTLE_PER_SHARE_CALL);
    }

    /// @notice Skips invalid shares so that one late share does not discard the whole batch.
    function submitShares(bytes[] calldata headers) external refundsGas returns (uint256 accepted) {
        for (uint256 i; i < headers.length; ++i) {
            if (_accept(headers[i]) == OK) ++accepted;
        }
        if (accepted == 0) revert NoValidShares();
        _settle(SETTLE_PER_SHARE_CALL);
    }

    function _accept(bytes calldata header) private returns (uint8) {
        (bool ok, bytes memory proof) = POW_VERIFY.staticcall(header);
        if (!ok || proof.length != PROOF_BYTES) return REJECT_PROOF;
        (address coinbase, uint256 number, bytes32 parent,, uint256 work, bytes32 extra, bytes32 hash) =
            abi.decode(proof, (address, uint256, bytes32, uint256, uint256, bytes32, bytes32));
        if (coinbase != address(this)) return REJECT_POOL;
        if (number + MAX_SHARE_AGE < block.number) return REJECT_AGE;
        if (blockhash(number - 1) != parent) return REJECT_CHAIN;
        address miner = address(bytes20(extra));
        uint256 credit = uint96(uint256(extra));
        if (miner == address(0)) return REJECT_MINER;
        if (credit == 0 || work < credit) return REJECT_WORK;
        if (seen[hash]) return REJECT_DUPLICATE;
        seen[hash] = true;

        uint256 round = number / roundBlocks;
        uint256 index = stepOfRound[round];
        if (index == 0) {
            steps.push(Step({round: round, work: 0, totalWork: 0, totalRate: 0}));
            index = steps.length;
            stepOfRound[round] = index;
        }
        uint256 step = index - 1;
        if (workOf[step][miner] == 0) minerSteps[miner].push(step);
        workOf[step][miner] += credit;
        steps[step].work += credit;
        emit ShareAccepted(miner, step, number, credit);
        return OK;
    }

    // ---- Closing rounds ----

    /// @notice The first round that can still receive a share.
    function openRound() public view returns (uint256) {
        return block.number < MAX_SHARE_AGE ? 0 : (block.number - MAX_SHARE_AGE) / roundBlocks;
    }

    /// @notice Distributes new coins between the steps in the window. Anyone can trigger it; submitting shares does it automatically.
    function settle(uint256 maxSteps) external returns (uint256 done) {
        uint256 start = _hold();
        done = _settle(maxSteps);
        _refund(start, done != 0);
    }

    function _settle(uint256 maxSteps) private returns (uint256 done) {
        uint256 open = openRound();
        uint256 next = settledSteps;
        uint256 count = steps.length;
        while (done < maxSteps && next < count && steps[next].round < open) {
            _settleStep(next);
            ++next;
            ++done;
        }
        settledSteps = next;
    }

    function _settleStep(uint256 index) private {
        Step storage step = steps[index];
        Step memory previous = index == 0 ? Step(0, 0, 0, 0) : steps[index - 1];
        uint256 total = previous.totalWork + step.work;
        step.totalWork = total;
        uint256 start = index >= windowRounds ? steps[index - windowRounds].totalWork : 0;
        uint256 pot = address(this).balance - reserved - gasHold;
        uint256 fee = pot * feeBps / BPS;
        step.totalRate = previous.totalRate + (((pot - fee) << RATE_SHIFT) / (total - start));
        operatorOwed += fee;
        reserved += pot;
        emit StepSettled(index, step.round, step.work, pot, fee);
    }

    // ---- Payouts ----

    /// @dev Payout of one step since the last payout. A step earns while it is in the window.
    function _earned(address miner, uint256 step) private view returns (uint256 amount, uint256 rate, bool closed) {
        uint256 last = step + windowRounds - 1;
        closed = last < settledSteps;
        rate = steps[closed ? last : settledSteps - 1].totalRate;
        uint256 from = paidRate[miner][step];
        if (from == 0 && step != 0) from = steps[step - 1].totalRate;
        amount = (workOf[step][miner] * (rate - from)) >> RATE_SHIFT;
    }

    /// @notice Sends the miner everything they are owed. Anyone can trigger it; the coins always go only to the miner.
    function claim(address miner) external returns (uint256 amount) {
        _settle(SETTLE_PER_SHARE_CALL);
        amount = _pay(miner);
    }

    /// @notice Batch payout triggered by the pool server. One miner's failure does not stop the others.
    function payout(address[] calldata miners) external {
        uint256 start = _hold();
        _settle(SETTLE_PER_SHARE_CALL);
        uint256 paid;
        for (uint256 i; i < miners.length; ++i) paid += _pay(miners[i]);
        _refund(start, paid != 0);
    }

    function _pay(address miner) private returns (uint256 amount) {
        amount = owed[miner];
        uint256[] storage list = minerSteps[miner];
        uint256 settled = settledSteps;
        uint256 i = cursor[miner];
        uint256 end = list.length;
        uint256 scanned;
        for (uint256 j = i; j < end && scanned < CLAIM_STEPS; ++j) {
            uint256 step = list[j];
            if (step >= settled) {
                if (j == i) break;
                ++scanned;
                continue;
            }
            (uint256 earned, uint256 rate, bool closed) = _earned(miner, step);
            amount += earned;
            if (closed && j == i) i = j + 1;
            else paidRate[miner][step] = rate;
            ++scanned;
        }
        cursor[miner] = i;
        if (amount == 0) return 0;
        owed[miner] = 0;
        reserved -= amount;
        (bool ok,) = miner.call{value: amount, gas: PAYOUT_GAS}("");
        if (ok) {
            totalPaid += amount;
            paidTo[miner] += amount;
            emit Paid(miner, amount);
        } else {
            reserved += amount;
            owed[miner] = amount;
            emit PaymentFailed(miner, amount);
            amount = 0;
        }
    }

    /// @notice The operator gets only the fee from rewards already distributed.
    function withdrawFee() external {
        uint256 amount = operatorOwed;
        if (amount == 0) revert NothingToPay();
        operatorOwed = 0;
        reserved -= amount;
        feesWithdrawn += amount;
        (bool ok,) = operator.call{value: amount}("");
        if (!ok) revert NothingToPay();
        emit FeePaid(amount);
    }

    /// @notice The operator chooses the account of its pool server. Zero turns the refunds off.
    function setRelayer(address relayer_) external {
        if (msg.sender != operator) revert NotOperator();
        relayer = relayer_;
        emit RelayerChanged(relayer_);
    }

    function setUrl(string calldata url_) external {
        if (msg.sender != operator) revert NotOperator();
        if (bytes(url_).length > 128) revert InvalidSettings();
        url = url_;
        emit UrlChanged(url_);
    }

    // ---- Reads for apps ----

    function stepCount() external view returns (uint256) {
        return steps.length;
    }

    /// @notice Is there anything to distribute? A quiet pool can close rounds even without new shares.
    function readyToSettle() external view returns (bool) {
        uint256 next = settledSteps;
        return next < steps.length && steps[next].round < openRound();
    }

    /// @notice How much the miner can withdraw right now.
    function pendingOf(address miner) external view returns (uint256 amount) {
        amount = owed[miner];
        uint256[] storage list = minerSteps[miner];
        uint256 settled = settledSteps;
        for (uint256 j = cursor[miner]; j < list.length; ++j) {
            if (list[j] >= settled) continue;
            (uint256 earned,,) = _earned(miner, list[j]);
            amount += earned;
        }
    }

    /// @notice Work in the current window: total and of the given miner. The share of the next reward is their ratio.
    function windowWork(address miner) external view returns (uint256 total, uint256 own) {
        uint256 count = steps.length;
        uint256 start = count > windowRounds ? count - windowRounds : 0;
        for (uint256 i = start; i < count; ++i) {
            total += steps[i].work;
            own += workOf[i][miner];
        }
    }

    /// @notice Coins waiting for the next distribution.
    function unsettled() external view returns (uint256) {
        return address(this).balance - reserved - gasHold;
    }
}
