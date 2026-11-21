// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPoolFactoryList {
    function isPool(address pool) external view returns (bool);
}

interface IPoolInfo {
    function operator() external view returns (address);
    function name() external view returns (string memory);
}

/// @title Display names of pools, changeable by their operator
/// @notice A pool's own name is fixed in its contract. Here its operator can set a display name and a website, at most
/// once every 30 days and for a fee that stays locked in this contract forever: there is no owner and no withdrawal,
/// so the fee only makes squatting and frequent renaming expensive and pays nobody.
/// Names are unique within a factory, compared without case, spaces, dots, dashes and underscores. A pool whose own
/// contract name matches a display name taken by a pool whose contract name does not can take it over, so the original
/// pool always keeps its name. Deployed by a user like any contract; apps trust it only when its code matches the build.
contract PoolNames {
    uint256 public constant FEE = 10 ether;
    uint256 public constant COOLDOWN = 30 days;
    uint256 public constant MIN_NAME = 3;
    uint256 public constant MAX_NAME = 32;
    uint256 public constant MAX_WEBSITE = 96;

    struct Entry {
        string name;
        string website;
        uint64 changedAt;
    }

    mapping(address factory => mapping(address pool => Entry)) private entries;
    mapping(address factory => mapping(bytes32 key => address pool)) public holderOf;

    event NameSet(address indexed factory, address indexed pool, string name, string website);
    event NameReleased(address indexed factory, address indexed pool, string name);

    error NotPool();
    error NotOperator();
    error WrongFee();
    error TooSoon(uint256 nextChange);
    error InvalidName();
    error InvalidWebsite();
    error NameTaken(address pool);

    /// @param factory the factory that created the pool; apps show names only for factories they trust
    /// @param pool the pool contract
    /// @param name display name, 3 to 32 characters: letters, digits, space, dot, dash and underscore
    /// @param website empty, or https:// followed by at most 88 characters without spaces
    function setName(address factory, address pool, string calldata name, string calldata website) external payable {
        if (!IPoolFactoryList(factory).isPool(pool)) revert NotPool();
        if (IPoolInfo(pool).operator() != msg.sender) revert NotOperator();
        if (msg.value != FEE) revert WrongFee();
        Entry storage e = entries[factory][pool];
        if (e.changedAt != 0 && block.timestamp < e.changedAt + COOLDOWN) revert TooSoon(e.changedAt + COOLDOWN);
        bytes32 key = keyOf(name);
        if (key == bytes32(0)) revert InvalidName();
        if (!validWebsite(bytes(website))) revert InvalidWebsite();

        address holder = holderOf[factory][key];
        if (holder != address(0) && holder != pool) {
            // The original wins: a pool whose own name is this one takes it from a pool whose own name is not.
            if (keyOfOwn(pool) != key || keyOfOwn(holder) == key) revert NameTaken(holder);
            _release(factory, holder);
        }
        bytes32 previous = bytes(e.name).length == 0 ? bytes32(0) : keyOf(e.name);
        if (previous != bytes32(0) && previous != key) delete holderOf[factory][previous];
        holderOf[factory][key] = pool;
        e.name = name;
        e.website = website;
        e.changedAt = uint64(block.timestamp);
        emit NameSet(factory, pool, name, website);
    }

    /// @return name the display name, empty when none is set
    /// @return website the website, possibly empty
    /// @return changedAt when it was last set, zero when never
    function nameOf(address factory, address pool) external view returns (string memory name, string memory website, uint64 changedAt) {
        Entry storage e = entries[factory][pool];
        return (e.name, e.website, e.changedAt);
    }

    /// @notice The key a name is compared by; zero for an invalid name.
    function keyOf(string memory name) public pure returns (bytes32) {
        bytes memory b = bytes(name);
        if (b.length < MIN_NAME || b.length > MAX_NAME || b[0] == " " || b[b.length - 1] == " ") return bytes32(0);
        bytes memory folded = new bytes(b.length);
        uint256 n;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c >= "A" && c <= "Z") folded[n++] = bytes1(uint8(c) + 32);
            else if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) folded[n++] = c;
            else if (c == " " || c == "." || c == "-" || c == "_") {
                if (i > 0 && b[i - 1] == " " && c == " ") return bytes32(0);
            } else return bytes32(0);
        }
        if (n == 0) return bytes32(0);
        assembly { mstore(folded, n) }
        return keccak256(folded);
    }

    /// @dev The key of the pool's own contract name; zero when it is not a valid display name or cannot be read.
    function keyOfOwn(address pool) private view returns (bytes32) {
        try IPoolInfo(pool).name() returns (string memory own) {
            return keyOf(own);
        } catch {
            return bytes32(0);
        }
    }

    function validWebsite(bytes memory w) private pure returns (bool) {
        if (w.length == 0) return true;
        if (w.length < 9 || w.length > MAX_WEBSITE) return false;
        bytes memory prefix = "https://";
        for (uint256 i; i < 8; ++i) if (w[i] != prefix[i]) return false;
        for (uint256 i = 8; i < w.length; ++i) if (uint8(w[i]) <= 0x20 || uint8(w[i]) >= 0x7f) return false;
        return true;
    }

    function _release(address factory, address pool) private {
        Entry storage e = entries[factory][pool];
        emit NameReleased(factory, pool, e.name);
        e.name = "";
        e.website = "";
    }
}
