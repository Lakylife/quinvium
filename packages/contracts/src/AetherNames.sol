// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Jména v síti: lidsky čitelné adresy (jan.aet) pro platby a identitu
/// @notice Poplatek se pálí. Jméno se platí na roky, po ochranné lhůtě ho může získat kdokoli.
///         Registrace má dva kroky: nejdřív se zveřejní jen otisk, až potom jméno.
///         Kdo by jméno opsal z čekajících transakcí, nestihne ho zaregistrovat dřív.
contract AetherNames {
    struct Entry {
        address owner;
        address target;
        uint64 expires;
    }

    uint256 public constant YEAR = 365 days;
    uint256 public constant GRACE = 30 days;
    uint256 public constant MAX_YEARS = 10;
    uint256 public constant MIN_COMMIT_AGE = 60 seconds;
    uint256 public constant MAX_COMMIT_AGE = 1 days;

    mapping(bytes32 => Entry) private entries;
    mapping(address => string) private primary;
    mapping(bytes32 => uint256) public commitments;

    event Registered(bytes32 indexed node, string name, address indexed owner, uint64 expires);
    event Renewed(bytes32 indexed node, uint64 expires);
    event Transferred(bytes32 indexed node, address indexed to);
    event TargetChanged(bytes32 indexed node, address indexed target);

    error InvalidName();
    error InvalidYears();
    error Unavailable();
    error WrongPayment(uint256 expected);
    error NotOwner();
    error Expired();
    error ZeroAddress();
    error CommitmentActive();
    error CommitmentMissing();
    error CommitmentTooNew();

    /// Krátká jména jsou dražší, aby se nedala hromadně zabírat.
    function pricePerYear(string memory name) public pure returns (uint256) {
        uint256 len = bytes(name).length;
        if (len == 3) return 50 ether;
        if (len == 4) return 10 ether;
        return 1 ether;
    }

    function nodeOf(string memory name) public pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    function valid(string memory name) public pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length < 3 || b.length > 32) return false;
        if (b[0] == "-" || b[b.length - 1] == "-") return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) return false;
        }
        return true;
    }

    function available(string memory name) public view returns (bool) {
        return valid(name) && block.timestamp > entries[nodeOf(name)].expires + GRACE;
    }

    /// Otisk záměru: nic neprozradí, dokud se nezveřejní `secret`.
    function commitment(string memory name, address owner, address target, bytes32 secret) public pure returns (bytes32) {
        return keccak256(abi.encode(nodeOf(name), owner, target, secret));
    }

    function commit(bytes32 hash) external {
        if (block.timestamp <= commitments[hash] + MAX_COMMIT_AGE) revert CommitmentActive();
        commitments[hash] = block.timestamp;
    }

    function register(string calldata name, uint256 yearsCount, address target, bytes32 secret) external payable {
        if (!valid(name)) revert InvalidName();
        if (yearsCount == 0 || yearsCount > MAX_YEARS) revert InvalidYears();
        if (target == address(0)) revert ZeroAddress();
        if (!available(name)) revert Unavailable();
        bytes32 hash = commitment(name, msg.sender, target, secret);
        uint256 committedAt = commitments[hash];
        if (committedAt == 0 || block.timestamp > committedAt + MAX_COMMIT_AGE) revert CommitmentMissing();
        if (block.timestamp < committedAt + MIN_COMMIT_AGE) revert CommitmentTooNew();
        delete commitments[hash];
        uint256 cost = pricePerYear(name) * yearsCount;
        if (msg.value != cost) revert WrongPayment(cost);
        bytes32 node = nodeOf(name);
        uint64 expires = uint64(block.timestamp + YEAR * yearsCount);
        entries[node] = Entry(msg.sender, target, expires);
        emit Registered(node, name, msg.sender, expires);
        _burn(cost);
    }

    function renew(string calldata name, uint256 yearsCount) external payable {
        if (yearsCount == 0 || yearsCount > MAX_YEARS) revert InvalidYears();
        bytes32 node = nodeOf(name);
        Entry storage e = entries[node];
        if (e.owner == address(0) || block.timestamp > e.expires + GRACE) revert Expired();
        uint256 cost = pricePerYear(name) * yearsCount;
        if (msg.value != cost) revert WrongPayment(cost);
        uint256 base = e.expires > block.timestamp ? e.expires : block.timestamp;
        e.expires = uint64(base + YEAR * yearsCount);
        emit Renewed(node, e.expires);
        _burn(cost);
    }

    function setTarget(string calldata name, address target) external {
        if (target == address(0)) revert ZeroAddress();
        bytes32 node = nodeOf(name);
        _requireOwner(node);
        entries[node].target = target;
        emit TargetChanged(node, target);
    }

    function transfer(string calldata name, address to) external {
        if (to == address(0)) revert ZeroAddress();
        bytes32 node = nodeOf(name);
        _requireOwner(node);
        entries[node].owner = to;
        emit Transferred(node, to);
    }

    /// Hlavní jméno adresy pro zobrazení v peněženkách a exploreru.
    function setPrimary(string calldata name) external {
        Entry storage e = entries[nodeOf(name)];
        if (e.target != msg.sender || block.timestamp > e.expires) revert NotOwner();
        primary[msg.sender] = name;
    }

    function resolve(string calldata name) external view returns (address) {
        Entry storage e = entries[nodeOf(name)];
        return block.timestamp <= e.expires ? e.target : address(0);
    }

    function nameOf(address account) external view returns (string memory) {
        string memory name = primary[account];
        Entry storage e = entries[nodeOf(name)];
        if (e.target != account || block.timestamp > e.expires) return "";
        return name;
    }

    function info(string calldata name) external view returns (address owner, address target, uint64 expires) {
        Entry storage e = entries[nodeOf(name)];
        return (e.owner, e.target, e.expires);
    }

    function _requireOwner(bytes32 node) private view {
        Entry storage e = entries[node];
        if (e.owner != msg.sender) revert NotOwner();
        if (block.timestamp > e.expires) revert Expired();
    }

    function _burn(uint256 amount) private {
        (bool ok, ) = address(0).call{value: amount}("");
        require(ok);
    }
}
