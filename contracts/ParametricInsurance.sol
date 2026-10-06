// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidityVault {
    function payout(address payable customer, uint256 amount) external;
    function availableLiquidity() external view returns (uint256);
}

/**
 * A small parametric insurance contract for a local demonstration.
 * Event value is minutes delayed for flights, or a weather severity score for weather.
 */
contract ParametricInsurance {
    enum PolicyType { FlightDelay, Weather }
    enum PolicyStatus { Active, Paid, NoPayout }

    struct Policy {
        address payable customer;
        string eventName;
        PolicyType policyType;
        uint256 threshold;
        uint256 payoutAmount;
        uint256 premium;
        uint256 verifiedValue;
        uint256 reportsReceived;
        PolicyStatus status;
    }

    address public owner;
    ILiquidityVault public vault;
    uint256 public nextPolicyId;
    uint256 public requiredConfirmations;
    address[] public oracleNodes;
    mapping(address => bool) public isOracle;
    mapping(uint256 => Policy) private policies;
    mapping(uint256 => mapping(address => bool)) public submitted;
    mapping(uint256 => uint256) private measurementTotal;
    bool private locked;

    event PolicyCreated(uint256 indexed policyId, address indexed customer, PolicyType policyType, string eventName, uint256 threshold, uint256 payout, uint256 premium);
    event OracleReportReceived(uint256 indexed policyId, address indexed oracle, uint256 value, uint256 reportNumber);
    event PolicyResolved(uint256 indexed policyId, uint256 verifiedValue, bool payoutMade);
    event OracleChanged(address indexed oracle, bool allowed);

    modifier onlyOwner() { require(msg.sender == owner, "Only owner"); _; }
    modifier onlyOracle() { require(isOracle[msg.sender], "Only oracle"); _; }
    modifier noReentry() { require(!locked, "Reentrant call"); locked = true; _; locked = false; }

    constructor(address vaultAddress, address[] memory initialOracles, uint256 confirmations) {
        require(vaultAddress != address(0), "Bad vault");
        require(confirmations > 0 && confirmations <= initialOracles.length, "Bad confirmations");
        owner = msg.sender;
        vault = ILiquidityVault(vaultAddress);
        requiredConfirmations = confirmations;
        for (uint256 i = 0; i < initialOracles.length; i++) {
            isOracle[initialOracles[i]] = true;
            oracleNodes.push(initialOracles[i]);
            emit OracleChanged(initialOracles[i], true);
        }
    }

    function createPolicy(string calldata eventName, PolicyType policyType, uint256 threshold, uint256 payoutAmount) external payable returns (uint256) {
        require(bytes(eventName).length > 0, "Event required");
        require(threshold > 0 && payoutAmount > 0, "Positive values required");
        require(msg.value > 0, "Premium required");
        require(vault.availableLiquidity() >= payoutAmount, "Not enough vault liquidity");

        uint256 id = nextPolicyId++;
        policies[id] = Policy(payable(msg.sender), eventName, policyType, threshold, payoutAmount, msg.value, 0, 0, PolicyStatus.Active);
        emit PolicyCreated(id, msg.sender, policyType, eventName, threshold, payoutAmount, msg.value);
        return id;
    }

    function submitOracleData(uint256 policyId, uint256 measuredValue) external onlyOracle noReentry {
        Policy storage policy = policies[policyId];
        require(policy.customer != address(0), "Policy not found");
        require(policy.status == PolicyStatus.Active, "Policy already resolved");
        require(!submitted[policyId][msg.sender], "This oracle already reported");

        submitted[policyId][msg.sender] = true;
        policy.reportsReceived++;
        measurementTotal[policyId] += measuredValue;
        emit OracleReportReceived(policyId, msg.sender, measuredValue, policy.reportsReceived);

        if (policy.reportsReceived >= requiredConfirmations) {
            policy.verifiedValue = measurementTotal[policyId] / policy.reportsReceived;
            if (policy.verifiedValue >= policy.threshold) {
                policy.status = PolicyStatus.Paid; // set before external call: no duplicate payout
                vault.payout(policy.customer, policy.payoutAmount);
                emit PolicyResolved(policyId, policy.verifiedValue, true);
            } else {
                policy.status = PolicyStatus.NoPayout;
                emit PolicyResolved(policyId, policy.verifiedValue, false);
            }
        }
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) { return policies[policyId]; }
    function oracleCount() external view returns (uint256) { return oracleNodes.length; }

    function setOracle(address oracle, bool allowed) external onlyOwner {
        require(oracle != address(0), "Bad address");
        isOracle[oracle] = allowed;
        if (allowed) oracleNodes.push(oracle);
        emit OracleChanged(oracle, allowed);
    }
}
