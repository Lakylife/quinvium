// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IOwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title Profile pictures of addresses
/// @notice Each address chooses an NFT it owns as its picture. Wallets and the Explorer show it next to the address and its
/// .qu name only while the address still owns the NFT: a sold or moved NFT stops showing by itself. There is no owner, no fee
/// and no upgrade; only the address itself can set or clear its picture.
contract Profiles {
    struct Avatar {
        address nft;
        uint256 tokenId;
    }

    /// Gas for asking a foreign NFT contract who owns a token, so a broken contract cannot make reads fail.
    uint256 private constant OWNER_GAS = 50_000;

    mapping(address => Avatar) private avatars;

    event AvatarSet(address indexed account, address indexed nft, uint256 tokenId);

    error NotTokenOwner();

    /// Sets the sender's picture to an NFT the sender owns now.
    function setAvatar(address nft, uint256 tokenId) external {
        if (nft == address(0) || _ownerOf(nft, tokenId) != msg.sender) revert NotTokenOwner();
        avatars[msg.sender] = Avatar(nft, tokenId);
        emit AvatarSet(msg.sender, nft, tokenId);
    }

    /// Removes the sender's picture.
    function clear() external {
        delete avatars[msg.sender];
        emit AvatarSet(msg.sender, address(0), 0);
    }

    /// The picture of an address; `valid` is true only while the address still owns the NFT.
    function avatarOf(address account) public view returns (address nft, uint256 tokenId, bool valid) {
        Avatar memory a = avatars[account];
        if (a.nft == address(0)) return (address(0), 0, false);
        return (a.nft, a.tokenId, _ownerOf(a.nft, a.tokenId) == account);
    }

    /// Pictures of many addresses in one call, for lists.
    function avatarsOf(address[] calldata accounts) external view returns (address[] memory nfts, uint256[] memory ids, bool[] memory valid) {
        nfts = new address[](accounts.length);
        ids = new uint256[](accounts.length);
        valid = new bool[](accounts.length);
        for (uint256 i; i < accounts.length; i++) (nfts[i], ids[i], valid[i]) = avatarOf(accounts[i]);
    }

    function _ownerOf(address nft, uint256 tokenId) private view returns (address) {
        if (nft.code.length == 0) return address(0);
        try IOwnerOf(nft).ownerOf{gas: OWNER_GAS}(tokenId) returns (address owner) {
            return owner;
        } catch {
            return address(0);
        }
    }
}
