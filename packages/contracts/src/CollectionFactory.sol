// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// A collection of unique items: tickets, ownership titles, art, warranty cards.
contract AetherCollection is ERC721URIStorage, Ownable {
    uint256 public totalMinted;

    constructor(string memory name_, string memory symbol_, address owner_) ERC721(name_, symbol_) Ownable(owner_) {}

    function mint(address to, string calldata uri) external onlyOwner returns (uint256 id) {
        id = ++totalMinted;
        _safeMint(to, id);
        _setTokenURI(id, uri);
    }
}

/// @title Factory for NFT collections
contract CollectionFactory {
    address[] public collections;
    mapping(address => address[]) private byCreator;

    event CollectionCreated(address indexed collection, address indexed creator, string name, string symbol);

    function create(string calldata name, string calldata symbol) external returns (address collection) {
        collection = address(new AetherCollection(name, symbol, msg.sender));
        collections.push(collection);
        byCreator[msg.sender].push(collection);
        emit CollectionCreated(collection, msg.sender, name, symbol);
    }

    function count() external view returns (uint256) {
        return collections.length;
    }

    function collectionsOf(address creator) external view returns (address[] memory) {
        return byCreator[creator];
    }
}
