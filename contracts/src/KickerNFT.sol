// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract KickerNFT {
    struct Stats {
        uint8 countryId;
        uint32 wins;
        uint32 losses;
        uint32 streak;
        uint32 level;
    }

    string public constant name = "Panenka Country Kicker";
    string public constant symbol = "PNK";
    uint8 public constant MAX_COUNTRY_ID = 16;

    address public owner;
    address public duelContract;
    uint256 public nextTokenId = 1;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => Stats) public statsOf;
    mapping(address => bool) public hasMinted;
    mapping(address => uint256) public tokenOfOwner;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed spender, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event DuelContractSet(address indexed duelContract);
    event KickerMinted(address indexed player, uint256 indexed tokenId, uint8 countryId);
    event KickerStatsUpdated(uint256 indexed tokenId, uint32 wins, uint32 losses, uint32 streak, uint32 level);

    error NotOwner();
    error NotDuelContract();
    error AlreadyMinted();
    error InvalidCountry();
    error NotTokenOwner();
    error NotApproved();
    error ZeroAddress();
    error TokenNotFound();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyDuelContract() {
        if (msg.sender != duelContract) revert NotDuelContract();
        _;
    }

    function setDuelContract(address newDuelContract) external onlyOwner {
        if (newDuelContract == address(0)) revert ZeroAddress();
        duelContract = newDuelContract;
        emit DuelContractSet(newDuelContract);
    }

    function mint(uint8 countryId) external returns (uint256 tokenId) {
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        if (countryId == 0 || countryId > MAX_COUNTRY_ID) revert InvalidCountry();

        tokenId = nextTokenId++;
        hasMinted[msg.sender] = true;
        ownerOf[tokenId] = msg.sender;
        tokenOfOwner[msg.sender] = tokenId;
        balanceOf[msg.sender] += 1;
        statsOf[tokenId] = Stats({countryId: countryId, wins: 0, losses: 0, streak: 0, level: 1});

        emit Transfer(address(0), msg.sender, tokenId);
        emit KickerMinted(msg.sender, tokenId, countryId);
    }

    function approve(address spender, uint256 tokenId) external {
        address tokenOwner = ownerOf[tokenId];
        if (tokenOwner == address(0)) revert TokenNotFound();
        if (msg.sender != tokenOwner && !isApprovedForAll[tokenOwner][msg.sender]) revert NotApproved();

        getApproved[tokenId] = spender;
        emit Approval(tokenOwner, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert NotApproved();
        if (ownerOf[tokenId] != from) revert NotTokenOwner();
        if (to == address(0)) revert ZeroAddress();

        delete getApproved[tokenId];
        if (tokenOfOwner[from] == tokenId) tokenOfOwner[from] = 0;
        tokenOfOwner[to] = tokenId;
        ownerOf[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    function recordWin(uint256 tokenId) external onlyDuelContract {
        if (ownerOf[tokenId] == address(0)) revert TokenNotFound();
        Stats storage stats = statsOf[tokenId];
        stats.wins += 1;
        stats.streak += 1;
        stats.level = uint32(1 + stats.wins / 3);
        emit KickerStatsUpdated(tokenId, stats.wins, stats.losses, stats.streak, stats.level);
    }

    function recordLoss(uint256 tokenId) external onlyDuelContract {
        if (ownerOf[tokenId] == address(0)) revert TokenNotFound();
        Stats storage stats = statsOf[tokenId];
        stats.losses += 1;
        stats.streak = 0;
        emit KickerStatsUpdated(tokenId, stats.wins, stats.losses, stats.streak, stats.level);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf[tokenId];
        return spender == tokenOwner || getApproved[tokenId] == spender || isApprovedForAll[tokenOwner][spender];
    }
}
