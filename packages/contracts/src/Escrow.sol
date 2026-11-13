// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Úschova plateb: obchod, služby, zálohy na nemovitosti
/// @notice Peníze drží kontrakt, rozhodce spory jen rozděluje a nemůže si nic ponechat nad poplatek.
///         Výplaty si příjemci vybírají sami, takže je nikdo nemůže zablokovat.
contract Escrow {
    enum State {
        None,
        Funded,
        Disputed,
        Closed
    }

    struct Deal {
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        uint64 deadline;
        uint64 disputedAt;
        uint16 arbiterFeeBps;
        State state;
        string note;
    }

    uint256 public constant MAX_FEE_BPS = 1000;
    /// Když rozhodce do této doby nerozhodne, peníze nesmí zůstat zamčené navždy.
    uint256 public constant ARBITER_TIMEOUT = 90 days;

    uint256 public dealCount;
    mapping(uint256 => Deal) private deals;
    mapping(address => uint256) public credits;

    event Created(uint256 indexed id, address indexed buyer, address indexed seller, address arbiter, uint256 amount, uint64 deadline);
    event Released(uint256 indexed id);
    event Refunded(uint256 indexed id);
    event Disputed(uint256 indexed id, address indexed by);
    event Resolved(uint256 indexed id, uint256 sellerAmount, uint256 buyerAmount, uint256 fee);
    event Withdrawn(address indexed account, uint256 amount);

    error InvalidDeal();
    error NotAllowed();
    error WrongState();
    error TooEarly();
    error NothingToWithdraw();

    function create(address seller, address arbiter, uint64 deadline, uint16 arbiterFeeBps, string calldata note)
        external
        payable
        returns (uint256 id)
    {
        if (
            msg.value == 0 || seller == address(0) || seller == msg.sender || arbiter == msg.sender || arbiter == seller
                || arbiter == address(0) || deadline <= block.timestamp || arbiterFeeBps > MAX_FEE_BPS
        ) revert InvalidDeal();
        id = ++dealCount;
        deals[id] = Deal(msg.sender, seller, arbiter, msg.value, deadline, 0, arbiterFeeBps, State.Funded, note);
        emit Created(id, msg.sender, seller, arbiter, msg.value, deadline);
    }

    /// Kupující potvrdí plnění, nebo prodávající dobrovolně vrátí peníze.
    function release(uint256 id) external {
        Deal storage d = _state(id, State.Funded);
        if (msg.sender != d.buyer) revert NotAllowed();
        d.state = State.Closed;
        credits[d.seller] += d.amount;
        emit Released(id);
    }

    function refund(uint256 id) external {
        Deal storage d = _state(id, State.Funded);
        if (msg.sender != d.seller) {
            if (msg.sender != d.buyer) revert NotAllowed();
            if (block.timestamp <= d.deadline) revert TooEarly();
        }
        d.state = State.Closed;
        credits[d.buyer] += d.amount;
        emit Refunded(id);
    }

    function dispute(uint256 id) external {
        Deal storage d = _state(id, State.Funded);
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotAllowed();
        d.state = State.Disputed;
        d.disputedAt = uint64(block.timestamp);
        emit Disputed(id, msg.sender);
    }

    /// @param sellerBps podíl prodávajícího v bazických bodech ze zbytku po poplatku rozhodce
    function resolve(uint256 id, uint16 sellerBps) external {
        Deal storage d = _state(id, State.Disputed);
        if (msg.sender != d.arbiter) revert NotAllowed();
        if (sellerBps > 10000) revert InvalidDeal();
        d.state = State.Closed;
        uint256 fee = (d.amount * d.arbiterFeeBps) / 10000;
        uint256 rest = d.amount - fee;
        uint256 toSeller = (rest * sellerBps) / 10000;
        uint256 toBuyer = rest - toSeller;
        credits[d.arbiter] += fee;
        credits[d.seller] += toSeller;
        credits[d.buyer] += toBuyer;
        emit Resolved(id, toSeller, toBuyer, fee);
    }

    /// Rozhodce zmizel: obě strany dostanou polovinu a rozhodce nic.
    function settleAbandoned(uint256 id) external {
        Deal storage d = _state(id, State.Disputed);
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotAllowed();
        if (block.timestamp < d.disputedAt + ARBITER_TIMEOUT) revert TooEarly();
        d.state = State.Closed;
        uint256 toSeller = d.amount / 2;
        uint256 toBuyer = d.amount - toSeller;
        credits[d.seller] += toSeller;
        credits[d.buyer] += toBuyer;
        emit Resolved(id, toSeller, toBuyer, 0);
    }

    function withdraw() external {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "platba selhala");
    }

    function get(uint256 id) external view returns (Deal memory) {
        return deals[id];
    }

    function _state(uint256 id, State expected) private view returns (Deal storage d) {
        d = deals[id];
        if (d.state != expected) revert WrongState();
    }
}
