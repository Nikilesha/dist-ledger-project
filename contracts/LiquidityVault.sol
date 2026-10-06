// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** Simple ETH pool used only by the protocol for successful payouts. */
contract LiquidityVault {
    address public owner;
    address public protocol;
    mapping(address => uint256) public deposits;
    bool private locked;

    event LiquidityDeposited(address indexed provider, uint256 amount);
    event LiquidityWithdrawn(address indexed provider, uint256 amount);
    event PayoutSent(address indexed customer, uint256 amount);
    event ProtocolSet(address indexed protocol);

    modifier onlyOwner() { require(msg.sender == owner, "Only owner"); _; }
    modifier onlyProtocol() { require(msg.sender == protocol, "Only protocol"); _; }
    modifier noReentry() { require(!locked, "Reentrant call"); locked = true; _; locked = false; }

    constructor() { owner = msg.sender; }

    function setProtocol(address _protocol) external onlyOwner {
        require(protocol == address(0), "Already set");
        require(_protocol != address(0), "Bad address");
        protocol = _protocol;
        emit ProtocolSet(_protocol);
    }

    function deposit() external payable {
        require(msg.value > 0, "Send ETH");
        deposits[msg.sender] += msg.value;
        emit LiquidityDeposited(msg.sender, msg.value);
    }

    // Fine for a classroom prototype. Production vaults reserve capital for active policies.
    function withdraw(uint256 amount) external noReentry {
        require(amount > 0 && deposits[msg.sender] >= amount, "Not enough deposit");
        deposits[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    function payout(address payable customer, uint256 amount) external onlyProtocol noReentry {
        require(address(this).balance >= amount, "Vault has insufficient ETH");
        (bool ok,) = customer.call{value: amount}("");
        require(ok, "Payout failed");
        emit PayoutSent(customer, amount);
    }

    function availableLiquidity() external view returns (uint256) { return address(this).balance; }
}
