// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  RWAToken
 * @notice ERC-20 token for Real-World Assets with role-based access control,
 *         compliant-transfer whitelist, supply cap, and emergency pause.
 *
 * ── Roles ──────────────────────────────────────────────────────────────────
 *  DEFAULT_ADMIN_ROLE  — grant/revoke all roles; force-burn via adminBurn
 *  MINTER_ROLE         — mint new tokens (subject to supplyCap)
 *  PAUSER_ROLE         — pause / unpause all transfers
 *  COMPLIANCE_ROLE     — add / remove addresses from the transfer whitelist
 *
 * ── Whitelist semantics (enforced in _update) ──────────────────────────────
 *  Mint     (from == address(0)):          recipient  (to)   must be whitelisted
 *  Burn     (to   == address(0)):          token holder (from) must be whitelisted
 *  Transfer (both non-zero):               BOTH from and to must be whitelisted
 *
 * ── OZ 5.x compatibility note ──────────────────────────────────────────────
 *  In OpenZeppelin 5.x, ERC20Pausable overrides _update (not _beforeTokenTransfer).
 *  Our _update override must list both ERC20 and ERC20Pausable, and delegate to
 *  super._update so that ERC20Pausable's pause check runs via the MRO chain.
 */
contract RWAToken is ERC20, ERC20Pausable, AccessControl {

    // ── Role identifiers ──────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE     = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE     = keccak256("PAUSER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice Absolute maximum token supply (in raw 18-decimal units).
    ///         Set once in the constructor; thereafter immutable.
    uint256 public immutable supplyCap;

    /// @notice True for addresses permitted to send and/or receive tokens.
    mapping(address => bool) public whitelist;

    // ── Custom errors ─────────────────────────────────────────────────────────

    /// @dev Emitted by _update when the recipient is not on the whitelist.
    error RecipientNotWhitelisted(address recipient);

    /// @dev Emitted by _update when the sender (token holder) is not on the whitelist.
    error SenderNotWhitelisted(address sender);

    /// @dev Emitted by mint when the requested amount would exceed supplyCap.
    error SupplyCapExceeded(uint256 requested, uint256 cap);

    // ── Events ────────────────────────────────────────────────────────────────

    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param name_       ERC-20 token name.
     * @param symbol_     ERC-20 token symbol.
     * @param supplyCap_  Maximum supply expressed in whole-token units.
     *                    The constructor multiplies by 10^decimals() (18) internally,
     *                    so pass 1_000_000 for a one-million token cap.
     * @param admin_      Address that receives DEFAULT_ADMIN_ROLE, MINTER_ROLE,
     *                    PAUSER_ROLE, and COMPLIANCE_ROLE at deployment.
     *                    Also added to the whitelist so it can receive tokens immediately.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supplyCap_,
        address admin_
    ) ERC20(name_, symbol_) {
        require(admin_ != address(0), "RWAToken: admin is zero address");

        supplyCap = supplyCap_ * 10 ** decimals();

        // Grant all four roles to the deploying admin.
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE,        admin_);
        _grantRole(PAUSER_ROLE,        admin_);
        _grantRole(COMPLIANCE_ROLE,    admin_);

        // The admin must be whitelisted to be a valid token recipient.
        whitelist[admin_] = true;
        emit AddedToWhitelist(admin_);
    }

    // ── Minting ───────────────────────────────────────────────────────────────

    /**
     * @notice Mint `amount` tokens (in wei units) to `to`.
     * @dev    Caller must have MINTER_ROLE.
     *         Reverts with {SupplyCapExceeded} if mint would push totalSupply above the cap.
     *         Recipient must be whitelisted — enforced in {_update}.
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 newSupply = totalSupply() + amount;
        if (newSupply > supplyCap) {
            revert SupplyCapExceeded(newSupply, supplyCap);
        }
        _mint(to, amount);
    }

    // ── Burning ───────────────────────────────────────────────────────────────

    /**
     * @notice Burn `amount` of the caller's own tokens.
     * @dev    No role required; caller must be whitelisted (enforced in {_update}).
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Force-burn `amount` tokens from `from`.
     * @dev    Requires DEFAULT_ADMIN_ROLE.
     *         The `from` address must be whitelisted (enforced in {_update}).
     *         To burn from a frozen (non-whitelisted) address, the admin should
     *         temporarily re-whitelist the address, burn, then re-freeze.
     */
    function adminBurn(address from, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _burn(from, amount);
    }

    // ── Pause ─────────────────────────────────────────────────────────────────

    /**
     * @notice Pause all token transfers, mints, and burns.
     * @dev    Requires PAUSER_ROLE.
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Resume all token operations.
     * @dev    Requires PAUSER_ROLE.
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ── Whitelist management ──────────────────────────────────────────────────

    /**
     * @notice Add `account` to the compliance whitelist.
     * @dev    Requires COMPLIANCE_ROLE. Emits {AddedToWhitelist}.
     */
    function addToWhitelist(address account) external onlyRole(COMPLIANCE_ROLE) {
        whitelist[account] = true;
        emit AddedToWhitelist(account);
    }

    /**
     * @notice Remove `account` from the compliance whitelist (freeze the address).
     * @dev    Requires COMPLIANCE_ROLE. Emits {RemovedFromWhitelist}.
     *         After removal the address cannot send or receive tokens until re-added.
     */
    function removeFromWhitelist(address account) external onlyRole(COMPLIANCE_ROLE) {
        whitelist[account] = false;
        emit RemovedFromWhitelist(account);
    }

    // ── Internal override ─────────────────────────────────────────────────────

    /**
     * @dev Overrides both ERC20._update and ERC20Pausable._update.
     *
     *      Whitelist enforcement:
     *        - Mint     (from == address(0)): recipient `to`    must be whitelisted.
     *        - Burn     (to   == address(0)): token holder `from` must be whitelisted.
     *        - Transfer (both non-zero):      both `from` AND `to` must be whitelisted.
     *
     *      Pause enforcement is handled by ERC20Pausable._update via `super._update`.
     *      Whitelist checks run first so revert messages are always whitelist-specific
     *      even if the contract is also paused.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        bool isMint     = from == address(0);
        bool isBurn     = to   == address(0);
        bool isTransfer = !isMint && !isBurn;

        // Recipient check: mints and transfers.
        if ((isMint || isTransfer) && !whitelist[to]) {
            revert RecipientNotWhitelisted(to);
        }

        // Sender check: burns and transfers.
        if ((isBurn || isTransfer) && !whitelist[from]) {
            revert SenderNotWhitelisted(from);
        }

        // Delegates to ERC20Pausable._update → ERC20._update via super chain.
        super._update(from, to, value);
    }
}
