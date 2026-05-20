// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DuelCredit {
    string public constant name = "Panenka DuelCredit";
    string public constant symbol = "DCR";
    uint8 public constant decimals = 18;
    uint256 public constant FAUCET_AMOUNT = 100 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    address public owner;
    address public duelContract;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastFaucetClaimAt;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event DuelContractSet(address indexed duelContract);
    event CreditFaucetClaimed(address indexed user, uint256 amount);

    error NotOwner();
    error DuelContractAlreadySet();
    error TransfersOnlyThroughDuel();
    error FaucetCooldown();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setDuelContract(address newDuelContract) external onlyOwner {
        if (newDuelContract == address(0)) revert ZeroAddress();
        if (duelContract != address(0)) revert DuelContractAlreadySet();
        duelContract = newDuelContract;
        emit DuelContractSet(newDuelContract);
    }

    function claimFaucet() external {
        uint256 lastClaimedAt = lastFaucetClaimAt[msg.sender];
        if (lastClaimedAt != 0 && block.timestamp < lastClaimedAt + FAUCET_COOLDOWN) {
            revert FaucetCooldown();
        }

        lastFaucetClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit CreditFaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _enforceDuelRoute(msg.sender, to);
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }

        _enforceDuelRoute(from, to);
        _transfer(from, to, amount);
        return true;
    }

    function _enforceDuelRoute(address from, address to) internal view {
        if (duelContract == address(0)) revert ZeroAddress();
        if (msg.sender != duelContract && from != duelContract && to != duelContract) {
            revert TransfersOnlyThroughDuel();
        }
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
